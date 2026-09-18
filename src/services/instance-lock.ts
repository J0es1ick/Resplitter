import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function acquireInstanceLock(file: string): () => void {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    const pid = Number(readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('INVALID_INSTANCE_LOCK');
    try {
      process.kill(pid, 0);
      throw new Error('INSTANCE_ALREADY_RUNNING');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
    unlinkSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  return () => {
    if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
  };
}
