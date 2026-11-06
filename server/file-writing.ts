import { open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createWriteTool } from '@earendil-works/pi-durable/tools';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { recoverableTool } from './tool-recovery.js';

export function newFileEnvironment(env: ExecutionEnv, progress: (text: string) => Promise<void>): ExecutionEnv {
  return new Proxy(env, {
    get(target, key) {
      if (key === 'writeFile') return async (path: string, content: string | Uint8Array, context: { abortSignal?: AbortSignal }) => {
        context.abortSignal?.throwIfAborted();
        if (!(await stat(target.cwd)).isDirectory()) throw new Error('工作目录不可用');
        if (!(await stat(dirname(path))).isDirectory()) throw new Error('目标父目录不存在');
        const file = await open(path, 'wx');
        try {
          const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
          let written = 0;
          while (written < bytes.length) {
            context.abortSignal?.throwIfAborted();
            const chunk = bytes.subarray(written, Math.min(written + 64 * 1024, bytes.length));
            const result = await file.write(chunk);
            if (result.bytesWritten === 0) throw new Error('文件写入未能继续');
            written += result.bytesWritten;
            if (written <= 64 * 1024 || written % (512 * 1024) === 0 || written === bytes.length) await progress(`已写入 ${written} / ${bytes.length} 字节\n`);
          }
          return { ok: true, value: undefined };
        } finally { await file.close(); }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const write = createWriteTool();
const registeredWrite = {
  ...write,
  description: 'Create a new file in an existing directory. Refuses to overwrite an existing file.',
  replay: 'unsafe' as const,
  executionMode: 'sequential' as const,
};
export const writeTool = recoverableTool(registeredWrite, async (args, env, output, context) => {
  const checked = newFileEnvironment(env, output);
  return write.execute(args as Parameters<typeof write.execute>[0], { env: checked } as Parameters<typeof write.execute>[1], context);
});
