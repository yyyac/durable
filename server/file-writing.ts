import { open, stat, realpath, lstat, type FileHandle } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createWriteTool, createEditTool } from '@earendil-works/pi-durable/tools';
import { createHash } from 'node:crypto';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import type { Context } from '@earendil-works/chord/context';
import type { ConversationId, JsonObject, Tx, ToolExecutionResult, TaskId, EntryId } from '@earendil-works/pi-durable';
import { recoverableTool } from './tool-recovery.js';
import { FileReadsDoc, hashFile, identityOf, withFileLock } from './file-versions.js';
import type { RecoveryCall } from './tool-calls.js';

type FileIntent = { kind: 'create'; path: string } | { kind: 'overwrite' | 'edit'; path: string; identity: string; hash: string; readId: string };
function conflict() { return new Error('文件冲突：目标在读取后已经变化，请重新读取后处理；没有覆盖当前内容'); }
async function absoluteFilePath(args: JsonObject, env: ExecutionEnv, context: Context) {
  const path = String(args.path).replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ').replace(/^@/, '');
  const absolute = await env.absolutePath(path, context);
  if (!absolute.ok) throw absolute.error;
  return absolute.value;
}
async function prepareFile(tx: Tx, conversationId: ConversationId, args: JsonObject, env: ExecutionEnv, context: Context): Promise<JsonObject> {
  const absolute = await absoluteFilePath(args, env, context);
  let canonical: string;
  try { canonical = await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { await lstat(absolute); throw new Error('目标路径已存在，不能创建'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { kind: 'create', path: join(await realpath(dirname(absolute)), basename(absolute)) };
  }
  const file = await open(canonical, 'r');
  try {
    const identity = await identityOf(file);
    const read = (await tx.doc(FileReadsDoc, conversationId)).items.find((item) => item.identity === identity);
    if (!read) throw new Error('目标文件已存在，必须先在当前会话成功读取后才能覆盖或编辑');
    const task = await tx.task(Number(read.readId) as TaskId);
    const result = task?.state.outcome?.status === 'completed' ? task.state.outcome.result as { entryId?: number } : undefined;
    const entry = result?.entryId === undefined ? undefined : await tx.entry(result.entryId as EntryId);
    if (!entry?.model?.some((message) => message.role === 'toolResult' && !message.isError)) throw new Error('当前会话的读取尚未成功完成，请重新读取后修改');
    return { kind: 'overwrite', path: canonical, identity, hash: read.hash, readId: read.readId };
  } finally { await file.close(); }
}
async function originalIntent(args: JsonObject, env: ExecutionEnv, context: Context, precondition?: JsonObject): Promise<FileIntent> {
  return precondition ? precondition as FileIntent : { kind: 'create', path: await absoluteFilePath(args, env, context) };
}
async function verifyFile(file: FileHandle, intent: Exclude<FileIntent, { kind: 'create' }>, context: Context) {
  const current = await stat(intent.path, { bigint: true });
  if (`${current.dev}:${current.ino}` !== intent.identity || await identityOf(file) !== intent.identity || await hashFile(file, context) !== intent.hash) throw conflict();
}
async function validateFile(call: Readonly<RecoveryCall>, context: Context) {
  const intent = await originalIntent(call.args, new NodeExecutionEnv({ cwd: call.cwd }), context, call.precondition);
  if (intent.kind === 'create') {
    try { await lstat(intent.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw new Error('目标文件已存在，不能重试创建；请保留原文件并处理后重试，或停止本轮');
  }
  const file = await open(intent.path, 'r');
  try { await verifyFile(file, intent, context); }
  finally { await file.close(); }
}

const write = createWriteTool();
const registeredWrite = {
  ...write,
  description: 'Write a file in an existing directory. Existing files must first be read in this conversation and must not have changed since that read. New files are created exclusively.',
  replay: 'unsafe' as const,
  executionMode: 'sequential' as const,
};
export const writeTool = recoverableTool(registeredWrite, async (args, env, output, context, precondition) => {
  return executeMutation('write', args, env, output, context, precondition);
}, { prepare: prepareFile, validate: validateFile });

async function writeBytes(file: FileHandle, bytes: Buffer, output: (text: string) => Promise<void>, context: Context) {
  let written = 0;
  while (written < bytes.length) {
    context.abortSignal?.throwIfAborted();
    const chunk = bytes.subarray(written, Math.min(written + 64 * 1024, bytes.length));
    const result = await file.write(chunk, 0, chunk.length, written);
    if (!result.bytesWritten) throw new Error('文件写入未能继续');
    written += result.bytesWritten;
    if (written <= 64 * 1024 || written % (512 * 1024) === 0 || written === bytes.length) await output(`已写入 ${written} / ${bytes.length} 字节\n`);
  }
  context.abortSignal?.throwIfAborted();
  await file.truncate(bytes.length);
}
const normalize = (text: string) => text.replace(/\r\n/g, '\n');
function editedContent(content: string, args: JsonObject) {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const original = content.slice(bom.length);
  const newline = original.indexOf('\n');
  const ending = newline > 0 && original[newline - 1] === '\r' ? '\r\n' : '\n';
  let text = normalize(original);
  const edits = args.edits as Array<{ oldText: string; newText: string }>;
  if (!Array.isArray(edits) || !edits.length) throw new Error('精确编辑至少需要一项替换');
  const matches = edits.map((edit) => {
    const oldText = normalize(edit.oldText);
    if (!oldText) throw new Error('精确编辑的原文本不能为空');
    const start = text.indexOf(oldText);
    if (start < 0) throw new Error('精确编辑未找到原文本，请重新读取；引号、空格和文字必须完全一致');
    if (text.indexOf(oldText, start + 1) !== -1) throw new Error('精确编辑原文本不唯一，请提供更多上下文');
    return { start, end: start + oldText.length, replacement: normalize(edit.newText) };
  }).sort((a, b) => a.start - b.start);
  for (let index = 1; index < matches.length; index++) if (matches[index - 1].end > matches[index].start) throw new Error('精确编辑范围重叠，请合并为一项修改');
  for (const match of matches.toReversed()) text = text.slice(0, match.start) + match.replacement + text.slice(match.end);
  if (text === normalize(original)) throw new Error('精确编辑没有产生内容变化');
  return bom + (ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
}

async function executeMutation(name: 'write' | 'edit', args: JsonObject, env: ExecutionEnv, output: (text: string) => Promise<void>, context: Context, precondition?: JsonObject): Promise<ToolExecutionResult> {
  const intent = await originalIntent(args, env, context, precondition);
  const lock = intent.kind === 'create' ? `path:${intent.path.toLowerCase()}` : intent.identity;
  return withFileLock(lock, async () => {
    if (!(await stat(env.cwd)).isDirectory()) throw new Error('工作目录不可用');
    if (intent.kind === 'create') {
      if (name === 'edit') throw new Error('精确编辑目标不存在，请先读取文件');
      if (!(await stat(dirname(intent.path))).isDirectory()) throw new Error('目标父目录不存在');
      const file = await open(intent.path, 'wx');
      try {
        const identity = await identityOf(file);
        // 文件出现后也加入身份互斥，防止其他会话基于部分内容与创建过程交错修改。
        return await withFileLock(identity, async () => {
          const current = await stat(intent.path, { bigint: true });
          if (`${current.dev}:${current.ino}` !== identity || (await file.stat()).size !== 0) throw conflict();
          await writeBytes(file, Buffer.from(String(args.content), 'utf8'), output, context);
          return { output: [{ type: 'text', text: `Successfully wrote to ${args.path}` }] };
        }, context);
      } finally { await file.close(); }
    }
    const file = await open(intent.path, 'r+');
    try {
      await verifyFile(file, intent, context);
      let content = String(args.content);
      if (name === 'edit') {
        const original = await file.readFile();
        if (createHash('sha256').update(original).digest('hex') !== intent.hash) throw conflict();
        content = editedContent(original.toString('utf8'), args);
        await verifyFile(file, intent, context);
      }
      await writeBytes(file, Buffer.from(content, 'utf8'), output, context);
      return { output: [{ type: 'text', text: name === 'edit' ? `Successfully replaced ${(args.edits as unknown[]).length} block(s) in ${args.path}.` : `Successfully wrote to ${args.path}` }] };
    } finally { await file.close(); }
  }, context);
}

const edit = createEditTool();
export const editTool = recoverableTool({ ...edit, description: 'Precisely edit an existing file after reading it in this conversation. oldText must match uniquely and exactly, with LF/CRLF equivalence only. Changes after the read cause a conflict; read again before retrying.' }, async (args, env, output, context, precondition) => executeMutation('edit', args, env, output, context, precondition), {
  prepare: async (...args) => {
    const intent = await prepareFile(...args);
    if (intent.kind === 'create') throw new Error('精确编辑目标不存在，请先读取文件');
    return { ...intent, kind: 'edit' };
  }, validate: validateFile,
});
