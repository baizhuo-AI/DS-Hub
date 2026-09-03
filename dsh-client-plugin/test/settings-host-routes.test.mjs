import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply } from '../lib/index.js';

async function invoke(route, { url, method = 'GET', body }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {
    url,
    method,
    headers: {
      host: '127.0.0.1:3080',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const response = { status: 200, headers: {}, chunks: [] };
  const res = {
    writeHead(status, headers = {}) {
      response.status = status;
      response.headers = headers;
    },
    end(chunk) {
      if (chunk) response.chunks.push(Buffer.from(chunk));
    },
  };
  await route.handler(req, res);
  response.json = response.chunks.length ? JSON.parse(Buffer.concat(response.chunks).toString('utf8')) : null;
  return response;
}

function apiProxyFixture() {
  const values = {
    'agent-default-model': { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
    'ui-conversation': { busyEnter: 'queue' },
  };
  const revisions = { 'agent-default-model': 4, 'ui-conversation': 2 };
  const calls = { mutate: 0 };
  const view = (ns) => ({ ns, value: { ...values[ns] }, revision: revisions[ns], applies: 'live', secrets: [] });
  return {
    calls,
    apiProxy: {
      settings: {
        async describe(request) {
          return {
            rpcId: request.rpcId,
            result: { ok: true, value: { writable: true, hasDocument: true, namespaces: Object.keys(values).map(view) } },
          };
        },
        async mutate(request) {
          calls.mutate += 1;
          const { ns, ops, expectedRevision } = request.payload;
          if (revisions[ns] !== expectedRevision) {
            return { rpcId: request.rpcId, result: { ok: false, error: { code: 'settings-conflict', message: 'stale' } } };
          }
          for (const op of ops) values[ns][op.path[0]] = op.value;
          revisions[ns] += 1;
          return { rpcId: request.rpcId, result: { ok: true, value: view(ns) } };
        },
      },
      llm: {
        async models(request) {
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
                    reasoning: { efforts: [{ id: 'max', name: 'max' }], defaultEffort: 'max' },
                  }],
                }],
                failures: [],
              },
            },
          };
        },
      },
    },
  };
}

test('same-origin Host config routes expose allowlist, CAS apply and independent readback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-settings-route-'));
  const profilePatchPath = join(root, 'cordis.patch.yml');
  await writeFile(profilePatchPath, '[]\n');
  const { apiProxy, calls } = apiProxyFixture();
  const routes = [];
  const disposers = [];
  const ctx = {
    apiProxy,
    loader: { entries: function* entries() {} },
    webServer: { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); } },
    effect(factory) { disposers.push(factory()); },
  };
  apply(ctx, { profilePatchPath });
  try {
    const route = routes.find((item) => item.path === '/ds-hub-api');
    const capabilities = await invoke(route, { url: '/ds-hub-api/capabilities' });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.json.configManagement.settingsMutation, true);
    assert(capabilities.json.configManagement.targets.includes('settings:ui-conversation#/busyEnter'));
    assert.equal(capabilities.json.configManagement.isolatedComparison, false);
    assert.equal(capabilities.json.configManagement.onlineObservation, false);

    const preflight = await invoke(route, {
      url: '/ds-hub-api/config/preflight',
      method: 'POST',
      body: { key: 'busyEnter', targetId: 'settings:ui-conversation#/busyEnter' },
    });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.json.canonicalValue, 'queue');
    const writeRequest = {
      idempotencyKey: 'route-candidate-1',
      key: 'busyEnter',
      targetId: preflight.json.targetId,
      expectedRevision: preflight.json.targetRevision,
      expectedOldValue: preflight.json.canonicalValue,
      value: 'steer',
      adoptionPreflight: {
        target: {
          targetId: preflight.json.targetId,
          revision: preflight.json.targetRevision,
          canonicalValue: preflight.json.canonicalValue,
          evidenceRef: preflight.json.evidenceRef,
        },
        modelEnvironment: {
          targetId: 'settings:agent-default-model#/selection',
          revision: 4,
          selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
          evidenceRef: 'route:model-environment:read',
        },
      },
    };
    const applied = await invoke(route, { url: '/ds-hub-api/config/apply', method: 'POST', body: writeRequest });
    assert.equal(applied.status, 200);
    assert.equal(applied.json.ok, true);
    assert.equal(applied.json.targetRevision, 3);
    assert.equal(calls.mutate, 1);

    const readback = await invoke(route, {
      url: '/ds-hub-api/config/readback',
      method: 'POST',
      body: {
        ...writeRequest,
        appliedTargetId: applied.json.targetId,
        appliedTargetRevision: applied.json.targetRevision,
        applyEvidenceRef: applied.json.evidenceRef,
        guardReceipt: applied.json.guardReceipt,
      },
    });
    assert.equal(readback.status, 200);
    assert.equal(readback.json.verified, true);
    assert.equal(readback.json.canonicalValue, 'steer');
    assert.notEqual(readback.json.evidenceRef, applied.json.evidenceRef);

    const unsupported = await invoke(route, {
      url: '/ds-hub-api/config/preflight',
      method: 'POST',
      body: { key: 'personaText', targetId: 'agent-preset-ref:unsafe#/persona' },
    });
    assert.equal(unsupported.status, 422);
    assert.equal(unsupported.json.error.code, 'unsupported-target');
    assert.equal(unsupported.json.error.state, 'unchanged');
  } finally {
    for (const dispose of disposers.reverse()) dispose?.();
    await rm(root, { recursive: true, force: true });
  }
});
