import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply } from '../lib/index.js';

async function invoke(route, { url, method = 'GET', headers = {}, body = '' }) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { url, method, headers: { host: '127.0.0.1:3080', ...headers } });
  const response = { status: 200, headers: {}, chunks: [] };
  const res = {
    writeHead(status, responseHeaders = {}) {
      response.status = status;
      response.headers = responseHeaders;
    },
    end(chunk) {
      if (chunk) response.chunks.push(Buffer.from(chunk));
    },
  };
  await route.handler(req, res);
  response.body = Buffer.concat(response.chunks).toString('utf8');
  return response;
}

test('host plugin serves same-origin Hub and exposes configured exact-entry preflight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-host-test-'));
  const profilePatchPath = join(root, 'cordis.patch.yml');
  await writeFile(profilePatchPath, '# profile\n[]\n');
  const entry = {
    id: 'include:tool-result-pruner',
    options: { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    disabled: true,
    fiber: undefined,
  };
  const routes = [];
  const disposers = [];
  const ctx = {
    loader: { entries: function* entries() { yield entry; } },
    webServer: {
      register(route) {
        routes.push(route);
        return () => routes.splice(routes.indexOf(route), 1);
      },
    },
    effect(factory) {
      disposers.push(factory());
    },
  };
  apply(ctx, { profilePatchPath, assistantPreset: 'ds-hub-assistant' });
  try {
    const apiRoute = routes.find((item) => item.path === '/ds-hub-api');
    const staticRoute = routes.find((item) => item.path === '/ds-hub');
    const capabilitiesResponse = await invoke(apiRoute, { url: '/ds-hub-api/capabilities' });
    const capabilities = JSON.parse(capabilitiesResponse.body);
    assert.equal(capabilities.pluginManagement.loaderMutation, true);
    assert.equal(capabilities.pluginManagement.packageInstall, false);
    assert.deepEqual(capabilities.pluginManagement.mutableEntries, [{
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: false,
      fiberPhase: null,
    }]);
    assert.match(capabilities.assistant.presetDigest, /^sha256:[a-f0-9]{64}$/);
    const preflightResponse = await invoke(apiRoute, {
      url: '/ds-hub-api/loader/preflight',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entryId: entry.id,
        moduleName: entry.options.name,
        desiredEnabled: true,
      }),
    });
    const preflight = JSON.parse(preflightResponse.body);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.canonicalValue.enabled, false);
    assert.match(preflight.targetRevision, /^sha256:[a-f0-9]{64}$/);
    const htmlResponse = await invoke(staticRoute, { url: '/ds-hub/' });
    assert.equal(htmlResponse.status, 200);
    assert.match(htmlResponse.body, /window\.__DS_HUB_RUNTIME_CONFIG__/);
    assert.match(htmlResponse.body, /<script src="dsh-live-adapter\.js"><\/script>/);
  } finally {
    for (const dispose of disposers.reverse()) dispose?.();
    await rm(root, { recursive: true, force: true });
  }
});
