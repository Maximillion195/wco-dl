import { startProcess } from './process-runner';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('startProcess', () => {
  it('rejects when the command cannot be spawned', async () => {
    await expect(
      startProcess({
        command: 'definitely-not-a-real-binary-wco',
        args: [],
        idleTimeoutMs: 1000,
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('reports a successful exit and streams output', async () => {
    const chunks: string[] = [];
    const running = await startProcess({
      command: process.execPath,
      args: ['-e', 'console.log("hello")'],
      idleTimeoutMs: 5000,
      onOutput: (chunk) => chunks.push(chunk),
    });

    await expect(running.result).resolves.toMatchObject({
      outcome: 'completed',
      exitCode: 0,
    });
    expect(chunks.join('')).toContain('hello');
  });

  it('reports a non-zero exit as failed', async () => {
    const running = await startProcess({
      command: process.execPath,
      args: ['-e', 'console.error("boom"); process.exit(3)'],
      idleTimeoutMs: 5000,
    });

    await expect(running.result).resolves.toMatchObject({
      outcome: 'failed',
      exitCode: 3,
      error: 'Process exited with code 3',
    });
  });

  it('keeps a process alive while it produces output', async () => {
    const running = await startProcess({
      command: process.execPath,
      args: [
        '-e',
        'let n = 0; const t = setInterval(() => { console.log(n); if (++n === 6) { clearInterval(t); } }, 100);',
      ],
      idleTimeoutMs: 300,
    });

    await expect(running.result).resolves.toMatchObject({
      outcome: 'completed',
    });
  });

  if (process.platform !== 'win32') {
    it('kills an idle process and its children on timeout', async () => {
      const chunks: string[] = [];
      const running = await startProcess({
        command: 'sh',
        args: ['-c', 'sleep 30 & echo "child $!"; wait'],
        idleTimeoutMs: 300,
        killGraceMs: 200,
        onOutput: (chunk) => chunks.push(chunk),
      });

      const result = await running.result;
      expect(result.outcome).toBe('timed_out');
      expect(result.error).toMatch(/No output/);

      const childPid = Number(/child (\d+)/.exec(chunks.join(''))?.[1]);
      expect(childPid).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(isAlive(childPid)).toBe(false);
    });

    it('escalates to SIGKILL when SIGTERM is ignored', async () => {
      const running = await startProcess({
        command: 'sh',
        args: ['-c', 'trap "" TERM; echo ready; sleep 30'],
        idleTimeoutMs: 200,
        killGraceMs: 200,
      });

      await expect(running.result).resolves.toMatchObject({
        outcome: 'timed_out',
        signal: 'SIGKILL',
      });
    });
  }
});
