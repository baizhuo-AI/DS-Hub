import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createLoaderManagement,
  parseManagedRows,
  replaceManagedRows,
  revisionOf,
  __test,
} from '../lib/loader-management.js';

test('module identity syntax accepts real DSH package forms and rejects executable-looking input', () => {
  for (const moduleName of [
    'dsh-dimension-demo',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-subagent-control/list-agents',
    '@community-scope/plugin.name/subpath-v2/index.js',
  ]) {
    assert.equal(__test.isSafeModuleName(moduleName), true, moduleName);
  }
  for (const moduleName of [
    '',
    ' dsh-dimension-demo',
    'dsh-dimension-demo ',
    'dsh dimension demo',
    'dsh-dimension-demo\nnext',
    'cordis:include',
    'https://example.com/plugin.js',
    'javascript:alert(1)',
    'file:///tmp/plugin.js',
    './local-plugin',
    '../local-plugin',
    '@scope/pkg/../escape',
    '@scope/pkg/(loader)',
    '@scope/pkg\";process.exit()',
    '@scope/pkg/${payload}',
    '@scope//plugin',
    '@scope/plugin/',
  ]) {
    assert.equal(__test.isSafeModuleName(moduleName), false, moduleName);
  }
});

test('managed block preserves all surrounding text and round-trips exact identities', () => {
  const original = '# keep this comment\n- insert:\n    - id: existing\n      name: existing-module\n';
  const rows = new Map([
    ['tool-result-pruner', {
      rawId: 'tool-result-pruner',
      moduleName: '@deepseek-ai/dsh-compaction-tool-result-pruner',
      enabled: true,
    }],
  ]);
  const patched = replaceManagedRows(original, rows);
  assert.ok(patched.startsWith(original));
  assert.deepEqual([...parseManagedRows(patched).values()], [...rows.values()]);
  assert.match(revisionOf(patched), /^sha256:[a-f0-9]{64}$/);
});

test('managed rows replace a fresh profile empty-list placeholder', () => {
  const rows = new Map([['example', { rawId: 'example', moduleName: 'example-module', enabled: false }]]);
  const patched = replaceManagedRows('# keep\n[]\n', rows);
  assert.equal(patched.includes('\n[]\n'), false);
  assert.match(patched, /^# keep/m);
  assert.deepEqual(parseManagedRows(patched).get('example'), rows.get('example'));
});

test('malformed or duplicated managed markers fail closed', () => {
  assert.throws(() => parseManagedRows('# >>> DS HUB MANAGED LOADER OVERRIDES\n- hand-written: true\n# <<< DS HUB MANAGED LOADER OVERRIDES'), {
    code: 'managed-block-invalid',
  });
  assert.throws(() => parseManagedRows('# >>> DS HUB MANAGED LOADER OVERRIDES\n'), {
    code: 'managed-block-invalid',
  });
  assert.throws(() => parseManagedRows('# >>> DS HUB MANAGED LOADER OVERRIDES\n- { id: "example", name: "https://example.com/plugin.js", disabled: false }\n# <<< DS HUB MANAGED LOADER OVERRIDES'), {
    code: 'managed-block-invalid',
  });
  assert.throws(() => replaceManagedRows('# untouched\n', new Map([
    ['example', { rawId: 'example', moduleName: 'plugin\";process.exit()', enabled: true }],
  ])), { code: 'managed-block-invalid' });
});

test('preflight binds root entry identity and patch revision, rejecting preset composition rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-loader-test-'));
  const patchPath = join(root, 'cordis.patch.yml');
  await writeFile(patchPath, '# untouched\n');
  const entries = [{
    id: 'include:tool-result-pruner',
    options: { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    disabled: true,
    fiber: undefined,
  }, {
    id: 'include:agent-presets:tool-result-pruner',
    options: { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    disabled: false,
    fiber: { state: 2 },
  }];
  const management = createLoaderManagement({ loader: { entries: function* list() { yield* entries; } } }, { profilePatchPath: patchPath });
  const result = await management.preflight({
    entryId: entries[0].id,
    moduleName: entries[0].options.name,
    desiredEnabled: true,
  });
  assert.equal(result.canonicalValue.enabled, false);
  assert.equal(result.canonicalValue.fiberPhase, null);
  assert.equal(result.targetRevision, revisionOf(await readFile(patchPath)));
  await assert.rejects(management.preflight({
    entryId: entries[1].id,
    moduleName: entries[1].options.name,
    desiredEnabled: false,
  }), { code: 'entry-scope-denied' });
  await assert.rejects(management.preflight({
    entryId: entries[0].id,
    moduleName: 'different-safe-module',
    desiredEnabled: true,
  }), { code: 'identity-mismatch' });
  await rm(root, { recursive: true, force: true });
});

test('host policy denies core entries and exposes only third-party or optional built-ins as mutable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-loader-test-'));
  const patchPath = join(root, 'cordis.patch.yml');
  await writeFile(patchPath, '# untouched\n');
  const entries = [{
    id: 'include:webserver',
    options: { name: '@deepseek-ai/dsh-host-webserver' },
    disabled: false,
    fiber: { state: 2 },
  }, {
    id: 'include:tool-bash',
    options: { name: '@deepseek-ai/dsh-tool-bash' },
    disabled: true,
    fiber: undefined,
  }, {
    id: 'include:community-widget',
    options: { name: 'dsh-community-widget' },
    disabled: true,
    fiber: undefined,
  }, {
    id: 'include:ui-ds-hub',
    options: { name: 'dsh-ds-hub' },
    disabled: false,
    fiber: { state: 2 },
  }];
  const management = createLoaderManagement({ loader: { entries: function* list() { yield* entries; } } }, { profilePatchPath: patchPath });
  await assert.rejects(management.preflight({
    entryId: entries[0].id,
    moduleName: entries[0].options.name,
    desiredEnabled: false,
  }), { code: 'entry-scope-denied' });
  await assert.rejects(management.preflight({
    entryId: entries[3].id,
    moduleName: entries[3].options.name,
    desiredEnabled: false,
  }), { code: 'entry-scope-denied' });
  assert.equal((await management.preflight({
    entryId: entries[1].id,
    moduleName: entries[1].options.name,
    desiredEnabled: true,
  })).mutable, true);
  assert.equal((await management.preflight({
    entryId: entries[2].id,
    moduleName: entries[2].options.name,
    desiredEnabled: true,
  })).mutable, true);
  assert.deepEqual(management.mutableEntries().map((entry) => entry.entryId), [
    'include:tool-bash',
    'include:community-widget',
  ]);
  await rm(root, { recursive: true, force: true });
});

test('unsafe request and Inventory module identities never enter the Loader write boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-loader-test-'));
  const patchPath = join(root, 'cordis.patch.yml');
  const original = '# untouched\n';
  await writeFile(patchPath, original);
  let loaderAwaitCalls = 0;
  const safeEntry = {
    id: 'include:dimension-demo',
    options: { name: 'dsh-dimension-demo' },
    disabled: true,
    fiber: undefined,
  };
  const unsafeInventoryEntry = {
    id: 'include:cordis-include',
    options: { name: 'cordis:include' },
    disabled: true,
    fiber: undefined,
  };
  const management = createLoaderManagement({
    loader: {
      entries: function* entries() { yield safeEntry; yield unsafeInventoryEntry; },
      async await() { loaderAwaitCalls += 1; },
    },
  }, { profilePatchPath: patchPath });

  assert.deepEqual(management.mutableEntries(), [{
    entryId: safeEntry.id,
    moduleName: safeEntry.options.name,
    enabled: false,
    fiberPhase: null,
  }]);
  assert.deepEqual(__test.rootEntryMutability(unsafeInventoryEntry), {
    mutable: false,
    reason: 'invalid-module-name',
    rawId: 'cordis-include',
  });
  await assert.rejects(management.preflight({
    entryId: unsafeInventoryEntry.id,
    moduleName: 'safe-package-name',
    desiredEnabled: true,
  }), { code: 'entry-scope-denied' });

  const maliciousNames = [
    'dsh-dimension-demo ',
    'https://example.com/plugin.js',
    'plugin\";process.exit()',
    '@scope/pkg/(loader)',
    'plugin\nsecond-line',
  ];
  for (const [index, moduleName] of maliciousNames.entries()) {
    await assert.rejects(management.preflight({
      entryId: safeEntry.id,
      moduleName,
      desiredEnabled: true,
    }), { code: 'invalid-request' });
    await assert.rejects(management.setEnabled({
      entryId: safeEntry.id,
      moduleName,
      enabled: true,
      expectedRevision: revisionOf(original),
      expectedEnabled: false,
      idempotencyKey: `malicious-module-${index}`,
    }), { code: 'invalid-request' });
  }
  assert.equal(await readFile(patchPath, 'utf8'), original);
  assert.equal(loaderAwaitCalls, 0);
  assert.deepEqual(await readdir(root), ['cordis.patch.yml']);
  await rm(root, { recursive: true, force: true });
});

test('setEnabled uses CAS and replays one idempotency key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-loader-test-'));
  const patchPath = join(root, 'cordis.patch.yml');
  await writeFile(patchPath, '# untouched\n');
  let enabled = false;
  const entry = {
    id: 'include:tool-result-pruner',
    options: { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    get disabled() { return !enabled; },
    get fiber() { return enabled ? { state: 2 } : undefined; },
  };
  const loader = {
    entries: function* entries() { yield entry; },
    async await() {
      const rows = parseManagedRows(await readFile(patchPath, 'utf8'));
      enabled = rows.get('tool-result-pruner')?.enabled ?? false;
    },
  };
  const management = createLoaderManagement({ loader }, { profilePatchPath: patchPath });
  const preflight = await management.preflight({
    entryId: entry.id,
    moduleName: entry.options.name,
    desiredEnabled: true,
  });
  const request = {
    entryId: entry.id,
    moduleName: entry.options.name,
    enabled: true,
    expectedRevision: preflight.targetRevision,
    expectedEnabled: false,
    idempotencyKey: 'same-network-attempt',
  };
  const first = await management.setEnabled(request);
  const replay = await management.setEnabled(request);
  assert.equal(first, replay);
  assert.equal(first.applied, true);
  assert.equal(first.readback.enabled, true);
  assert.equal(first.readback.fiberPhase, 'active');
  await assert.rejects(management.setEnabled({ ...request, enabled: false }), { code: 'idempotency-conflict' });
  await rm(root, { recursive: true, force: true });
});
