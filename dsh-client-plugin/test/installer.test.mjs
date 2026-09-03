import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireFileLock } from '../lib/file-lock.js';
import { __test, runInstallTransaction } from '../scripts/install-dsh-hub.mjs';

test('installer patch block preserves existing comments and is idempotent', () => {
  const original = '# operator comment\n- insert:\n    - id: other\n      name: other\n';
  const path = '/tmp/profile/cordis.patch.yml';
  const once = __test.replaceInstallBlock(original, path);
  const twice = __test.replaceInstallBlock(once, path);
  assert.equal(twice, once);
  assert.ok(once.startsWith(original));
  assert.match(once, /profilePatchPath: "\/tmp\/profile\/cordis\.patch\.yml"/);
});

test('installer converts a fresh profile empty-list placeholder into a valid list', () => {
  const patched = __test.replaceInstallBlock('# keep\n[]\n', '/tmp/profile/cordis.patch.yml');
  assert.equal(patched.includes('\n[]\n'), false);
  assert.match(patched, /^# keep/m);
  assert.match(patched, /^- id: "ui-ds-hub"/m);
});

test('installer refuses malformed managed markers', () => {
  assert.throws(() => __test.replaceInstallBlock('# >>> DS HUB INSTALL\n', '/tmp/profile/cordis.patch.yml'));
});

test('installer forwards the selected DSH home to child CLI calls', () => {
  assert.equal(__test.childEnv({ DSH_HOME: '/tmp/selected-dsh-home' }).DSH_HOME, '/tmp/selected-dsh-home');
});

test('installer patch write uses the preflight bytes as CAS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-installer-test-'));
  const path = join(root, 'cordis.patch.yml');
  await writeFile(path, '# first\n');
  await writeFile(path, '# external edit\n');
  await assert.rejects(__test.atomicWriteWithBackup(path, '# desired\n', 'test', '# first\n'), {
    code: 'revision-conflict',
  });
  assert.equal(await readFile(path, 'utf8'), '# external edit\n');
  await rm(root, { recursive: true, force: true });
});

test('installer patch write fails closed while another writer holds the file lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-installer-test-'));
  const path = join(root, 'cordis.patch.yml');
  await writeFile(path, '# first\n');
  const lease = await acquireFileLock(path);
  await assert.rejects(__test.atomicWriteWithBackup(path, '# desired\n', 'test', '# first\n'), {
    code: 'write-locked',
  });
  assert.equal(await readFile(path, 'utf8'), '# first\n');
  await lease.release();
  await rm(root, { recursive: true, force: true });
});

test('transaction rolls back newly created preset and package in reverse order', async () => {
  const calls = [];
  await assert.rejects(runInstallTransaction({
    installPackage: async () => ({ status: 'installed' }),
    installPreset: async () => 'installed',
    writePatch: async () => { throw new Error('patch failed'); },
    packageAppeared: async () => true,
    rollbackPreset: async () => { calls.push('preset'); },
    rollbackPackage: async () => { calls.push('package'); },
  }), { code: 'install-rolled-back' });
  assert.deepEqual(calls, ['preset', 'package']);
});

test('transaction reports state-unknown when rollback cannot be verified', async () => {
  await assert.rejects(runInstallTransaction({
    installPackage: async () => ({ status: 'installed' }),
    installPreset: async () => 'installed',
    writePatch: async () => { throw new Error('patch failed'); },
    packageAppeared: async () => true,
    rollbackPreset: async () => { throw new Error('preset changed'); },
    rollbackPackage: async () => undefined,
  }), { code: 'state-unknown' });
});
