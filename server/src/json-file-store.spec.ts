import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonFileStore } from './json-file-store';

describe('JsonFileStore', () => {
  let dir: string;
  let file: string;
  let warnings: string[];
  const store = () => new JsonFileStore<Record<string, number>>(file, () => ({}), (m) => warnings.push(m));
  const onDisk = async (f = file) => JSON.parse(await fs.readFile(f, 'utf8'));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
    file = path.join(dir, 'config', 'things.json');
    warnings = [];
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

  it('reads a missing file as empty and creates it on the first change', async () => {
    const s = store();
    expect(await s.read()).toEqual({});
    await s.update((v) => { v.a = 1; });
    expect(await onDisk()).toEqual({ a: 1 });
    expect(warnings).toEqual([]);
  });

  it('lands every change when many are made at the same moment', async () => {
    const s = store();
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.update(async (v) => {
      await new Promise((r) => setTimeout(r, (i * 7) % 5));     // a slow change must not let the next one start early
      v['k' + i] = i;
    })));
    expect(Object.keys(await onDisk())).toHaveLength(25);
  });

  it('carries on after a change that throws', async () => {
    const s = store();
    await s.update((v) => { v.a = 1; });
    await expect(s.update(() => { throw new Error('no'); })).rejects.toThrow('no');
    await s.update((v) => { v.b = 2; });
    expect(await onDisk()).toEqual({ a: 1, b: 2 });
  });

  it('uses the version before when the file is cut short, and says so', async () => {
    const s = store();
    await s.update((v) => { v.a = 1; });
    await s.update((v) => { v.b = 2; });                // the backup now holds { a: 1 }
    await fs.writeFile(file, '{"a": 1, "b"');           // a write cut off by a restart
    expect(await s.read()).toEqual({ a: 1 });
    expect(warnings.join(' ')).toMatch(/cannot be read: using .*things\.json\.bak/);
    await s.update((v) => { v.c = 3; });
    expect(await onDisk()).toEqual({ a: 1, c: 3 });
    expect(await onDisk(file + '.bak')).toEqual({ a: 1 });   // the damaged file did not replace the good backup
  });

  it('fails and writes nothing when neither the file nor its backup can be read', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json');
    const s = store();
    await expect(s.read()).rejects.toThrow(/cannot be read and there is no usable things\.json\.bak/);
    await expect(s.update((v) => { v.a = 1; })).rejects.toThrow(/Nothing was changed/);
    expect(await fs.readFile(file, 'utf8')).toBe('not json');
  });

  it('does not take a list or a bare value for the file it expects', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '[]');
    await expect(store().read()).rejects.toThrow(/cannot be read/);
  });
});
