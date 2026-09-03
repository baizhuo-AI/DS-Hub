import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSettingsManagement, SUPPORTED_SETTINGS_TARGETS } from '../lib/settings-management.js';

const MODEL_TARGET = 'settings:agent-default-model#/selection';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeApi({ throwAfterMutate = false, failPostWriteDescribe = false } = {}) {
  const namespaces = new Map([
    ['agent-default-model', { revision: 4, value: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' } }],
    ['ui-conversation', { revision: 2, value: { busyEnter: 'queue' } }],
    ['agent-presets', { revision: 7, value: { default: 'raw-default' } }],
    ['web-search-deepseek', { revision: 3, value: { maxUses: 5 } }],
    ['permission', { revision: 8, value: { defaultPreset: 'danger-full-access' } }],
  ]);
  const presetContents = new Map([
    ['raw-default', 'name: default\n'],
    ['raw-candidate', 'name: candidate\n'],
  ]);
  const calls = { describe: 0, mutate: 0, presetList: 0, presetRead: 0, modelCatalog: 0, mutatePayloads: [] };
  const api = {
    settings: {
      async describe(request) {
        calls.describe += 1;
        if (failPostWriteDescribe && calls.mutate > 0) throw new Error('simulated readback outage');
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              writable: true,
              hasDocument: true,
              namespaces: [...namespaces].map(([ns, item]) => ({
                ns,
                revision: item.revision,
                value: clone(item.value),
                applies: 'live',
                secrets: [],
              })),
            },
          },
        };
      },
      async mutate(request) {
        calls.mutate += 1;
        calls.mutatePayloads.push(clone(request.payload));
        const item = namespaces.get(request.payload.ns);
        if (item.revision !== request.payload.expectedRevision) {
          return {
            rpcId: request.rpcId,
            result: {
              ok: false,
              error: { code: 'settings-conflict', message: 'stale', details: { expected: request.payload.expectedRevision, actual: item.revision } },
            },
          };
        }
        for (const operation of request.payload.ops) {
          assert.equal(operation.op, 'set');
          item.value[operation.path[0]] = clone(operation.value);
        }
        item.revision += 1;
        if (throwAfterMutate) throw new Error('simulated lost response');
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              ns: request.payload.ns,
              revision: item.revision,
              value: clone(item.value),
              applies: 'live',
              secrets: [],
            },
          },
        };
      },
    },
    agentPresets: {
      async list(request) {
        calls.presetList += 1;
        const selected = namespaces.get('agent-presets').value.default;
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              presets: [
                { id: 'raw-default', trust: 'system', isDefault: selected === 'raw-default' },
                { id: 'raw-candidate', trust: 'system', isDefault: selected === 'raw-candidate' },
              ],
            },
          },
        };
      },
      async read(request) {
        calls.presetRead += 1;
        const agentPreset = request.payload.agentPreset;
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              agentPreset,
              trust: 'system',
              content: presetContents.get(agentPreset),
            },
          },
        };
      },
    },
    llm: {
      async models(request) {
        calls.modelCatalog += 1;
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              groups: [{
                id: 'deepseek-official',
                name: 'DeepSeek Official',
                models: [{
                  id: 'deepseek-v4-flash',
                  name: 'DeepSeek V4 Flash',
                  reasoning: {
                    efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, name: id })),
                    defaultEffort: 'medium',
                  },
                }],
              }],
              failures: [],
            },
          },
        };
      },
    },
  };
  return { api, calls, namespaces, presetContents };
}

function targetGuard(preflight) {
  return {
    targetId: preflight.targetId,
    revision: preflight.targetRevision,
    canonicalValue: preflight.canonicalValue,
    evidenceRef: preflight.evidenceRef,
  };
}

function modelGuard(namespaces, evidenceRef = 'test:model-read:independent') {
  const item = namespaces.get('agent-default-model');
  return {
    targetId: MODEL_TARGET,
    revision: item.revision,
    selection: clone(item.value),
    evidenceRef,
  };
}

function applyRequest(preflight, namespaces, overrides = {}) {
  return {
    idempotencyKey: 'candidate-settings-1',
    phase: 'apply',
    key: 'busyEnter',
    targetId: 'settings:ui-conversation#/busyEnter',
    expectedRevision: preflight.targetRevision,
    expectedOldValue: preflight.canonicalValue,
    value: 'steer',
    adoptionPreflight: {
      target: targetGuard(preflight),
      modelEnvironment: modelGuard(namespaces),
    },
    ...overrides,
  };
}

test('settings bridge exposes only the explicit settings target allowlist', async () => {
  assert.deepEqual([...SUPPORTED_SETTINGS_TARGETS].sort(), [
    'settings:agent-default-model#/reasoningEffort',
    'settings:agent-default-model#/selection',
    'settings:agent-presets#/default',
    'settings:permission#/defaultPreset',
    'settings:ui-conversation#/busyEnter',
    'settings:web-search-deepseek#/maxUses',
  ].sort());
  const { api, calls } = fakeApi();
  const manager = createSettingsManagement(api);
  await assert.rejects(
    manager.preflight({ key: 'personaText', targetId: 'agent-preset-ref:unsafe#/persona' }),
    (error) => error.code === 'unsupported-target' && error.state === 'unchanged',
  );
  assert.equal(calls.describe, 0);
});

test('Host RPC envelopes must echo the exact request rpcId', async () => {
  const { api } = fakeApi();
  const describe = api.settings.describe;
  api.settings.describe = async (request) => ({ ...(await describe(request)), rpcId: 'wrong-rpc-id' });
  const manager = createSettingsManagement(api);
  await assert.rejects(
    manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' }),
    (error) => error.code === 'dsh-rpc-mismatch' && error.state === 'unchanged',
  );
});

test('settings apply performs one expectedRevision CAS and a separate exact readback', async () => {
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const secondPreflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  assert.equal(preflight.canonicalValue, 'queue');
  assert.notEqual(preflight.evidenceRef, secondPreflight.evidenceRef);

  const request = applyRequest(preflight, namespaces);
  const applied = await manager.apply(request);
  assert.equal(applied.ok, true);
  assert.equal(applied.targetRevision, preflight.targetRevision + 1);
  assert.equal(calls.mutate, 1);
  assert.deepEqual(calls.mutatePayloads[0], {
    ns: 'ui-conversation',
    ops: [{ op: 'set', path: ['busyEnter'], value: 'steer' }],
    expectedRevision: preflight.targetRevision,
  });
  assert.deepEqual(applied.guards.target, request.adoptionPreflight.target);
  assert.deepEqual(applied.guards.modelEnvironment, request.adoptionPreflight.modelEnvironment);
  assert.equal(applied.guardReceipt.candidateId, request.idempotencyKey);
  assert.equal(applied.guardReceipt.expectedTargetRevision, preflight.targetRevision);
  assert.equal(applied.guardReceipt.expectedModelRevision, namespaces.get('agent-default-model').revision);
  assert.match(applied.guardReceipt.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(new Set([
    preflight.evidenceRef,
    request.adoptionPreflight.modelEnvironment.evidenceRef,
    applied.guardReceipt.evidenceRef,
    applied.evidenceRef,
  ]).size, 4);

  const readback = await manager.readback({
    ...request,
    appliedTargetId: applied.targetId,
    appliedTargetRevision: applied.targetRevision,
    applyEvidenceRef: applied.evidenceRef,
    guardReceipt: applied.guardReceipt,
  });
  assert.equal(readback.verified, true);
  assert.equal(readback.canonicalValue, 'steer');
  assert.equal(readback.targetRevision, applied.targetRevision);
  assert(![preflight.evidenceRef, applied.guardReceipt.evidenceRef, applied.evidenceRef].includes(readback.evidenceRef));
  assert(calls.describe >= 4, 'preflight, guarded read, post-write read and explicit readback must be distinct');

  const replay = await manager.apply(request);
  assert.deepEqual(replay, applied);
  assert.equal(calls.mutate, 1, 'completed idempotency replay must not write again');
});

test('explicit readback also rechecks the model environment bound to the apply receipt', async () => {
  const { api, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-readback-model-guard-1' });
  const applied = await manager.apply(request);
  const model = namespaces.get('agent-default-model');
  model.value.reasoningEffort = 'high';
  model.revision += 1;
  const readback = await manager.readback({
    ...request,
    appliedTargetId: applied.targetId,
    appliedTargetRevision: applied.targetRevision,
    applyEvidenceRef: applied.evidenceRef,
    guardReceipt: applied.guardReceipt,
  });
  assert.equal(readback.verified, false);
  assert.equal(readback.canonicalValue, 'steer', 'the target write remains visible even though its model guard no longer holds');
});

test('a stale guarded revision is rejected before settings.mutate', async () => {
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  namespaces.get('ui-conversation').revision += 1;
  await assert.rejects(
    manager.apply(applyRequest(preflight, namespaces)),
    (error) => error.code === 'revision-conflict' && error.state === 'unchanged',
  );
  assert.equal(calls.mutate, 0);
});

test('model writes are bound to the fresh DSH provider, model and reasoning catalog', async () => {
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'modelSelection', targetId: MODEL_TARGET });
  const invalid = {
    ...applyRequest(preflight, namespaces),
    idempotencyKey: 'candidate-invalid-model-1',
    key: 'modelSelection',
    targetId: MODEL_TARGET,
    expectedOldValue: preflight.canonicalValue,
    value: { provider: 'does-not-exist', model: 'does-not-exist', reasoningEffort: 'max' },
  };
  await assert.rejects(
    manager.apply(invalid),
    (error) => error.code === 'invalid-value' && /不在 DSH 当前可用目录/.test(error.message),
  );
  assert.equal(calls.modelCatalog, 1);
  assert.equal(calls.mutate, 0, 'an unknown Provider/model must never reach settings.mutate');

  const valid = {
    ...invalid,
    idempotencyKey: 'candidate-valid-model-1',
    value: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  };
  const applied = await manager.apply(valid);
  assert.equal(applied.ok, true);
  assert.equal(calls.modelCatalog, 2);
  assert.equal(calls.mutate, 1);
  assert.deepEqual(namespaces.get('agent-default-model').value, valid.value);
});

test('reasoning-only writes use the current Provider/model catalog capabilities', async () => {
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const targetId = 'settings:agent-default-model#/reasoningEffort';
  const preflight = await manager.preflight({ key: 'reasoningEffort', targetId });
  const request = {
    ...applyRequest(preflight, namespaces),
    idempotencyKey: 'candidate-reasoning-1',
    key: 'reasoningEffort',
    targetId,
    expectedOldValue: preflight.canonicalValue,
    value: 'ultra',
  };
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'invalid-value' && /不支持推理强度/.test(error.message),
  );
  assert.equal(calls.modelCatalog, 1);
  assert.equal(calls.mutate, 0);
});

test('a lost mutate response becomes state-unknown and the same key is never retried', async () => {
  const { api, calls, namespaces } = fakeApi({ throwAfterMutate: true });
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-unknown-1' });
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'state-unknown' && error.state === 'state-unknown',
  );
  assert.equal(calls.mutate, 1);
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'state-unknown' && /不会自动重试/.test(error.message),
  );
  assert.equal(calls.mutate, 1);
});

test('a mismatched mutate rpcId is state-unknown and cannot replay the mutation', async () => {
  const { api, calls, namespaces } = fakeApi();
  const mutate = api.settings.mutate;
  api.settings.mutate = async (request) => ({ ...(await mutate(request)), rpcId: 'wrong-rpc-id' });
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-rpc-unknown-1' });
  await assert.rejects(manager.apply(request), (error) => error.code === 'state-unknown');
  assert.equal(calls.mutate, 1);
  await assert.rejects(manager.apply(request), (error) => error.code === 'state-unknown');
  assert.equal(calls.mutate, 1);
});

test('an independent post-write read failure is state-unknown and cannot replay the mutation', async () => {
  const { api, calls, namespaces } = fakeApi({ failPostWriteDescribe: true });
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-readback-unknown-1' });
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'state-unknown' && /写后环境核验未完成/.test(error.message),
  );
  assert.equal(calls.mutate, 1);
  await assert.rejects(manager.apply(request), (error) => error.code === 'state-unknown');
  assert.equal(calls.mutate, 1);
});

test('any model-proof failure after a successful settings CAS is state-unknown and cannot replay', async () => {
  const { api, calls, namespaces } = fakeApi();
  const originalDescribe = api.settings.describe;
  api.settings.describe = async (request) => {
    const response = await originalDescribe(request);
    if (calls.mutate > 0) {
      response.result.value.namespaces = response.result.value.namespaces
        .filter((item) => item.ns !== 'agent-default-model');
    }
    return response;
  };
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-post-write-model-proof-unknown-1' });
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'state-unknown' && error.state === 'state-unknown' && /写后环境核验未完成/.test(error.message),
  );
  assert.equal(namespaces.get('ui-conversation').value.busyEnter, 'steer', 'the target write crossed the mutation boundary');
  assert.equal(calls.mutate, 1);
  await assert.rejects(manager.apply(request), (error) => error.code === 'state-unknown' && /不会自动重试/.test(error.message));
  assert.equal(calls.mutate, 1);
});

test('explicit readback reports unknown when its model proof cannot be reconstructed', async () => {
  const { api, namespaces } = fakeApi();
  const originalDescribe = api.settings.describe;
  let hideModel = false;
  api.settings.describe = async (request) => {
    const response = await originalDescribe(request);
    if (hideModel) {
      response.result.value.namespaces = response.result.value.namespaces
        .filter((item) => item.ns !== 'agent-default-model');
    }
    return response;
  };
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-readback-model-proof-unknown-1' });
  const applied = await manager.apply(request);
  hideModel = true;
  await assert.rejects(
    manager.readback({
      ...request,
      appliedTargetId: applied.targetId,
      appliedTargetRevision: applied.targetRevision,
      applyEvidenceRef: applied.evidenceRef,
      guardReceipt: applied.guardReceipt,
    }),
    (error) => error.code === 'state-unknown' && error.state === 'state-unknown' && /模型与角色卡核验/.test(error.message),
  );
  assert.equal(namespaces.get('ui-conversation').value.busyEnter, 'steer');
});

test('a concurrent native model change after a different settings CAS becomes state-unknown', async () => {
  const { api, calls, namespaces } = fakeApi();
  const originalMutate = api.settings.mutate;
  api.settings.mutate = async (request) => {
    if (request.payload.ns === 'ui-conversation') {
      const model = namespaces.get('agent-default-model');
      model.value.reasoningEffort = 'high';
      model.revision += 1;
    }
    return originalMutate(request);
  };
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, { idempotencyKey: 'candidate-cross-namespace-race-1' });
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'state-unknown' && /模型环境在同一操作窗口内变化/.test(error.message),
  );
  assert.equal(calls.mutate, 1);
  assert.equal(namespaces.get('ui-conversation').value.busyEnter, 'steer', 'the target write happened, so this must never be reported unchanged');
});

test('permission policy never expands a stricter or custom current default', async () => {
  const { api, calls, namespaces } = fakeApi();
  namespaces.get('permission').value.defaultPreset = 'read-only';
  const manager = createSettingsManagement(api);
  const targetId = 'settings:permission#/defaultPreset';
  const preflight = await manager.preflight({ key: 'permissionDefault', targetId });
  const request = {
    ...applyRequest(preflight, namespaces),
    idempotencyKey: 'candidate-permission-no-expansion-1',
    key: 'permissionDefault',
    targetId,
    expectedOldValue: preflight.canonicalValue,
    value: 'workspace-write',
  };
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'invalid-value' && /不会被扩大或覆盖/.test(error.message),
  );
  assert.equal(calls.mutate, 0);
  assert.equal(namespaces.get('permission').value.defaultPreset, 'read-only');
});

test('settings writes reject non-canonical strings before the mutation boundary', async () => {
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api);
  const preflight = await manager.preflight({ key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' });
  const request = applyRequest(preflight, namespaces, {
    idempotencyKey: 'candidate-whitespace-1',
    value: ' steer ',
  });
  await assert.rejects(
    manager.apply(request),
    (error) => error.code === 'invalid-value' && /首尾空白/.test(error.message),
  );
  assert.equal(calls.mutate, 0);
});

test('default preset target resolves opaque refs without returning raw preset ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-preset-map-'));
  const mappingPath = join(root, 'preset-mapping.json');
  await writeFile(mappingPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'ds-hub-private-preset-mapping',
    presetMappingId: `preset-map-${'1'.repeat(32)}`,
    snapshotIdentity: 'snapshot-test-1',
    presetRosterRevision: `preset-roster-${'2'.repeat(32)}`,
    entries: [
      { ref: `preset-ref-${'3'.repeat(32)}`, rawPresetId: 'raw-default', inRoster: true, trust: 'system', isDefault: true },
      { ref: `preset-ref-${'4'.repeat(32)}`, rawPresetId: 'raw-candidate', inRoster: true, trust: 'system', isDefault: false },
    ],
  }), { mode: 0o600 });
  await chmod(mappingPath, 0o600);
  const presetIdentity = {
    presetMappingId: `preset-map-${'1'.repeat(32)}`,
    snapshotIdentity: 'snapshot-test-1',
    presetRosterRevision: `preset-roster-${'2'.repeat(32)}`,
  };
  const { api, calls, namespaces } = fakeApi();
  const manager = createSettingsManagement(api, { presetMappingPath: mappingPath });
  try {
    const requestBase = {
      key: 'defaultPresetId',
      targetId: 'settings:agent-presets#/default',
      presetIdentity,
    };
    const candidatePresetRef = `preset-ref-${'4'.repeat(32)}`;
    const preflight = await manager.preflight({ ...requestBase, value: candidatePresetRef });
    assert.equal(preflight.canonicalValue, `preset-ref-${'3'.repeat(32)}`);
    assert.equal(preflight.presetRoster.defaultPresetRef, preflight.canonicalValue);
    assert(!JSON.stringify(preflight).includes('raw-default'));
    const request = {
      ...requestBase,
      idempotencyKey: 'candidate-preset-1',
      expectedRevision: preflight.targetRevision,
      expectedOldValue: preflight.canonicalValue,
      value: candidatePresetRef,
      adoptionPreflight: {
        target: targetGuard(preflight),
        modelEnvironment: modelGuard(namespaces),
        presetRoster: preflight.presetRoster,
      },
    };
    const applied = await manager.apply(request);
    const readback = await manager.readback({
      ...request,
      appliedTargetId: applied.targetId,
      appliedTargetRevision: applied.targetRevision,
      applyEvidenceRef: applied.evidenceRef,
      guardReceipt: applied.guardReceipt,
    });
    assert.equal(readback.verified, true);
    assert.equal(readback.canonicalValue, request.value);
    assert.equal(readback.presetRoster.defaultPresetRef, request.value);
    assert.notEqual(readback.presetRoster.revision, preflight.presetRoster.revision);
    assert(!JSON.stringify({ applied, readback }).includes('raw-candidate'));
    assert.equal(calls.mutatePayloads[0].ops[0].value, 'raw-candidate', 'raw id remains Host-only');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('default preset apply rejects candidate composition drift after preflight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-preset-composition-drift-'));
  const mappingPath = join(root, 'preset-mapping.json');
  const presetIdentity = {
    presetMappingId: `preset-map-${'d'.repeat(32)}`,
    snapshotIdentity: 'snapshot-test-composition-drift',
    presetRosterRevision: `preset-roster-${'e'.repeat(32)}`,
  };
  const candidatePresetRef = `preset-ref-${'f'.repeat(32)}`;
  await writeFile(mappingPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'ds-hub-private-preset-mapping',
    ...presetIdentity,
    entries: [
      { ref: `preset-ref-${'0'.repeat(32)}`, rawPresetId: 'raw-default', inRoster: true, trust: 'system', isDefault: true },
      { ref: candidatePresetRef, rawPresetId: 'raw-candidate', inRoster: true, trust: 'system', isDefault: false },
    ],
  }), { mode: 0o600 });
  await chmod(mappingPath, 0o600);
  const { api, calls, namespaces, presetContents } = fakeApi();
  const manager = createSettingsManagement(api, { presetMappingPath: mappingPath });
  try {
    const requestBase = {
      key: 'defaultPresetId',
      targetId: 'settings:agent-presets#/default',
      presetIdentity,
      value: candidatePresetRef,
    };
    const preflight = await manager.preflight(requestBase);
    assert.equal(preflight.presetRoster.candidatePresetRef, candidatePresetRef);
    assert.match(preflight.presetRoster.candidatePresetDigest, /^sha256:[a-f0-9]{64}$/);

    presetContents.set('raw-candidate', 'name: candidate\nprompt: changed after preflight\n');
    await assert.rejects(
      manager.apply({
        ...requestBase,
        idempotencyKey: 'candidate-preset-composition-drift-1',
        expectedRevision: preflight.targetRevision,
        expectedOldValue: preflight.canonicalValue,
        adoptionPreflight: {
          target: targetGuard(preflight),
          modelEnvironment: modelGuard(namespaces),
          presetRoster: preflight.presetRoster,
        },
      }),
      (error) => error.code === 'preset-roster-conflict' && error.state === 'unchanged',
    );
    assert.equal(calls.presetRead, 2, 'preflight and guarded apply must independently read the candidate composition');
    assert.equal(calls.mutate, 0, 'composition drift must be rejected before settings.mutate');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the packaged DS Hub assistant preset stays internal to the user roster mapping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-internal-preset-'));
  const mappingPath = join(root, 'preset-mapping.json');
  await writeFile(mappingPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'ds-hub-private-preset-mapping',
    presetMappingId: `preset-map-${'9'.repeat(32)}`,
    snapshotIdentity: 'snapshot-test-internal-preset',
    presetRosterRevision: `preset-roster-${'a'.repeat(32)}`,
    entries: [
      { ref: `preset-ref-${'b'.repeat(32)}`, rawPresetId: 'raw-default', inRoster: true, trust: 'system', isDefault: true },
      { ref: `preset-ref-${'c'.repeat(32)}`, rawPresetId: 'raw-candidate', inRoster: true, trust: 'system', isDefault: false },
    ],
  }), { mode: 0o600 });
  await chmod(mappingPath, 0o600);
  const { api } = fakeApi();
  const originalList = api.agentPresets.list;
  api.agentPresets.list = async (request) => {
    const response = await originalList(request);
    response.result.value.presets.push({ id: 'ds-hub-assistant', trust: 'user', isDefault: false });
    return response;
  };
  const manager = createSettingsManagement(api, { presetMappingPath: mappingPath, assistantPreset: 'ds-hub-assistant' });
  try {
    const preflight = await manager.preflight({
      key: 'defaultPresetId',
      targetId: 'settings:agent-presets#/default',
      presetIdentity: {
        presetMappingId: `preset-map-${'9'.repeat(32)}`,
        snapshotIdentity: 'snapshot-test-internal-preset',
        presetRosterRevision: `preset-roster-${'a'.repeat(32)}`,
      },
    });
    assert.equal(preflight.canonicalValue, `preset-ref-${'b'.repeat(32)}`);
    assert.equal(preflight.presetRoster.defaultPresetRef, preflight.canonicalValue);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('default preset preflight rejects broken or trust-drifted roster entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-preset-roster-policy-'));
  const mappingPath = join(root, 'preset-mapping.json');
  await writeFile(mappingPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'ds-hub-private-preset-mapping',
    presetMappingId: `preset-map-${'5'.repeat(32)}`,
    snapshotIdentity: 'snapshot-test-roster-policy',
    presetRosterRevision: `preset-roster-${'6'.repeat(32)}`,
    entries: [
      { ref: `preset-ref-${'7'.repeat(32)}`, rawPresetId: 'raw-default', inRoster: true, trust: 'system', isDefault: true },
      { ref: `preset-ref-${'8'.repeat(32)}`, rawPresetId: 'raw-candidate', inRoster: true, trust: 'system', isDefault: false },
    ],
  }), { mode: 0o600 });
  await chmod(mappingPath, 0o600);
  const { api } = fakeApi();
  api.agentPresets.list = async (request) => ({
    rpcId: request.rpcId,
    result: {
      ok: true,
      value: {
        presets: [
          { id: 'raw-default', trust: 'system', isDefault: true },
          { id: 'raw-candidate', trust: 'user', isDefault: false, broken: 'cannot mount' },
        ],
      },
    },
  });
  const manager = createSettingsManagement(api, { presetMappingPath: mappingPath });
  try {
    await assert.rejects(
      manager.preflight({
        key: 'defaultPresetId',
        targetId: 'settings:agent-presets#/default',
        presetIdentity: {
          presetMappingId: `preset-map-${'5'.repeat(32)}`,
          snapshotIdentity: 'snapshot-test-roster-policy',
          presetRosterRevision: `preset-roster-${'6'.repeat(32)}`,
        },
      }),
      (error) => error.code === 'preset-roster-conflict' && /不可装载/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
