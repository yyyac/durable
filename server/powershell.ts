import { OutputBuffer } from '@earendil-works/chord/output';
import { createPowerShellTool } from '@earendil-works/pi-durable/tools';
import type { ToolDiagnostic, ToolExecutionApi } from '@earendil-works/pi-durable';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { recoverableTool } from './tool-recovery.js';

const powershell = createPowerShellTool();
async function powerShellProgram() {
  for (const program of ['pwsh.exe', 'powershell.exe']) for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const path = join(directory.replace(/^"|"$/g, ''), program);
    try { await access(path); return path; } catch {}
  }
  throw new Error('未找到可启动的 PowerShell，请安装 PowerShell 或检查 PATH');
}

function monitoredEnvironment(env: ExecutionEnv): ExecutionEnv {
  return new Proxy(env, { get(target, key) {
    if (key === 'exec') return (async (command, options, context) => {
      if (typeof command === 'string') throw new Error('命令必须通过 PowerShell 参数执行');
      context.abortSignal?.throwIfAborted();
      const pipe = `\\\\.\\pipe\\durable-command-${randomUUID()}`;
      let connection: Socket | undefined;
      const server = createServer((socket) => { connection = socket; socket.on('error', () => {}); });
      try {
        server.listen(pipe);
        await once(server, 'listening');
        return await target.exec([process.execPath, fileURLToPath(new URL('./powershell-process.ts', import.meta.url)), pipe, ...command], options, context);
      } finally {
        connection?.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }) satisfies ExecutionEnv['exec'];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export const powershellTool = recoverableTool(powershell, async (args, env, output, context) => {
  const retained = new OutputBuffer({ maxBytes: 50 * 1024, maxLines: 2000, retain: 'tail' });
  const diagnostics: ToolDiagnostic[] = [];
  let pending = Promise.resolve();
  let outputError: unknown;
  const api: Pick<ToolExecutionApi, 'env' | 'output' | 'outputWindow' | 'retainedOutput' | 'diagnostic'> = {
    env: monitoredEnvironment(env),
    output(text: string | Uint8Array) {
      retained.push(text);
      const chunk = typeof text === 'string' ? text : new TextDecoder().decode(text);
      pending = pending.then(() => output(chunk)).catch((error) => { outputError ??= error; });
    },
    outputWindow: undefined,
    retainedOutput() {
      const value = retained.snapshot();
      return { text: value.text, truncated: value.droppedBytes > 0 || value.droppedLines > 0 };
    },
    diagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
  };
  try {
    const command = createPowerShellTool({ programs: [await powerShellProgram()] });
    const result = await command.execute(args as Parameters<typeof powershell.execute>[0], api as ToolExecutionApi, context);
    const value = result.structuredOutput as { exitCode: number };
    return { ...result, output: [{ type: 'text' as const, text: `${retained.snapshot().text}\n退出码：${value.exitCode}` }], diagnostics: [...diagnostics, ...(result.diagnostics ?? [])] };
  } catch (error) {
    context.abortSignal?.throwIfAborted();
    return { isError: true, output: [{ type: 'text' as const, text: retained.snapshot().text }], diagnostics: [...diagnostics, { severity: 'error' as const, code: 'tool_error', message: (error as Error).message }] };
  } finally {
    // 原生输出回调同步返回，终态必须等待已排队的持久进度，防止迟到输出覆盖结果。
    await pending;
    if (outputError) throw outputError;
  }
});
