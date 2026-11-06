import { spawn } from 'node:child_process';
import { join } from 'node:path';

const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择已有文件夹作为工作区'
$dialog.ShowNewFolderButton = $false
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write(($dialog.SelectedPath | ConvertTo-Json -Compress))
  } else {
    [Console]::Write('null')
  }
} finally {
  $dialog.Dispose()
}
`;
let choosing = false;

export async function selectLocalDirectory(): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('当前系统不支持 Windows 文件夹选择器，请填写文件夹路径');
  if (choosing) throw new Error('文件夹选择器已打开，请先完成或取消当前选择');
  choosing = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { output += chunk; });
      const unavailable = () => reject(new Error('无法打开 Windows 文件夹选择器，请填写文件夹路径或稍后重试'));
      child.once('error', unavailable);
      child.once('close', (code) => {
        if (code !== 0) { unavailable(); return; }
        try {
          const path: unknown = JSON.parse(output);
          if (path !== null && (typeof path !== 'string' || !path.trim())) throw new Error();
          resolve(path);
        } catch { unavailable(); }
      });
    });
  } finally { choosing = false; }
}
