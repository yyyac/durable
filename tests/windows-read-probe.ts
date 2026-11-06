import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

export async function readHandleProbe(path: string) {
  const script = `[Console]::Out.WriteLine('ready'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null; try { $probeFile = [System.IO.File]::Open($env:READ_PROBE_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None); $probeFile.Dispose(); [Console]::Out.WriteLine('free') } catch { $probeError = $_.Exception.GetBaseException(); if (($probeError.HResult -band 65535) -in @(32,33)) { [Console]::Out.WriteLine('reading') } else { throw } }`;
  const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, READ_PROBE_PATH: path }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('文件读取探针未启动')), 5000);
    const ready = () => { if (output.includes('ready')) { clearTimeout(timer); child.stdout.off('data', ready); resolve(); } };
    child.stdout.on('data', ready);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); if (!output.includes('ready')) reject(new Error('文件读取探针提前结束')); });
    ready();
  });
  return {
    async check() {
      const ended = once(child, 'exit');
      child.stdin.end('\n');
      const [code] = await ended;
      if (code !== 0) throw new Error('无法检查真实文件读取句柄');
      return output.includes('reading');
    },
    close() { if (child.exitCode === null) child.kill(); },
  };
}
