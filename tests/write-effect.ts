import { watch } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workbench } from './fixtures';

export function crashAfterFileEffect(workbench: Workbench, directory: string, name: string) {
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
        const first = Buffer.alloc(1);
        try { if ((await reader.read(first, 0, 1, 0)).bytesRead !== 1 || claimed) return; }
        finally { await reader.close(); }
        if (claimed) return;
        claimed = true;
        await workbench.crash();
        clearTimeout(timer);
        resolve((await stat(path)).size);
      })().catch(reject);
    });
    observer.on('error', reject);
  });
  return { crashed, close() { clearTimeout(timer); observer.close(); } };
}
