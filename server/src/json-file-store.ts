import { promises as fs } from 'fs';
import * as path from 'path';

type Loaded<T> = { from: 'file' | 'backup' | 'nothing'; value: T };

/**
 * One JSON file that several parts of the app change, such as the list of followed shows.
 *
 * - `update` applies one change at a time, each to a fresh read, so two changes made close together both land.
 *   Keep slow work (network calls) outside the change: everything else waits behind it.
 * - The file is replaced in one step (written beside it, then renamed), so a restart never leaves half a file.
 *   The version before is kept as `<file>.bak`.
 * - A file that cannot be read is never taken for an empty one. The backup is used instead; with no usable
 *   backup the read fails and nothing is written, so what is on disk can still be mended by hand.
 */
export class JsonFileStore<T extends object> {
  private last: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly empty: () => T,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  private get backup() { return this.file + '.bak'; }

  async read(): Promise<T> {
    return (await this.load()).value;
  }

  update(change: (value: T) => void | Promise<void>): Promise<T> {
    const run = async () => {
      const loaded = await this.load();
      await change(loaded.value);
      await this.write(loaded);
      return loaded.value;
    };
    const next = this.last.then(run, run);
    this.last = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<Loaded<T>> {
    const main = await readJson<T>(this.file);
    if (main.kind === 'ok') return { from: 'file', value: main.value };
    const spare = await readJson<T>(this.backup);
    if (spare.kind === 'ok') {
      this.warn(`${this.file} ${main.kind === 'missing' ? 'is missing' : 'cannot be read'}: using ${this.backup}`);
      return { from: 'backup', value: spare.value };
    }
    if (main.kind === 'missing') return { from: 'nothing', value: this.empty() };
    throw new Error(`${this.file} cannot be read and there is no usable ${path.basename(this.backup)}. Nothing was changed: mend or remove the file.`);
  }

  private async write(loaded: Loaded<T>) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(JSON.stringify(loaded.value, null, 1));
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Only a file that was just read whole becomes the backup: a damaged one must not replace a good backup.
    if (loaded.from === 'file') await fs.copyFile(this.file, this.backup).catch(() => undefined);
    await fs.rename(tmp, this.file);
  }
}

async function readJson<T>(file: string): Promise<{ kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'bad' }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'bad' };
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? { kind: 'ok', value } : { kind: 'bad' };
  } catch {
    return { kind: 'bad' };
  }
}
