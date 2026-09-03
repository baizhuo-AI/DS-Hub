import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const adapterSource = await readFile(join(here, '..', '..', 'bridge', 'dsh-live-adapter.js'), 'utf8');

function browserContext(fetch, runtimeConfig = {}) {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Intl,
    AbortController,
    DOMException,
    fetch,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    __DS_HUB_RUNTIME_CONFIG__: runtimeConfig,
    document: { addEventListener() {}, querySelector() { return null; } },
  };
  context.window = context;
  context.parent = context;
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'dsh-live-adapter.js' });
  return context;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('browser config adapter uses one same-origin Host request and does not serialize AbortSignal', async () => {
  const calls = [];
  const context = browserContext(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(200, {
      ok: true,
      targetId: 'settings:ui-conversation#/busyEnter',
      targetRevision: 2,
      canonicalValue: 'queue',
      evidenceRef: 'read-1',
    });
  });
  assert.equal(typeof context.DS_HUB_CONFIG_ADAPTER.preflight, 'function');
  assert.equal(typeof context.DS_HUB_CONFIG_ADAPTER.apply, 'function');
  assert.equal(typeof context.DS_HUB_CONFIG_ADAPTER.readback, 'function');
  const controller = new AbortController();
  const result = await context.DS_HUB_CONFIG_ADAPTER.preflight({
    key: 'busyEnter',
    targetId: 'settings:ui-conversation#/busyEnter',
    signal: controller.signal,
  });
  assert.equal(result.canonicalValue, 'queue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/ds-hub-api/config/preflight');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    key: 'busyEnter',
    targetId: 'settings:ui-conversation#/busyEnter',
  });
});

test('browser config apply surfaces state-unknown and never retries it', async () => {
  let calls = 0;
  const context = browserContext(async () => {
    calls += 1;
    return jsonResponse(503, {
      ok: false,
      error: { code: 'state-unknown', message: '写入状态未知', state: 'state-unknown' },
    });
  });
  await assert.rejects(
    context.DS_HUB_CONFIG_ADAPTER.apply({ idempotencyKey: 'candidate-1' }),
    (error) => error.code === 'state-unknown' && error.state === 'state-unknown',
  );
  assert.equal(calls, 1);
});

for (const [label, response] of [
  ['malformed 200', { ok: true, status: 200, async json() { throw new Error('invalid json'); } }],
  ['malformed 503', { ok: false, status: 503, async json() { throw new Error('invalid json'); } }],
]) {
  test(`browser config apply treats ${label} as state-unknown`, async () => {
    let calls = 0;
    const context = browserContext(async () => { calls += 1; return response; });
    await assert.rejects(
      context.DS_HUB_CONFIG_ADAPTER.apply({ idempotencyKey: `candidate-${label}` }),
      (error) => error.code === 'state-unknown' && error.state === 'state-unknown',
    );
    assert.equal(calls, 1);
  });
}

test('browser config apply only trusts an explicit Host unchanged state', async () => {
  const context = browserContext(async () => jsonResponse(409, {
    ok: false,
    error: { code: 'revision-conflict', message: 'stale', state: 'unchanged' },
  }));
  await assert.rejects(
    context.DS_HUB_CONFIG_ADAPTER.apply({ idempotencyKey: 'candidate-explicit-unchanged' }),
    (error) => error.code === 'revision-conflict' && error.state === 'unchanged',
  );
});

test('AI environment evidence stays stable for the same revision and selection', async () => {
  const presetContent = 'name: DS Hub Assistant\ntools: []\n';
  const assistantPresetDigest = `sha256:${createHash('sha256').update(presetContent).digest('hex')}`;
  const context = browserContext(async (url, options) => {
    const request = JSON.parse(options.body);
    let value;
    if (url === '/api/settings.describe') {
      value = {
        writable: true,
        namespaces: [{
          ns: 'agent-default-model',
          revision: 4,
          value: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
        }],
      };
    } else if (url === '/api/llm.providers') {
      value = { providers: [{ provider: 'deepseek-official', active: true }] };
    } else if (url === '/api/agentPreset.list') {
      value = { presets: [{ id: 'ds-hub-assistant', trust: 'user', broken: false }] };
    } else if (url === '/api/agentPreset.read') {
      value = { agentPreset: 'ds-hub-assistant', trust: 'user', content: presetContent };
    } else {
      throw new Error(`unexpected ${url}`);
    }
    return jsonResponse(200, {
      type: 'server-response',
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  }, { assistantPreset: 'ds-hub-assistant', assistantPresetDigest });
  const first = await context.DS_HUB_AI_ADAPTER.describeEnvironment();
  const second = await context.DS_HUB_AI_ADAPTER.describeEnvironment();
  assert.equal(first.evidenceRef, second.evidenceRef);
  assert.deepEqual(JSON.parse(JSON.stringify(first.selection)), JSON.parse(JSON.stringify(second.selection)));
});
