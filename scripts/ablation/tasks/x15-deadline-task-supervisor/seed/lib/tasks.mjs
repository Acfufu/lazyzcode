import { spawn } from 'node:child_process';

export function runTask(task) {
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});

    let timedOut = false;
    const budgetTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, task.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(budgetTimer);
      resolve({
        name: task.name,
        status: timedOut ? 'failed' : code === 0 ? 'ok' : 'failed',
        exitCode: code,
        timedOut,
      });
    });
  });
}
