import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireFileLock, __test } from '../lib/file-lock.js';

test('same-directory O_EXCL lock serializes writers and releases by token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-lock-test-'));
  const target = join(root, 'cordis.patch.yml');
  await writeFile(target, '# target\n');
  const first = await acquireFileLock(target);
  await assert.rejects(acquireFileLock(target), { code: 'write-locked' });
  await first.release();
  const second = await acquireFileLock(target);
  await second.release();
  await assert.rejects(readFile(`${target}.ds-hub.lock`), { code: 'ENOENT' });
  await rm(root, { recursive: true, force: true });
});

test('expired lock with a live owner fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-lock-test-'));
  const target = join(root, 'cordis.patch.yml');
  await writeFile(target, '# target\n');
  const lease = await acquireFileLock(target);
  await assert.rejects(acquireFileLock(target, {
    now: Date.now() + __test.DEFAULT_STALE_MS + 10_000,
    isProcessAlive: (pid) => pid === process.pid,
  }), { code: 'write-locked' });
  await lease.release();
  await rm(root, { recursive: true, force: true });
});

test('expired lock is reclaimed only after its recorded owner is dead', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-lock-test-'));
  const target = join(root, 'cordis.patch.yml');
  const lockPath = `${target}.ds-hub.lock`;
  await writeFile(target, '# target\n');
  await writeFile(lockPath, `${JSON.stringify({ version: 1, token: 'dead', pid: 999_999, createdAt: 1 })}\n`, { mode: 0o600 });
  const lease = await acquireFileLock(target, {
    now: Date.now() + __test.DEFAULT_STALE_MS + 10_000,
    isProcessAlive: () => false,
  });
  assert.notEqual(lease.token, 'dead');
  await lease.release();
  await rm(root, { recursive: true, force: true });
});
