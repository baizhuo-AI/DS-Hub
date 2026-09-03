#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createLoaderManagement,
  parseManagedRows,
  revisionOf,
} from '../dsh-client-plugin/lib/loader-management.js';

const ENTRY_ID = 'include:tool-result-pruner';
const RAW_ID = 'tool-result-pruner';
const MODULE_NAME = '@deepseek-ai/dsh-compaction-tool-result-pruner';
const PRESET_ENTRY_ID = 'include:agent-presets:tool-result-pruner';
const BASE_PATCH = `# hand-authored prefix must survive
- insert:
    - id: unrelated-human-entry
      name: example-human-plugin

# >>> DS HUB MANAGED LOADER OVERRIDES
- { id: "tool-result-pruner", name: "@deepseek-ai/dsh-compaction-tool-result-pruner", disabled: true }
- { id: "unrelated-managed-entry", name: "example-managed-plugin", disabled: false }
# <<< DS HUB MANAGED LOADER OVERRIDES
# hand-authored suffix must survive
`;

function makeEntry({
  id = ENTRY_ID,
  moduleName = MODULE_NAME,
  enabled = false,
  fiberState = enabled ? 2 : null,
  group = false,
} = {}) {
  return {
    id,
    options: { name: moduleName, ...(group ? { group: true } : {}) },
    disabled: !enabled,
    ...(fiberState == null ? {} : { fiber: { state: fiberState } }),
  };
}

async function bridgeFailure(promise, code, state = 'unchanged') {
  let failure;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `expected bridge failure ${code}`);
  assert.equal(failure.code, code);
  assert.equal(failure.state, state);
  return failure;
}

const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-loader-management-smoke-'));

async function fixture(name, options = {}) {
  const fixtureRoot = join(tempRoot, name);
  await mkdir(fixtureRoot);
  const profilePatchPath = join(fixtureRoot, 'cordis.patch.yml');
  const content = options.content ?? BASE_PATCH;
  await writeFile(profilePatchPath, content);
  const entries = options.entries || [makeEntry(), makeEntry({ id: PRESET_ENTRY_ID, enabled: true })];
  let awaitCount = 0;
  const loader = {
    entries() { return entries; },
    async await() {
      awaitCount += 1;
      await options.onAwait?.({ awaitCount, entries, profilePatchPath });
    },
  };
  const management = createLoaderManagement({ loader }, { profilePatchPath });
  return { profilePatchPath, entries, management, awaitCount: () => awaitCount };
}

function setRequest(preflight, overrides = {}) {
  return {
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    enabled: true,
    expectedRevision: preflight.targetRevision,
    expectedEnabled: preflight.canonicalValue.enabled,
    idempotencyKey: 'loader-smoke-enable-pruner',
    ...overrides,
  };
}

try {
  // The bridge is opt-in and refuses relative/missing configuration.
  const unconfigured = createLoaderManagement({ loader: { entries: () => [] } }, { profilePatchPath: 'relative.yml' });
  assert.equal(unconfigured.configured, false);
  await bridgeFailure(unconfigured.preflight({
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    desiredEnabled: true,
  }), 'bridge-not-configured');

  // Happy path: exact root entry, CAS revision, atomic managed-block update and
  // active-Fiber readback. The same-package Preset entry remains untouched.
  const happy = await fixture('happy', {
    async onAwait({ entries, profilePatchPath }) {
      const row = parseManagedRows(await readFile(profilePatchPath, 'utf8')).get(RAW_ID);
      entries[0].disabled = !row.enabled;
      entries[0].fiber = row.enabled ? { state: 2 } : undefined;
    },
  });
  const happyPreflight = await happy.management.preflight({
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    desiredEnabled: true,
  });
  assert.equal(happyPreflight.targetId, `loader-entry:web:${encodeURIComponent(ENTRY_ID)}`);
  assert.match(happyPreflight.targetRevision, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(happyPreflight.canonicalValue, {
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    enabled: false,
    fiberPhase: null,
  });
  const happyRequest = setRequest(happyPreflight);
  const happyReceipt = await happy.management.setEnabled(happyRequest);
  assert.equal(happyReceipt.ok, true);
  assert.equal(happyReceipt.applied, true);
  assert.equal(happyReceipt.targetId, happyPreflight.targetId);
  assert.deepEqual(happyReceipt.readback, {
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    enabled: true,
    fiberPhase: 'active',
  });
  const happyText = await readFile(happy.profilePatchPath, 'utf8');
  assert.equal(happyReceipt.targetRevision, revisionOf(happyText));
  assert.match(happyText, /# hand-authored prefix must survive/);
  assert.match(happyText, /# hand-authored suffix must survive/);
  const happyRows = parseManagedRows(happyText);
  assert.equal(happyRows.get(RAW_ID).enabled, true);
  assert.deepEqual(happyRows.get('unrelated-managed-entry'), {
    rawId: 'unrelated-managed-entry',
    moduleName: 'example-managed-plugin',
    enabled: true,
  });
  assert.equal(happy.entries[1].id, PRESET_ENTRY_ID);
  assert.equal(happy.entries[1].disabled, false, 'Host mutation must not touch the same-package Preset entry');

  // Idempotent replay returns the first receipt without a second runtime write;
  // reusing the key for a different operation is rejected.
  const awaitCountAfterApply = happy.awaitCount();
  const replayReceipt = await happy.management.setEnabled({ ...happyRequest });
  assert.deepEqual(replayReceipt, happyReceipt);
  assert.equal(happy.awaitCount(), awaitCountAfterApply);
  await bridgeFailure(happy.management.setEnabled({ ...happyRequest, enabled: false }), 'idempotency-conflict');

  // Only one exact Host root identity is writable. Preset subentries, Loader
  // groups, duplicate ids, module drift and the DS Hub bridge itself are denied.
  const deniedCases = [
    {
      name: 'preset-scope',
      entries: [makeEntry({ id: PRESET_ENTRY_ID, enabled: true })],
      request: { entryId: PRESET_ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: false },
      code: 'entry-scope-denied',
    },
    {
      name: 'group-scope',
      entries: [makeEntry({ group: true })],
      request: { entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true },
      code: 'entry-scope-denied',
    },
    {
      name: 'duplicate-entry',
      entries: [makeEntry(), makeEntry()],
      request: { entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true },
      code: 'entry-not-found',
    },
    {
      name: 'identity-drift',
      entries: [makeEntry({ moduleName: `${MODULE_NAME}/changed` })],
      request: { entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true },
      code: 'identity-mismatch',
    },
    {
      name: 'self-disable',
      entries: [makeEntry({ id: 'include:ui-ds-hub', moduleName: 'dsh-ds-hub', enabled: true })],
      request: { entryId: 'include:ui-ds-hub', moduleName: 'dsh-ds-hub', desiredEnabled: false },
      code: 'entry-scope-denied',
    },
  ];
  for (const denied of deniedCases) {
    const target = await fixture(denied.name, { entries: denied.entries });
    const before = await readFile(target.profilePatchPath, 'utf8');
    await bridgeFailure(target.management.preflight(denied.request), denied.code);
    assert.equal(await readFile(target.profilePatchPath, 'utf8'), before, `${denied.name} must not change the patch`);
  }

  // Managed blocks fail closed when markers or rows are malformed.
  const malformed = await fixture('malformed', {
    content: `${BASE_PATCH.replace('# <<< DS HUB MANAGED LOADER OVERRIDES', '')}`,
    entries: [makeEntry()],
  });
  const malformedBefore = await readFile(malformed.profilePatchPath, 'utf8');
  await bridgeFailure(malformed.management.preflight({
    entryId: ENTRY_ID,
    moduleName: MODULE_NAME,
    desiredEnabled: true,
  }), 'managed-block-invalid');
  assert.equal(await readFile(malformed.profilePatchPath, 'utf8'), malformedBefore);

  // State and file revision are independently guarded between preflight/apply.
  const stateConflict = await fixture('state-conflict', { entries: [makeEntry()] });
  const statePreflight = await stateConflict.management.preflight({ entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true });
  stateConflict.entries[0].disabled = false;
  stateConflict.entries[0].fiber = { state: 2 };
  const stateConflictBefore = await readFile(stateConflict.profilePatchPath, 'utf8');
  await bridgeFailure(stateConflict.management.setEnabled(setRequest(statePreflight, { idempotencyKey: 'state-conflict' })), 'state-conflict');
  assert.equal(await readFile(stateConflict.profilePatchPath, 'utf8'), stateConflictBefore);

  const revisionConflict = await fixture('revision-conflict', { entries: [makeEntry()] });
  const revisionPreflight = await revisionConflict.management.preflight({ entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true });
  const concurrentText = `${await readFile(revisionConflict.profilePatchPath, 'utf8')}# concurrent human edit\n`;
  await writeFile(revisionConflict.profilePatchPath, concurrentText);
  await bridgeFailure(revisionConflict.management.setEnabled(setRequest(revisionPreflight, { idempotencyKey: 'revision-conflict' })), 'revision-conflict');
  assert.equal(await readFile(revisionConflict.profilePatchPath, 'utf8'), concurrentText, 'CAS failure must preserve the concurrent edit');

  // If runtime application fails and the file is still ours, the bridge rolls
  // back and verifies the original state before returning an unchanged error.
  const rolledBack = await fixture('rollback-verified', {
    entries: [makeEntry()],
    async onAwait({ awaitCount, entries }) {
      if (awaitCount === 1) {
        entries[0].options.name = `${MODULE_NAME}/runtime-drift`;
      } else {
        entries[0].options.name = MODULE_NAME;
        entries[0].disabled = true;
        entries[0].fiber = undefined;
      }
    },
  });
  const rollbackBefore = await readFile(rolledBack.profilePatchPath, 'utf8');
  const rollbackPreflight = await rolledBack.management.preflight({ entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true });
  const rollbackError = await bridgeFailure(
    rolledBack.management.setEnabled(setRequest(rollbackPreflight, { idempotencyKey: 'rollback-verified' })),
    'apply-not-observed',
  );
  assert.ok(rollbackError.details?.restored);
  assert.equal(await readFile(rolledBack.profilePatchPath, 'utf8'), rollbackBefore);
  assert.equal(rolledBack.entries[0].disabled, true);

  // A failed rollback readback is state_unknown even if the file was restored;
  // the bridge must not claim success without exact runtime evidence.
  const rollbackUnknown = await fixture('rollback-unknown', {
    entries: [makeEntry()],
    async onAwait({ entries }) {
      entries[0].options.name = `${MODULE_NAME}/runtime-drift`;
    },
  });
  const rollbackUnknownBefore = await readFile(rollbackUnknown.profilePatchPath, 'utf8');
  const rollbackUnknownPreflight = await rollbackUnknown.management.preflight({ entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true });
  await bridgeFailure(
    rollbackUnknown.management.setEnabled(setRequest(rollbackUnknownPreflight, { idempotencyKey: 'rollback-unknown' })),
    'state-unknown',
    'unknown',
  );
  assert.equal(await readFile(rollbackUnknown.profilePatchPath, 'utf8'), rollbackUnknownBefore);

  // If another writer changes the file after our atomic write, do not overwrite
  // it during rollback. Runtime may have changed, so the only honest result is
  // state_unknown and the concurrent bytes must survive.
  const concurrentAfterApply = await fixture('concurrent-after-apply', {
    entries: [makeEntry()],
    async onAwait({ entries, profilePatchPath }) {
      entries[0].disabled = false;
      entries[0].fiber = { state: 2 };
      const current = await readFile(profilePatchPath, 'utf8');
      await writeFile(profilePatchPath, `${current}# concurrent edit after DS Hub write\n`);
    },
  });
  const concurrentPreflight = await concurrentAfterApply.management.preflight({ entryId: ENTRY_ID, moduleName: MODULE_NAME, desiredEnabled: true });
  await bridgeFailure(
    concurrentAfterApply.management.setEnabled(setRequest(concurrentPreflight, { idempotencyKey: 'concurrent-after-apply' })),
    'state-unknown',
    'unknown',
  );
  const concurrentAfterText = await readFile(concurrentAfterApply.profilePatchPath, 'utf8');
  assert.match(concurrentAfterText, /# concurrent edit after DS Hub write/);
  assert.equal(parseManagedRows(concurrentAfterText).get(RAW_ID).enabled, true, 'unknown result must not be disguised as rollback success');

  console.log('PASS loader-management-smoke');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
