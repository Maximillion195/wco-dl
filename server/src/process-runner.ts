import { spawn } from 'child_process';

export type ProcessOutcome = 'completed' | 'failed' | 'timed_out';

export interface ProcessResult {
  outcome: ProcessOutcome;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  /** The process is killed if it produces no output for this long. */
  idleTimeoutMs: number;
  /** Delay between SIGTERM and SIGKILL when killing a timed out process. */
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface RunningProcess {
  pid: number;
  result: Promise<ProcessResult>;
  kill: () => void;
}

// A dedicated process group lets us kill the worker processes Python spawns
// for multi-threaded downloads, not just the parent.
const useProcessGroup = process.platform !== 'win32';

/**
 * Starts a process without a shell. Resolves once the process has actually
 * spawned and rejects if it could not be started (e.g. binary not found).
 */
export function startProcess(
  options: RunProcessOptions,
): Promise<RunningProcess> {
  const { command, args, idleTimeoutMs, killGraceMs = 10000 } = options;

  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: useProcessGroup,
      windowsHide: true,
    });

    let spawned = false;
    let timedOut = false;
    let lastError: string | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const signalTree = (signal: NodeJS.Signals) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (useProcessGroup && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        child.kill(signal);
      }
    };

    const kill = () => {
      signalTree('SIGTERM');
      killTimer ??= setTimeout(() => signalTree('SIGKILL'), killGraceMs);
      killTimer.unref();
    };

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        kill();
      }, idleTimeoutMs);
    };

    const result = new Promise<ProcessResult>((resolveResult) => {
      child.on('exit', (exitCode, signal) => {
        clearTimeout(idleTimer);
        clearTimeout(killTimer);

        let outcome: ProcessOutcome;
        let error = lastError;
        if (timedOut) {
          outcome = 'timed_out';
          error ??= `No output for ${Math.round(idleTimeoutMs / 1000)}s, process was killed`;
        } else if (exitCode === 0) {
          outcome = 'completed';
        } else {
          outcome = 'failed';
          error ??= signal
            ? `Process was terminated by ${signal}`
            : `Process exited with code ${exitCode}`;
        }
        resolveResult({ outcome, exitCode, signal, error });
      });
    });

    const handleOutput = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      resetIdleTimer();
      options.onOutput?.(data.toString(), stream);
    };
    child.stdout.on('data', handleOutput('stdout'));
    child.stderr.on('data', handleOutput('stderr'));

    child.on('error', (err) => {
      lastError = err.message;
      if (!spawned) {
        rejectStart(err);
      }
    });

    child.on('spawn', () => {
      spawned = true;
      resetIdleTimer();
      resolveStart({ pid: child.pid, result, kill });
    });
  });
}
