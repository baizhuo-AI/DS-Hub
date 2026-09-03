#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const snapshotSource = await readFile(new URL('dsh-snapshot.js', root), 'utf8');
const appSource = await readFile(new URL('app.js', root), 'utf8');
const indexSource = await readFile(new URL('index.html', root), 'utf8');

function inertElement(onFocus = null, tagName = 'DIV') {
  return {
    innerHTML: '',
    children: [],
    inert: false,
    scrollTop: 0,
    scrollHeight: 0,
    tagName,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    focus(options) { onFocus?.(options); },
    select() {},
    scrollIntoView() {},
    setSelectionRange() {},
    setAttribute() {},
    appendChild() {},
    remove() {},
    contains() { return false; },
    querySelectorAll() { return []; },
  };
}

function boot(hash = '') {
  const focusCalls = [];
  const documentListeners = new Map();
  const appRoot = inertElement();
  const toastRoot = inertElement();
  const fallback = inertElement();
  const storage = new Map();
  const focusTarget = (selector) => {
    const isControl = /^\[data-|^#open-|button|input|select|textarea|^\.library-search/.test(selector);
    const element = inertElement((options) => focusCalls.push({ selector, options }), isControl ? 'BUTTON' : 'DIV');
    element.classList.contains = (className) => selector.includes(`.${className}`);
    return element;
  };
  const visibleModal = (selector) => {
    if (selector === '.plugin-dialog[aria-modal="true"]') return /class="plugin-dialog [^"]*"[^>]*aria-modal="true"/.test(appRoot.innerHTML);
    if (selector === '.drawer[aria-modal="true"]') return /class="drawer[^"]*"[^>]*aria-modal="true"/.test(appRoot.innerHTML);
    if (selector === '.config-assistant[aria-modal="true"]') return /class="config-assistant[^"]*"[^>]*aria-modal="true"/.test(appRoot.innerHTML);
    return true;
  };
  const context = {
    console,
    Date,
    Intl,
    Math,
    JSON,
    Set,
    Map,
    Object,
    String,
    Number,
    Boolean,
    Array,
    RegExp,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    location: { hash },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => callback(),
    document: {
      activeElement: fallback,
      body: { classList: fallback.classList },
      getElementById(id) {
        if (id === 'app') return appRoot;
        if (id === 'toasts') return toastRoot;
        return focusTarget(`#${id}`);
      },
      querySelector(selector) { return visibleModal(selector) ? focusTarget(selector) : null; },
      querySelectorAll() { return []; },
      createElement() { return inertElement(); },
      addEventListener(type, handler) { documentListeners.set(type, handler); },
    },
  };
  context.window = context;
  context.DS_HUB_ENABLE_TEST_HOOKS = true;
  context.localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  vm.createContext(context);
  vm.runInContext(snapshotSource, context, { filename: 'dsh-snapshot.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { context, appRoot, storage, focusCalls, documentListeners };
}

function startTagsWithClass(html, className) {
  const tags = [];
  for (const match of html.matchAll(/<(a|button)\b[^>]*>/g)) {
    if (new RegExp(`\\bclass="[^"]*\\b${className}\\b`).test(match[0])) tags.push({ name: match[1], source: match[0] });
  }
  return tags;
}

function sectionBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `missing section marker: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `missing section terminator: ${endMarker}`);
  return html.slice(start, end);
}

const runtime = boot();
const hooks = runtime.context.DS_HUB_TEST_HOOKS;
assert.ok(hooks, 'plugin contract smoke requires DS_HUB_TEST_HOOKS');
for (const name of ['loaderEntryIdentity', 'pluginInventoryRows', 'groupPluginRows', 'pluginEntryPresentation', 'componentLocationFromRef']) {
  assert.equal(typeof hooks[name], 'function', `${name} must be exposed to the smoke runtime`);
}
for (const name of ['isHostRootLoaderEntry', 'normalizeLoaderBridgeReceipt']) {
  assert.equal(typeof hooks[name], 'function', `${name} must be exposed for Loader bridge contract tests`);
}

// Every preloaded community row carries a dated, exact-version audit. Catalog
// review is still only candidate evidence: it must say when source or local
// compatibility needs more work and must never claim a real installation.
const auditedCommunity = JSON.parse(JSON.stringify(hooks.communityComponents));
assert.equal(auditedCommunity.length, 8, 'all eight community presets need an audit contract');
for (const item of auditedCommunity) {
  assert.match(item.auditedAt, /^2026-08-28$/);
  assert.match(item.latestVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.ok(item.versionStatus, `${item.packageName} needs a human version status`);
  assert.ok(item.provenanceReview, `${item.packageName} needs a provenance review`);
  assert.match(item.localCompatibility, /尚未实装/, `${item.packageName} must not imply an observed install`);
}
assert.deepEqual(
  auditedCommunity.filter((item) => item.versionStatus.includes('有新版')).map((item) => item.packageName),
  ['dshmarket', 'dsh-context'],
  'only the two audited stale pins should advertise a newer version',
);
for (const packageName of ['dsh-better-sidebar', '@linxin666/dsh-doctor']) {
  assert.match(auditedCommunity.find((item) => item.packageName === packageName).localCompatibility, /需隔离兼容实测/);
}
for (const packageName of ['@linxin666/dsh-client-ui-task-board', '@linxin666/dsh-doctor']) {
  assert.match(auditedCommunity.find((item) => item.packageName === packageName).provenanceReview, /需人工来源审核/);
}
for (const packageName of ['dshmarket', '@liustack/modlens', 'dsh-context', '@nanmicoder/dsh-agent-teams', 'dsh-vision-router']) {
  const item = auditedCommunity.find((candidate) => candidate.packageName === packageName);
  assert.match(item.localCompatibility, /目录记录为初步兼容；尚未实装，安装前仍需实时复核/);
  assert.match(item.provenanceReview, /本次未实时复核/);
}

// Every observed Loader row keeps a stable compound identity. Grouping by npm
// package is only presentation: it must neither drop nor merge Loader entries.
const snapshotRows = Array.from(hooks.pluginInventoryRows());
const groups = Array.from(hooks.groupPluginRows(snapshotRows));
const groupedEntries = groups.flatMap((group) => Array.from(group.entries));
assert.equal(groupedEntries.length, snapshotRows.length, 'package grouping must preserve every Loader entry');
const identities = groupedEntries.map((entry) => entry.identity);
assert.equal(identities.every(Boolean), true, 'every Loader entry needs a compound identity');
assert.equal(new Set(identities).size, identities.length, 'compound Loader identities must be unique');

const identityFixture = {
  packageName: '@deepseek-ai/dsh-example',
  moduleName: '@deepseek-ai/dsh-example/runtime',
  entryId: 'include:example',
  scope: 'Web Profile / Host',
};
const stableIdentity = hooks.loaderEntryIdentity(identityFixture.packageName, identityFixture);
assert.equal(hooks.loaderEntryIdentity(identityFixture.packageName, { ...identityFixture }), stableIdentity);
for (const [field, value] of [
  ['packageName', '@deepseek-ai/dsh-example-two'],
  ['moduleName', '@deepseek-ai/dsh-example/other'],
  ['entryId', 'include:other'],
  ['scope', '默认 Agent Preset'],
]) {
  const changed = { ...identityFixture, [field]: value };
  const packageName = field === 'packageName' ? value : identityFixture.packageName;
  assert.notEqual(hooks.loaderEntryIdentity(packageName, changed), stableIdentity, `${field} must participate in Loader identity`);
}

// The screenshot case is one plugin package with two independently explained
// Loader entries, not two anonymous plugins or one package-wide switch.
const prunerPackage = '@deepseek-ai/dsh-compaction-tool-result-pruner';
const prunerGroup = groups.find((group) => group.packageName === prunerPackage);
assert.ok(prunerGroup, 'tool-result-pruner package must be present');
assert.equal(prunerGroup.entries.length, 2, 'tool-result-pruner must retain both Loader entries');
const hostPruner = prunerGroup.entries.find((entry) => entry.entryId === 'include:tool-result-pruner');
const presetPruner = prunerGroup.entries.find((entry) => entry.entryId === 'include:agent-presets:tool-result-pruner');
assert.ok(hostPruner && presetPruner, 'both tool-result-pruner entryIds must remain addressable');
assert.equal(hostPruner.enabled, false);
assert.equal(hostPruner.fiberPhase, null);
assert.equal(presetPruner.enabled, true);
assert.equal(presetPruner.fiberPhase, 'active');
assert.equal(hooks.pluginEntryPresentation(hostPruner).title, 'DSH 后台也会使用它');
assert.equal(hooks.pluginEntryPresentation(presetPruner).title, '当前 Agent 使用它来缩短结果');

// Native plugin details use a centered dialog. Non-plugin component details may
// still use the existing drawer, so the assertion is scoped to this plugin.
runtime.context.jumpToCapability('memory', 'context');
const prunerRef = `component/memory/context/plugin/${encodeURIComponent(prunerPackage)}`;
const originalLocation = hooks.componentLocationFromRef(prunerRef);
assert.ok(originalLocation, 'stable component ref must resolve after indexing');
const originalComponent = originalLocation.component;
const originalIndex = originalLocation.ability.components.indexOf(originalComponent);
const destinationIndex = originalIndex === 0 ? originalLocation.ability.components.length - 1 : 0;
originalLocation.ability.components.splice(originalIndex, 1);
originalLocation.ability.components.splice(destinationIndex, 0, originalComponent);
const reorderedLocation = hooks.componentLocationFromRef(prunerRef);
assert.equal(reorderedLocation?.component, originalComponent, 'stable ref must survive component-list reorder');
const reorderedIndex = reorderedLocation.ability.components.indexOf(originalComponent);
runtime.context.openComponent('memory', 'context', reorderedIndex);
assert.equal(hooks.state.componentDetail, prunerRef, 'openComponent must store the stable component ref, not a list index');
assert.equal(runtime.focusCalls.at(-1)?.selector, '.plugin-dialog,.drawer', 'opening native details must move focus into the dialog');
const nativeHtml = runtime.appRoot.innerHTML;
assert.match(nativeHtml, /<section class="plugin-dialog native-plugin-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(nativeHtml, /<section class="plugin-dialog native-plugin-dialog"[^>]*tabindex="-1"/);
assert.doesNotMatch(nativeHtml, /<aside class="drawer"[^>]*aria-label="组件详情"/);
assert.match(indexSource, /\.plugin-dialog-layer\{[^}]*display:grid[^}]*place-items:center/);
assert.match(indexSource, /\.plugin-dialog\{[^}]*width:min\(760px,100%\)[^}]*max-height:/);
assert.match(indexSource, /body\.modal-open\{overflow:hidden\}/);
assert.match(nativeHtml, /1 个插件 · 2 个使用位置/);
assert.match(nativeHtml, /这是同一个插件/);
assert.match(nativeHtml, /<details class="plugin-entry-technical"><summary>查看技术信息<\/summary>/);
assert.match(nativeHtml, /DSH 后台也会使用它[\s\S]*未启用[\s\S]*include:tool-result-pruner/);
assert.match(nativeHtml, /当前 Agent 使用它来缩短结果[\s\S]*已启用 · 运行中[\s\S]*include:agent-presets:tool-result-pruner/);
assert.match(nativeHtml, /DSH 后台也会使用它[\s\S]*class="entry-state-action" disabled[\s\S]*尚未连接后台管理能力/);
assert.match(nativeHtml, /当前 Agent 使用它来缩短结果[\s\S]*class="entry-state-action"[^>]*disabled[^>]*>当前只读/);
assert.doesNotMatch(nativeHtml, /当前 Agent 使用它来缩短结果[\s\S]*preparePluginPresetState\([^>]*>停用/);
const renderedEntryIdentities = [...nativeHtml.matchAll(/data-loader-entry-ref="([^"]+)"/g)].map((match) => match[1]);
assert.equal(renderedEntryIdentities.length, 2);
assert.equal(new Set(renderedEntryIdentities).size, renderedEntryIdentities.length);

// Entry controls create reviewable candidates. They must not mutate the
// snapshot-backed current state or present a draft as a completed write.
const presetSnapshotRow = runtime.context.DSH_SNAPSHOT.config.presetRows.find((row) => row.id === 'tool-result-pruner');
const presetSnapshotBefore = JSON.stringify(presetSnapshotRow);
runtime.context.preparePluginPresetState('tool-result-pruner', false);
const stateCandidate = hooks.state.assistantTask?.candidate;
assert.equal(stateCandidate?.key, 'presetToolPatch');
assert.equal(stateCandidate?.status, 'draft');
assert.equal(stateCandidate?.oldValue?.enabled, true);
assert.equal(stateCandidate?.expectedValue?.enabled, false);
assert.equal(JSON.stringify(presetSnapshotRow), presetSnapshotBefore, 'state candidate must not change the current Preset row');
assert.match(runtime.appRoot.innerHTML, /更改候选已就绪[\s\S]*当前状态还没有改变/);
assert.doesNotMatch(runtime.appRoot.innerHTML, /候选已采用并回读一致/);

runtime.context.updateQuickToolConfig('tool-result-pruner', 'thresholdChars', '4096');
runtime.context.preparePluginPresetConfig('tool-result-pruner');
const configCandidate = hooks.state.assistantTask?.candidate;
assert.equal(configCandidate?.key, 'presetToolPatch');
assert.equal(configCandidate?.status, 'draft');
assert.deepEqual(
  JSON.parse(JSON.stringify(configCandidate?.expectedValue?.config)),
  { thresholdChars: 4096, headChars: 4096, tailChars: 1024 },
  'config candidate must preserve the complete typed config while changing one known field',
);
assert.equal(JSON.stringify(presetSnapshotRow), presetSnapshotBefore, 'config candidate must not change the current Preset row');

// Reordering again while the dialog is open must not make the selected plugin
// resolve to a different component.
reorderedLocation.ability.components.reverse();
runtime.context.render();
assert.equal(hooks.componentLocationFromRef(prunerRef)?.component, originalComponent);
assert.match(runtime.appRoot.innerHTML, /id="plugin-dialog-title"[^>]*>工具结果裁剪</);

const nativeKeydown = runtime.documentListeners.get('keydown');
assert.equal(typeof nativeKeydown, 'function', 'keyboard handler must be registered');
nativeKeydown({ key: 'Escape' });
assert.equal(hooks.state.componentDetail, null, 'Escape must close native plugin details');
assert.equal(runtime.focusCalls.at(-1)?.selector, '.capability-focus-page', 'closing native details must restore focus inside the active capability page without constructing a selector from component identity');

// Host Loader writes use a separate, exact-entry bridge. Capabilities only
// unlock the Host root row; Preset entries keep their candidate workflow.
const REVISION_BEFORE = `sha256:${'a'.repeat(64)}`;
const REVISION_AFTER = `sha256:${'b'.repeat(64)}`;
const hostValue = (enabled, fiberPhase = enabled ? 'active' : null) => ({
  entryId: hostPruner.entryId,
  moduleName: hostPruner.moduleName,
  enabled,
  fiberPhase,
});
const preflightReceipt = () => ({
  ok: true,
  mutable: true,
  scope: 'web-profile-root-loader-entry',
  targetId: `loader-entry:web:${encodeURIComponent(hostPruner.entryId)}`,
  targetRevision: REVISION_BEFORE,
  canonicalValue: hostValue(false),
  desiredValue: { enabled: true },
  evidenceRef: 'dsh-loader-preflight:test',
});
const applyReceipt = () => ({
  ok: true,
  applied: true,
  targetId: `loader-entry:web:${encodeURIComponent(hostPruner.entryId)}`,
  targetRevision: REVISION_AFTER,
  canonicalValue: hostValue(true),
  readback: hostValue(true),
  evidenceRef: 'dsh-loader-readback:test',
});

assert.equal(hooks.isHostRootLoaderEntry(hostPruner), true);
assert.equal(hooks.isHostRootLoaderEntry(presetPruner), false);
assert.ok(hooks.normalizeLoaderBridgeReceipt(preflightReceipt(), hostPruner, 'preflight', true));
assert.ok(hooks.normalizeLoaderBridgeReceipt(applyReceipt(), hostPruner, 'apply', true));
assert.equal(hooks.normalizeLoaderBridgeReceipt({ ...applyReceipt(), targetId: 'loader-entry:web:wrong' }, hostPruner, 'apply', true), null);
assert.equal(hooks.normalizeLoaderBridgeReceipt({ ...applyReceipt(), readback: { ...hostValue(true), entryId: presetPruner.entryId } }, hostPruner, 'apply', true), null);
assert.equal(hooks.normalizeLoaderBridgeReceipt({ ...applyReceipt(), canonicalValue: hostValue(true, 'loading'), readback: hostValue(true, 'loading') }, hostPruner, 'apply', true), null);

async function openManagedPruner(adapter) {
  const managedRuntime = boot();
  managedRuntime.context.DS_HUB_PLUGIN_ADAPTER = adapter;
  await managedRuntime.context.checkPluginManagementCapability();
  const managedHooks = managedRuntime.context.DS_HUB_TEST_HOOKS;
  managedRuntime.context.jumpToCapability('memory', 'context');
  const location = managedHooks.componentLocationFromRef(prunerRef);
  managedRuntime.context.openComponent('memory', 'context', location.ability.components.indexOf(location.component));
  const managedHost = location.component.entries.find((entry) => entry.entryId === hostPruner.entryId);
  const managedPreset = location.component.entries.find((entry) => entry.entryId === presetPruner.entryId);
  return { managedRuntime, managedHooks, managedHost, managedPreset };
}

let disabledBridgeCalls = 0;
const disabledBridge = await openManagedPruner({
  async capabilities() { return { ok: true, pluginManagement: { loaderMutation: false } }; },
  async preflight() { disabledBridgeCalls += 1; },
  async setEnabled() { disabledBridgeCalls += 1; },
});
assert.equal(disabledBridge.managedHooks.state.pluginManagementCapability.status, 'unavailable');
assert.match(disabledBridge.managedRuntime.appRoot.innerHTML, /DSH 后台也会使用它[\s\S]*class="entry-state-action" disabled[\s\S]*尚未连接后台管理能力/);
disabledBridge.managedRuntime.context.requestLoaderEntryToggle(disabledBridge.managedHost.identity);
assert.equal(disabledBridge.managedHooks.state.loaderEntryAction, null);
assert.equal(disabledBridgeCalls, 0, 'disabled bridge must never receive a write request');

const happyBridgeCalls = [];
const managedSuccess = await openManagedPruner({
  async capabilities() { return { ok: true, pluginManagement: { loaderMutation: true, mutableEntries: [hostValue(false)] } }; },
  async preflight(request) { happyBridgeCalls.push(['preflight', request]); return preflightReceipt(); },
  async setEnabled(request) { happyBridgeCalls.push(['setEnabled', request]); return applyReceipt(); },
});
assert.equal(managedSuccess.managedHooks.state.pluginManagementCapability.status, 'ready');
assert.doesNotMatch(
  managedSuccess.managedRuntime.appRoot.innerHTML.match(new RegExp(`data-loader-action-ref="${managedSuccess.managedHost.identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))?.[0] || '',
  /disabled/,
);
managedSuccess.managedRuntime.context.requestLoaderEntryToggle(managedSuccess.managedPreset.identity);
assert.equal(managedSuccess.managedHooks.state.loaderEntryAction, null, 'Preset entry must not enter the Host bridge');
managedSuccess.managedRuntime.context.requestLoaderEntryToggle(managedSuccess.managedHost.identity);
assert.equal(managedSuccess.managedHooks.state.loaderEntryAction?.status, 'confirm');
assert.equal(happyBridgeCalls.length, 0, 'first click only opens the exact-entry confirmation');
assert.match(managedSuccess.managedRuntime.appRoot.innerHTML, /确认启用这个使用位置？[\s\S]*其他使用位置不受影响/);
await managedSuccess.managedRuntime.context.applyLoaderEntryToggle(managedSuccess.managedHost.identity);
assert.deepEqual(JSON.parse(JSON.stringify(happyBridgeCalls[0])), ['preflight', {
  entryId: hostPruner.entryId,
  moduleName: hostPruner.moduleName,
  desiredEnabled: true,
}]);
assert.equal(happyBridgeCalls[1][0], 'setEnabled');
assert.equal(happyBridgeCalls[1][1].entryId, hostPruner.entryId);
assert.equal(happyBridgeCalls[1][1].moduleName, hostPruner.moduleName);
assert.equal(happyBridgeCalls[1][1].enabled, true);
assert.equal(happyBridgeCalls[1][1].expectedRevision, REVISION_BEFORE);
assert.equal(happyBridgeCalls[1][1].expectedEnabled, false);
assert.match(happyBridgeCalls[1][1].idempotencyKey, /^loader-entry-toggle:/);
assert.equal(managedSuccess.managedHooks.state.loaderEntryAction?.status, 'success');
assert.deepEqual(
  JSON.parse(JSON.stringify(managedSuccess.managedHooks.state.loaderEntryReadbacks[managedSuccess.managedHost.identity])),
  { ...hostValue(true), targetRevision: REVISION_AFTER, evidenceRef: 'dsh-loader-readback:test' },
);
const successfulLocation = managedSuccess.managedHooks.componentLocationFromRef(prunerRef);
assert.equal(successfulLocation.component.entries.find((entry) => entry.entryId === hostPruner.entryId).enabled, true);
assert.equal(successfulLocation.component.entries.find((entry) => entry.entryId === presetPruner.entryId).enabled, true, 'exact Host readback must not alter the Preset entry');
assert.match(managedSuccess.managedRuntime.appRoot.innerHTML, /已写入并回读[\s\S]*其他位置不受影响/);

// Treat Loader identity as untrusted presentation data even if the Host also
// validates module names. A quote-bearing stored identity must be carried only
// through escaped data attributes and delegated events, never interpolated into
// inline JavaScript.
const hostileRuntime = boot();
const hostileHooks = hostileRuntime.context.DS_HUB_TEST_HOOKS;
const hostileLocation = hostileHooks.componentLocationFromRef(prunerRef);
const hostileHost = hostileLocation.component.entries.find((entry) => entry.entryId === hostPruner.entryId);
const hostileMarker = '__loader_inline_handler_pwned__';
const hostileIdentity = `loader');window.${hostileMarker}=true;//`;
hostileHost.identity = hostileIdentity;
hostileRuntime.context.DS_HUB_PLUGIN_ADAPTER = {
  async capabilities() {
    return {
      ok: true,
      pluginManagement: {
        loaderMutation: true,
        mutableEntries: [{
          entryId: hostileHost.entryId,
          moduleName: hostileHost.moduleName,
          enabled: hostileHost.enabled,
          fiberPhase: hostileHost.fiberPhase,
        }],
      },
    };
  },
  async preflight() { throw new Error('not used by inline-handler smoke'); },
  async setEnabled() { throw new Error('not used by inline-handler smoke'); },
};
await hostileRuntime.context.checkPluginManagementCapability();
hostileRuntime.context.jumpToCapability('memory', 'context');
hostileRuntime.context.openComponent('memory', 'context', hostileLocation.ability.components.indexOf(hostileLocation.component));
let hostileHtml = hostileRuntime.appRoot.innerHTML;
let loaderCommandTags = [...hostileHtml.matchAll(/<button\b[^>]*data-loader-command="[^"]+"[^>]*>/g)].map((match) => match[0]);
assert.equal(loaderCommandTags.length, 1);
assert.match(loaderCommandTags[0], /data-loader-command="request"/);
assert.match(loaderCommandTags[0], /data-loader-action-ref="loader&#39;\);window\.__loader_inline_handler_pwned__=true;\/\/"/);
assert.doesNotMatch(loaderCommandTags[0], /onclick=/);

hostileRuntime.context.requestLoaderEntryToggle(hostileIdentity);
hostileHtml = hostileRuntime.appRoot.innerHTML;
loaderCommandTags = [...hostileHtml.matchAll(/<button\b[^>]*data-loader-command="[^"]+"[^>]*>/g)].map((match) => match[0]);
assert.deepEqual(
  loaderCommandTags.map((tag) => tag.match(/data-loader-command="([^"]+)"/)?.[1]).sort(),
  ['apply', 'cancel', 'request'],
);
assert.equal(loaderCommandTags.every((tag) => !/onclick=/.test(tag)), true);
assert.equal(loaderCommandTags.every((tag) => /data-loader-action-ref=/.test(tag)), true);
for (const tag of hostileHtml.matchAll(/<(?:button|article)\b[^>]*>/g)) {
  assert.equal(
    tag[0].includes(hostileMarker) && /onclick=/.test(tag[0]),
    false,
    'untrusted Loader identity must never share an element with inline JavaScript',
  );
}
assert.doesNotMatch(hostileHtml, /onclick="(?:request|cancel|apply)LoaderEntryToggle/);

let protectedBridgeCalls = 0;
const protectedRuntime = boot();
protectedRuntime.context.DS_HUB_PLUGIN_ADAPTER = {
  async capabilities() { return { ok: true, pluginManagement: { loaderMutation: true, mutableEntries: [hostValue(false)] } }; },
  async preflight() { protectedBridgeCalls += 1; },
  async setEnabled() { protectedBridgeCalls += 1; },
};
await protectedRuntime.context.checkPluginManagementCapability();
const protectedHooks = protectedRuntime.context.DS_HUB_TEST_HOOKS;
const protectedPackage = '@deepseek-ai/dsh-api-gateway';
const protectedRef = `component/tools/extensions/plugin/${encodeURIComponent(protectedPackage)}`;
const protectedLocation = protectedHooks.componentLocationFromRef(protectedRef);
assert.ok(protectedLocation, 'a core DSH package must stay visible as read-only inventory');
protectedRuntime.context.jumpToCapability('tools', 'extensions');
protectedRuntime.context.openComponent('tools', 'extensions', protectedLocation.ability.components.indexOf(protectedLocation.component));
assert.match(protectedRuntime.appRoot.innerHTML, /当前只能查看，不能修改/);
assert.match(protectedRuntime.appRoot.innerHTML, /这一处受系统保护，目前只能查看/);
const protectedEntry = protectedLocation.component.entries.find((entry) => entry.entryId === 'include:typert-gateway');
assert.ok(protectedEntry);
protectedRuntime.context.requestLoaderEntryToggle(protectedEntry.identity);
assert.equal(protectedHooks.state.loaderEntryAction, null);
assert.equal(protectedBridgeCalls, 0, 'protected core entries must never reach the Host mutation bridge');

async function failedManagedWrite(errorOrReceipt) {
  let setCalls = 0;
  const result = await openManagedPruner({
    async capabilities() { return { ok: true, pluginManagement: { loaderMutation: true, mutableEntries: [hostValue(false)] } }; },
    async preflight() { return preflightReceipt(); },
    async setEnabled() {
      setCalls += 1;
      if (errorOrReceipt instanceof Error) throw errorOrReceipt;
      return errorOrReceipt;
    },
  });
  result.managedRuntime.context.requestLoaderEntryToggle(result.managedHost.identity);
  await result.managedRuntime.context.applyLoaderEntryToggle(result.managedHost.identity);
  assert.equal(setCalls, 1);
  assert.equal(result.managedHooks.state.loaderEntryReadbacks[result.managedHost.identity], undefined);
  assert.equal(result.managedHooks.componentLocationFromRef(prunerRef).component.entries.find((entry) => entry.entryId === hostPruner.entryId).enabled, false);
  return result;
}

const revisionError = Object.assign(new Error('changed'), { code: 'revision-conflict', state: 'unchanged' });
const revisionFailure = await failedManagedWrite(revisionError);
assert.equal(revisionFailure.managedHooks.state.loaderEntryAction?.status, 'error');
assert.match(revisionFailure.managedRuntime.appRoot.innerHTML, /未修改[\s\S]*目标版本已变化，本次安全未写入/);

const unknownError = Object.assign(new Error('unknown'), { code: 'state-unknown', state: 'unknown' });
const unknownFailure = await failedManagedWrite(unknownError);
assert.equal(unknownFailure.managedHooks.state.loaderEntryAction?.status, 'unknown');
assert.match(unknownFailure.managedRuntime.appRoot.innerHTML, /当前状态未知[\s\S]*不把它当作成功/);
assert.doesNotMatch(unknownFailure.managedRuntime.appRoot.innerHTML, /已写入并回读/);

const incompleteFailure = await failedManagedWrite({ ...applyReceipt(), readback: { ...hostValue(true), moduleName: `${hostPruner.moduleName}/wrong` } });
assert.equal(incompleteFailure.managedHooks.state.loaderEntryAction?.status, 'unknown', 'an incomplete post-write receipt must become unknown');
assert.match(incompleteFailure.managedRuntime.appRoot.innerHTML, /当前状态未知[\s\S]*完整回执无法确认/);
assert.doesNotMatch(incompleteFailure.managedRuntime.appRoot.innerHTML, /已写入并回读/);

// Community cards are in-app entry points. Repository and npm links, plus the
// install CTA, belong in the centered introduction dialog only.
const communityRuntime = boot();
communityRuntime.context.jumpToCapability('tools', 'extensions');
const shelfTags = startTagsWithClass(communityRuntime.appRoot.innerHTML, 'community-mini');
assert.ok(shelfTags.length > 0, 'community shelf should render at least one candidate');
for (const tag of shelfTags) {
  assert.equal(tag.name, 'button', 'community shelf cards must open in-app');
  assert.doesNotMatch(tag.source, /\bhref=/, 'community shelf card must not navigate to GitHub');
}
assert.doesNotMatch(communityRuntime.appRoot.innerHTML, /class="community-mini"[^>]*target="_blank"/);
assert.match(communityRuntime.appRoot.innerHTML, /data-community-ref="dshmarket"[\s\S]*候选未实装 · 有新版 v1\.35\.0/);

communityRuntime.context.openLibrary('community');
const libraryHtml = communityRuntime.appRoot.innerHTML;
const communityLibrary = sectionBetween(libraryHtml, '<div class="community-library">', '<div class="community-disclaimer">');
assert.match(communityLibrary, /openCommunityDetail\(/, 'library candidates must open the in-app introduction');
assert.doesNotMatch(communityLibrary, /target="_blank"|https:\/\/github\.com|npmjs\.com/, 'external links belong in the detail dialog, not the library card');
assert.match(communityLibrary, /dshmarket[\s\S]*有新版 v1\.35\.0/);
assert.match(communityLibrary, /dsh-context[\s\S]*有新版 v0\.36\.0/);

communityRuntime.context.openCommunityDetail('dshmarket', 'module');
const communityHtml = communityRuntime.appRoot.innerHTML;
assert.match(communityHtml, /<section class="plugin-dialog community-plugin-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.equal(communityRuntime.focusCalls.at(-1)?.selector, '.community-plugin-dialog', 'opening community details must move focus into the dialog');
assert.match(communityHtml, /id="community-dialog-title"[^>]*>DSH 社区插件市场</);
assert.match(communityHtml, /class="community-source-links"[\s\S]*npm 包 ↗[\s\S]*源码仓库 ↗/);
assert.match(communityHtml, /rel="noopener noreferrer"/);
assert.match(communityHtml, /class="primary community-install-cta"[^>]*disabled[^>]*>检查后安装</);
assert.match(communityHtml, /目录固定版本[\s\S]*v1\.34\.0/);
assert.match(communityHtml, /npm 最新版本[\s\S]*v1\.35\.0/);
assert.match(communityHtml, /版本状态[\s\S]*有新版 v1\.35\.0；目录固定 v1\.34\.0/);
assert.match(communityHtml, /目录来源记录[\s\S]*本次未实时复核/);
assert.match(communityHtml, /目录兼容性备注[\s\S]*安装前仍需实时复核/);
assert.match(communityHtml, /目录更新时间[\s\S]*2026-08-28/);
assert.match(communityHtml, /准备安装方案/);
assert.doesNotMatch(communityHtml, /一键安装/);
assert.doesNotMatch(communityHtml, /实时核验版本|已安装并回读/);

// A static catalog entry is discovery data, not verified installation input.
// With no adapter, even a direct function call cannot create a candidate or a
// fake success state.
assert.equal(communityRuntime.context.DS_HUB_OPTIMIZATION_ADAPTER, undefined);
const communityHooks = communityRuntime.context.DS_HUB_TEST_HOOKS;
const installsBefore = JSON.stringify(communityHooks.state.verifiedInstalls);
assert.equal(communityHooks.state.assistantTask, null);
await communityRuntime.context.installCommunityFromDialog('dshmarket');
assert.equal(communityHooks.state.assistantTask, null, 'missing adapter must not create an install candidate');
assert.equal(JSON.stringify(communityHooks.state.verifiedInstalls), installsBefore, 'missing adapter must not fabricate an installed plugin');
assert.doesNotMatch(communityRuntime.appRoot.innerHTML, /已安装并回读/);

const communityKeydown = communityRuntime.documentListeners.get('keydown');
communityKeydown({ key: 'Escape' });
assert.equal(communityHooks.state.communityDetail, null, 'Escape must close community plugin details');
assert.equal(communityRuntime.focusCalls.at(-1)?.selector, '#open-community-library', 'closing community details must restore focus without constructing a selector from catalog identity');

// Search metadata alone is insufficient. The action stays disabled until the
// Host explicitly advertises packageInstall; even then it only prepares a
// pinned-version test plan and cannot claim anything is installed/enabled.
const liveRuntime = boot();
liveRuntime.context.DS_HUB_OPTIMIZATION_ADAPTER = {
  async searchCommunity() {
    return [{
      packageName: 'dshmarket',
      displayNameZh: 'DSH 社区插件市场',
      summaryZh: '在 DSH 内浏览和管理社区插件。',
      version: '1.34.0',
      license: 'MIT',
      compatibility: 'verified',
      verifiedAt: '2026-08-28T12:00:00Z',
      repoUrl: 'https://github.com/dsh-market/dsh-market',
      versionEvidenceUrl: 'https://www.npmjs.com/package/dshmarket/v/1.34.0',
      compatibilityEvidenceUrl: 'https://github.com/dsh-market/dsh-market/tree/v1.34.0',
      risk: '会改动插件安装清单，采用前必须隔离测试。',
      permissions: ['读取插件清单'],
      dataEgress: [],
    }];
  },
};
liveRuntime.context.DS_HUB_PLUGIN_ADAPTER = {
  async capabilities() { return { ok: true, pluginManagement: { packageInstall: false } }; },
};
await liveRuntime.context.checkCommunityPackageInstallCapability();
liveRuntime.context.jumpToCapability('tools', 'extensions');
liveRuntime.context.openCommunityDetail('dshmarket', 'module');
assert.match(
  liveRuntime.appRoot.innerHTML.match(/class="primary community-install-cta"[^>]*>/)?.[0] || '',
  /disabled/,
  'metadata search must not bypass a disabled packageInstall capability',
);
const liveHooks = liveRuntime.context.DS_HUB_TEST_HOOKS;
const liveInstallsBefore = JSON.stringify(liveHooks.state.verifiedInstalls);
await liveRuntime.context.installCommunityFromDialog('dshmarket');
assert.equal(liveHooks.state.assistantTask, null, 'packageInstall=false must not create an install candidate');
assert.match(liveRuntime.appRoot.innerHTML, /本机桥尚未开放第三方包安装；没有下载、安装或创建安装方案/);

liveRuntime.context.DS_HUB_PLUGIN_ADAPTER = {
  async capabilities() { return { ok: true, pluginManagement: { packageInstall: true } }; },
};
await liveRuntime.context.checkCommunityPackageInstallCapability({ force: true });
const enabledInstallAction = liveRuntime.appRoot.innerHTML.match(/class="primary community-install-cta"[^>]*>检查后安装<\/button>/)?.[0] || '';
assert.ok(enabledInstallAction, 'both metadata and package-install capabilities should expose the planning action');
assert.doesNotMatch(enabledInstallAction, /disabled/);
await liveRuntime.context.installCommunityFromDialog('dshmarket');
assert.equal(liveHooks.state.assistantTask?.pluginSearchSource, 'live_verified');
assert.equal(liveHooks.state.assistantTask?.candidate?.kind, 'plugin');
assert.equal(liveHooks.state.assistantTask?.candidate?.status, 'draft');
assert.equal(liveHooks.state.assistantTask?.candidate?.expectedValue, 'dshmarket@1.34.0');
assert.equal(JSON.stringify(liveHooks.state.verifiedInstalls), liveInstallsBefore, 'install planning must not fabricate install readback');
assert.match(liveRuntime.appRoot.innerHTML, /安装方案 dshmarket@1\.34\.0 已就绪；尚未下载、安装或启用/);
assert.doesNotMatch(liveRuntime.appRoot.innerHTML, /已安装并回读/);

// The preloaded assistant directory is also non-authoritative: it may be shown,
// but its rows cannot pass preparePluginCandidate's live-verification gate.
const preloadedRuntime = boot();
preloadedRuntime.context.askAssistant('community');
await new Promise((resolve) => setTimeout(resolve, 0));
const preloadedTask = preloadedRuntime.context.DS_HUB_TEST_HOOKS.state.assistantTask;
assert.equal(preloadedTask?.pluginSearchSource, 'preloaded');
assert.ok(preloadedTask?.pluginCandidates?.length > 0);
assert.equal(preloadedTask.pluginCandidates.some((item) => item.liveVerified === true), false);
preloadedRuntime.context.preparePluginCandidate(0);
assert.equal(preloadedTask.candidate, null, 'preloaded candidates must not become install candidates');
assert.doesNotMatch(preloadedRuntime.appRoot.innerHTML, /候选已采用并回读一致|已安装并回读/);

console.log('PASS plugin-contract-smoke');
