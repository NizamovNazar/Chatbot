import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function readJsonStrict(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw Object.assign(new Error(`STORAGE_CORRUPT: ${path.basename(file)}. Original file preserved; restore a verified backup.`), {code:'STORAGE_CORRUPT'}); }
}

export function atomicJsonWrite(file, value) {
  const body = JSON.stringify(value, null, 2);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    // Only this operation's own temporary file; never remove the destination.
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** One process: serialize read-modify-write, expose only committed immutable snapshots. */
export function createDurableState(initial, persist, onCommit = () => {}) {
  let state = freeze(structuredClone(initial)), queue = Promise.resolve();
  return {
    get: () => state,
    initialize(value) { state = freeze(structuredClone(value)); onCommit(state); },
    update(change) {
      const job = async () => {
        const draft = structuredClone(state);
        const result = await change(draft);
        await persist(draft);
        state = freeze(draft);
        onCommit(state);
        return result;
      };
      const next = queue.then(job);
      queue = next.catch(() => {});
      return next;
    },
    idle: () => queue,
  };
}
