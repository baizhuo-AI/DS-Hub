import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(scriptDir, '..');
const snapshotSource = fs.readFileSync(path.join(demoDir, 'dsh-snapshot.js'), 'utf8');
const appSource = fs.readFileSync(path.join(demoDir, 'app.js'), 'utf8');
const storageKey = 'ds-hub-optimization-state-v1';

class FakeElement {
  constructor() {
    this.innerHTML = '';
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.classList = { contains: () => false, toggle: () => {} };
  }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  focus() {}
}

function snapshotIdentity(snapshot) {
  return [snapshot.schemaVersion, snapshot.capturedAt, snapshot.source?.packageVersion, snapshot.source?.hostVersion].join('|');
}

function createRuntime({ storedState, mutateSnapshot, withAI = false } = {}) {
  const app = new FakeElement();
  const toasts = new FakeElement();
  const storage = new Map(storedState ? [[storageKey, JSON.stringify(storedState)]] : []);
  let capturedAIRequest = null;
  const document = {
    body: new FakeElement(),
    getElementById(id) { return id === 'app' ? app : id === 'toasts' ? toasts : null; },
    querySelector() { return null; },
    createElement() { return new FakeElement(); },
    addEventListener() {},
  };
  const context = {
    console,
    document,
    location: { hash: '' },
    setTimeout,
    clearTimeout,
    AbortController,
    matchMedia: () => ({ matches: false }),
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  vm.createContext(context);
  vm.runInContext(snapshotSource, context, { filename: 'dsh-snapshot.js' });
  mutateSnapshot?.(context.window.DSH_SNAPSHOT);
  if (withAI) {
    const selection = { ...context.window.DSH_SNAPSHOT.config.model };
    context.window.DS_HUB_AI_ADAPTER = {
      async describeEnvironment() {
        return {
          selection,
          settingsRevision: 'settings-live-1',
          targetId: 'settings:agent-default-model',
          evidenceRef: 'evidence:settings-live-1',
          source: 'smoke-live-read',
        };
      },
      async ask(request) {
        capturedAIRequest = request;
        throw new Error('smoke stops after capturing the redacted request');
      },
    };
  }
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return {
    app,
    context,
    storage,
    get capturedAIRequest() { return capturedAIRequest; },
  };
}

const snapshotRuntime = createRuntime();
const identity = snapshotIdentity(snapshotRuntime.context.window.DSH_SNAPSHOT);
const attemptedAt = '2026-08-27T22:00:00.000Z';
const storedUnknown = {
  schemaVersion: 1,
  snapshotIdentity: identity,
  assistantPlans: [{
    id: 'candidate-unknown',
    key: 'reasoningEffort',
    title: '调整新任务的推理强度',
    target: '伪造的目标',
    status: 'submitted-unverified',
    oldValue: 'SMOKE_OLD_VALUE',
    newValue: 'SMOKE_ATTEMPTED_VALUE',
    readbackValue: 'SMOKE_READBACK_VALUE',
  }],
  pendingRefreshRecords: [{
    markerType: 'unknown-write',
    key: 'reasoningEffort',
    target: '伪造的目标',
    targetId: 'settings:agent-default-model#/reasoningEffort',
    attemptedAt,
    trust: 'untrusted_browser_hint',
    attemptedValue: 'SMOKE_ATTEMPTED_VALUE',
    oldValue: 'SMOKE_OLD_VALUE',
    readbackValue: 'SMOKE_READBACK_VALUE',
  }],
};

// The marker is established and persisted before the adapter write boundary.
const applyBoundary = appSource.indexOf('const applyResult = await adapter.apply(writeRequest)');
assert.ok(applyBoundary > 0, 'apply boundary should exist');
assert.ok(appSource.lastIndexOf('upsertUnknownWriteMarker(proposal, writeAttemptedAt)', applyBoundary) > 0, 'unknown marker should be created before apply');
assert.ok(appSource.lastIndexOf('if (!persistOptimizationState())', applyBoundary) > 0, 'unknown marker should be persisted before apply');

// A failed/unknown write marker survives reload, masks the value and gates full config.
const blocked = createRuntime({ storedState: storedUnknown, withAI: true });
assert.match(blocked.app.innerHTML, /写入状态未知/);
assert.doesNotMatch(blocked.app.innerHTML, /SMOKE_(?:OLD|ATTEMPTED|READBACK)_VALUE/);
blocked.context.goQuick();
assert.match(blocked.app.innerHTML, /当前值等待重新核验/);
assert.doesNotMatch(blocked.app.innerHTML, /SMOKE_(?:OLD|ATTEMPTED|READBACK)_VALUE/);
blocked.context.goWorkshop();
assert.match(blocked.app.innerHTML, /完整能力等待重新同步/);
assert.match(blocked.app.innerHTML, /真实状态未知/);
assert.doesNotMatch(blocked.app.innerHTML, /已修改|已安装并回读|已写入并回读/);

// Persistence is an allowlisted, value-free projection.
const persisted = JSON.parse(blocked.storage.get(storageKey));
assert.deepEqual(Object.keys(persisted.pendingRefreshRecords[0]).sort(), ['attemptedAt', 'key', 'markerType', 'target', 'targetId', 'trust'].sort());
assert.equal(persisted.pendingRefreshRecords[0].target, '默认模型的推理强度');
assert.equal(persisted.pendingRefreshRecords[0].trust, 'untrusted_browser_hint');
assert.doesNotMatch(JSON.stringify(persisted), /SMOKE_(?:OLD|ATTEMPTED|READBACK)_VALUE/);

// AI receives only the marker identity/trust for the affected value; no plan,
// conversation, old, attempted or readback values are restored into context.
blocked.context.attachAssistantContext('module/tools');
await blocked.context.sendAssistantMessage('说明为什么需要重新核验');
const aiContext = blocked.capturedAIRequest?.context;
assert.ok(aiContext, 'AI request context should be captured');
assert.deepEqual(JSON.parse(JSON.stringify(aiContext.focusItems)), [{
  ref: 'module/tools',
  kind: 'module',
  title: '工具模块',
  availability: 'state_unknown',
  valuesWithheld: true,
}]);
assert.deepEqual(JSON.parse(JSON.stringify(aiContext.config.pendingRefresh)), [{ key: 'reasoningEffort', markerTrust: 'untrusted_browser_hint' }]);
assert.equal(aiContext.config.reasoningEffort, null);
assert.equal(aiContext.config.pluginLoaderEntryCount, null);
assert.equal(aiContext.config.skillCount, null);
assert.deepEqual(JSON.parse(JSON.stringify(aiContext.conversation)), []);
assert.doesNotMatch(JSON.stringify(aiContext), /SMOKE_(?:OLD|ATTEMPTED|READBACK)_VALUE/);

// A new real snapshot identity invalidates the browser hint and restores the
// normal view; the next render also clears the old marker from storage.
const refreshed = createRuntime({
  storedState: persisted,
  mutateSnapshot(snapshot) { snapshot.capturedAt = '2026-08-28T00:00:00.000Z'; },
});
refreshed.context.goWorkshop();
assert.doesNotMatch(refreshed.app.innerHTML, /完整能力等待重新同步|写入状态未知/);
assert.match(refreshed.app.innerHTML, /当前角色卡/);
assert.deepEqual(JSON.parse(refreshed.storage.get(storageKey)).pendingRefreshRecords, []);

console.log('PASS unknown-write smoke: reload gate, honest copy, AI redaction, new-snapshot clear');
