import { createHash } from 'node:crypto';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Context } from '@earendil-works/chord/context';
import { defineDoc } from '@earendil-works/pi-durable';
import { FileError, LineScanner, type BinaryReader, type ExecutionEnv, type FileInfo } from '@earendil-works/pi-durable/env';

export type FileVersion = { path: string; identity: string; hash: string; readId: string };
export const FileReadsDoc = defineDoc({
  kind: 'workbench.file-reads', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: (): { items: FileVersion[] } => ({ items: [] }), checkpointWhen: () => true,
});
const queues = new Map<string, Promise<void>>();
export async function withFileLock<T>(identity: string, operation: () => Promise<T>, context: Context) {
  const previous = queues.get(identity) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => done);
  queues.set(identity, tail);
  const signal = context.abortSignal;
  let abort: (() => void) | undefined;
  try {
    await (signal ? Promise.race([previous, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error('已停止'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]) : previous);
    signal?.throwIfAborted(); return await operation();
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    release();
    void tail.then(() => { if (queues.get(identity) === tail) queues.delete(identity); });
  }
}
export async function identityOf(file: FileHandle) {
  const info = await file.stat({ bigint: true });
  if (!info.isFile()) throw new Error('目标不是普通文件');
  return `${info.dev}:${info.ino}`;
}
export async function hashFile(file: FileHandle, context: Context) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  for (let position = 0;;) {
    context.abortSignal?.throwIfAborted();
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) return hash.digest('hex');
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
  }
}
function failure(error: unknown, path: string) {
  if (error instanceof FileError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  return new FileError(code === 'ENOENT' ? 'not_found' : code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : code === 'ABORT_ERR' ? 'aborted' : 'invalid', (error as Error).message, path);
}

export function versionedReadEnvironment(env: ExecutionEnv) {
  let version: Omit<FileVersion, 'readId'> | undefined;
  const checked = new Proxy(env, {
    get(target, key) {
      if (key === 'openBinaryReader') return async (path: string, _options: unknown, context: Context) => {
        let file: FileHandle | undefined;
        try {
          context.abortSignal?.throwIfAborted();
          const canonical = await realpath(path);
          file = await open(canonical, 'r');
          const identity = await identityOf(file);
          const opened = file;
          let scanned = false;
          let prefix = Buffer.alloc(0);
          let selected = Buffer.alloc(0);
          let selectedStart = 0;
          const info = async (): Promise<FileInfo> => {
            const stats = await opened.stat();
            return { name: basename(canonical), path: canonical, kind: 'file', size: stats.size, mtimeMs: stats.mtimeMs };
          };
          const reader: BinaryReader = {
            async info(context) {
              try { context.abortSignal?.throwIfAborted(); return { ok: true, value: await info() }; }
              catch (error) { return { ok: false, error: failure(error, canonical) }; }
            },
            async read(offset, length, context) {
              try {
                context.abortSignal?.throwIfAborted();
                if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) throw new Error('读取范围无效');
                if (scanned) {
                  const end = Math.min(offset + length, (await info()).size);
                  if (offset >= selectedStart && end <= selectedStart + selected.length) return { ok: true, value: selected.subarray(offset - selectedStart, end - selectedStart) };
                  if (offset + length <= prefix.length) return { ok: true, value: prefix.subarray(offset, offset + length) };
                  throw new Error('读取期间文件范围已变化，请重新读取');
                }
                const size = (await info()).size;
                const bytes = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
                let total = 0;
                while (total < bytes.length) {
                  context.abortSignal?.throwIfAborted();
                  const result = await opened.read(bytes, total, bytes.length - total, offset + total);
                  if (!result.bytesRead) break;
                  total += result.bytesRead;
                }
                const value = bytes.subarray(0, total);
                if (offset === 0 && total === size) version = { path: canonical, identity, hash: createHash('sha256').update(value).digest('hex') };
                return { ok: true, value };
              } catch (error) { return { ok: false, error: failure(error, canonical) }; }
            },
            async scanLines(options, context) {
              try {
                const scanner = new LineScanner(options.startLine, options.endLine);
                const hash = createHash('sha256');
                const buffer = Buffer.alloc(64 * 1024);
                const chunks: Buffer[] = [];
                let kept = 0, lines = 0, start: number | undefined = options.startLine === 0 ? 0 : undefined;
                for (let position = 0;;) {
                  context.abortSignal?.throwIfAborted();
                  const { bytesRead } = await opened.read(buffer, 0, buffer.length, position);
                  if (!bytesRead) break;
                  const bytes = buffer.subarray(0, bytesRead);
                  if (position === 0) prefix = Buffer.from(bytes.subarray(0, 32));
                  hash.update(bytes); scanner.push(bytes);
                  if (start === undefined) for (let index = bytes.indexOf(10); index !== -1; index = bytes.indexOf(10, index + 1)) {
                    if (++lines === options.startLine) { start = position + index + 1; break; }
                  }
                  // 原生读取最多返回首个64KiB块；额外三字节保留UTF-8 BOM偏移。
                  if (start !== undefined && kept < 64 * 1024 + 3) {
                    const from = Math.max(0, start - position);
                    const chunk = bytes.subarray(from, Math.min(bytes.length, from + 64 * 1024 + 3 - kept));
                    chunks.push(Buffer.from(chunk)); kept += chunk.length;
                  }
                  position += bytesRead;
                }
                const value = scanner.finish();
                selectedStart = start ?? value.start; selected = Buffer.concat(chunks); scanned = true;
                version = { path: canonical, identity, hash: hash.digest('hex') };
                return { ok: true, value };
              } catch (error) { return { ok: false, error: failure(error, canonical) }; }
            },
            async close() { await opened.close(); },
          };
          return { ok: true, value: reader };
        } catch (error) { await file?.close(); return { ok: false, error: failure(error, path) }; }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { env: checked, version: () => version };
}
