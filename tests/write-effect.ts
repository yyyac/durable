import { watch } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workbench } from './fixtures';

export function crashAfterFileEffect(workbench: Workbench, directory: string, name: string, previous?: Buffer) {
  let claimed = false;
  let observer: ReturnType<typeof watch>;
  let timer: ReturnType<typeof setTimeout>;
  const crashed = new Promise<number>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('没有观察到实际文件写入')), 20_000);
    observer = watch(directory, (_event, filename) => {
      if (claimed || filename !== name) return;
      void (async () => {
        const path = join(directory, name);
        const info = await stat(path);
        if (info.size === 0 || claimed) return;
        const reader = await open(path, 'r');
        const first = Buffer.alloc(Math.min(64, info.size));
        try {
          if ((await reader.read(first, 0, first.length, 0)).bytesRead !== first.length || claimed) return;
          if (previous && info.size === previous.length && first.equals(previous.subarray(0, first.length))) return;
        }
        finally { await reader.close(); }
        if (claimed) return;
        claimed = true;
        clearTimeout(timer);
        await workbench.crash();
        resolve((await stat(path)).size);
      })().catch(reject);
    });
    observer.on('error', reject);
  });
  return { crashed, close() { clearTimeout(timer); observer.close(); } };
}
