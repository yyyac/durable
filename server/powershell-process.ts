import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';

const [mode, pipe, program, ...args] = process.argv.slice(2);
if (mode !== 'monitor') {
  // 直属子进程可能随后端被系统终止；监测器独立存活至管道断连后清理完命令树。
  const detached = spawn(process.execPath, [process.argv[1], 'monitor', ...process.argv.slice(2)], { detached: true, stdio: 'inherit', windowsHide: true });
  detached.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  detached.once('exit', (code) => { process.exitCode = code ?? 1; });
} else {
  if (!pipe || !program) throw new Error('命令进程参数无效');
  const connection = connect(pipe);
  await once(connection, 'connect');
  const child = spawn(program, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  let stopping = false;
  let finished = false;
  function stopOrphan() {
    if (stopping || finished || !child.pid) return;
    stopping = true;
    // 专用管道在后端死亡时由系统关闭，只终止本启动器仍持有的命令及其后代。
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    killer.once('error', (failure) => { console.error(failure.message); child.kill(); });
  }
  connection.once('close', stopOrphan);
  connection.once('error', stopOrphan);
  child.once('error', (error) => { finished = true; connection.destroy(); console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code) => { finished = true; connection.destroy(); process.exitCode = code ?? 1; });
}
