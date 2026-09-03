import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';

const DEFAULT_STALE_MS = 5 * 60_000;

function lockError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.state = 'unchanged';
  if (details !== undefined) error.details = details;
  return error;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function lockSnapshot(lockPath) {
  const [info, content] = await Promise.all([
    stat(lockPath),
    readFile(lockPath, 'utf8'),
  ]);
  let metadata = null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') metadata = parsed;
  } catch {
    // An empty lock can be left behind if a process dies immediately after O_EXCL.
  }
  return { info, metadata };
}

function lockIsExpired(snapshot, now, staleMs) {
  const createdAt = Number(snapshot.metadata?.createdAt);
  const reference = Number.isFinite(createdAt) ? Math.max(createdAt, snapshot.info.mtimeMs) : snapshot.info.mtimeMs;
  return now - reference > staleMs;
}

async function writeLease(handle, metadata) {
  await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
  await handle.sync();
}

async function createLease(lockPath, targetPath, now) {
  const token = randomUUID();
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    await writeLease(handle, {
      version: 1,
      token,
      pid: process.pid,
      createdAt: now,
      target: targetPath,
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
  let released = false;
  return {
    lockPath,
    token,
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      const current = await readFile(lockPath, 'utf8').catch(() => '');
      let currentToken = '';
      try { currentToken = String(JSON.parse(current)?.token || ''); } catch { /* fail below */ }
      if (currentToken !== token) {
        throw lockError('write-lock-release-failed', 'DS Hub 写锁身份发生变化；为避免删除其他进程的锁，未自动清理', { lockPath });
      }
      await unlink(lockPath);
    },
  };
}

/**
 * Acquire a cooperative, same-directory O_EXCL lock for one managed file.
 * A stale lock is reclaimed only after a second exclusive reclaim lock is held
 * and the recorded owner is confirmed dead. Live or ambiguous locks fail closed.
 */
export async function acquireFileLock(targetPath, options = {}) {
  const staleMs = Number.isFinite(options.staleMs) && options.staleMs >= 1_000
    ? options.staleMs
    : DEFAULT_STALE_MS;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const isProcessAlive = typeof options.isProcessAlive === 'function' ? options.isProcessAlive : processAlive;
  const lockPath = `${targetPath}.ds-hub.lock`;
  const reclaimPath = `${lockPath}.reclaim`;

  try {
    return await createLease(lockPath, targetPath, now);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let snapshot;
  try {
    snapshot = await lockSnapshot(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return acquireFileLock(targetPath, options);
    throw error;
  }
  if (!lockIsExpired(snapshot, now, staleMs) || isProcessAlive(Number(snapshot.metadata?.pid))) {
    throw lockError('write-locked', '另一个 DS Hub 写入仍持有配置锁；本次未修改', {
      lockPath,
      ownerPid: Number.isSafeInteger(Number(snapshot.metadata?.pid)) ? Number(snapshot.metadata.pid) : null,
      stale: lockIsExpired(snapshot, now, staleMs),
    });
  }

  let reclaimHandle;
  try {
    reclaimHandle = await open(reclaimPath, 'wx', 0o600);
    await writeLease(reclaimHandle, { version: 1, pid: process.pid, createdAt: now, token: randomUUID() });
  } catch (error) {
    await reclaimHandle?.close?.().catch(() => undefined);
    if (error?.code === 'EEXIST') {
      throw lockError('write-locked', '另一个进程正在核验过期写锁；本次未修改', { lockPath });
    }
    throw error;
  }

  try {
    let confirmed;
    try {
      confirmed = await lockSnapshot(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      confirmed = null;
    }
    if (confirmed) {
      if (!lockIsExpired(confirmed, now, staleMs) || isProcessAlive(Number(confirmed.metadata?.pid))) {
        throw lockError('write-locked', '配置锁仍有效；本次未修改', { lockPath });
      }
      await unlink(lockPath);
    }
    try {
      return await createLease(lockPath, targetPath, now);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw lockError('write-locked', '过期锁清理后已有其他进程取得写锁；本次未修改', { lockPath });
      }
      throw error;
    }
  } finally {
    await reclaimHandle.close().catch(() => undefined);
    await unlink(reclaimPath).catch(() => undefined);
  }
}

export async function withFileLock(targetPath, task, options = {}) {
  const lease = await acquireFileLock(targetPath, options);
  let taskError = null;
  try {
    return await task();
  } catch (error) {
    taskError = error;
    throw error;
  } finally {
    try {
      await lease.release();
    } catch (releaseError) {
      if (!taskError) throw releaseError;
      taskError.lockReleaseError = releaseError.message;
    }
  }
}

export const __test = { DEFAULT_STALE_MS, lockIsExpired, processAlive };
