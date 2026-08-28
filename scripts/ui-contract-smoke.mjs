#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const snapshotSource = await readFile(new URL('dsh-snapshot.js', root), 'utf8');
const appSource = await readFile(new URL('app.js', root), 'utf8');

function boot(hash = '') {
  const appRoot = { innerHTML: '' };
  const toastRoot = { appendChild() {} };
  const inertNode = {
    focus() {}, select() {}, scrollIntoView() {}, setSelectionRange() {}, remove() {}, appendChild() {},
    classList: { add() {}, remove() {}, contains() { return false; } }, contains() { return false; },
    scrollTop: 0, scrollHeight: 0,
  };
  const storage = new Map();
  const context = {
    console, Date, Intl, Math, JSON, Set, Map, Object, String, Number, Boolean, Array, RegExp, Promise, AbortController,
    setTimeout, clearTimeout,
    location: { hash },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => callback(),
    document: {
      body: { classList: { add() {}, remove() {} } },
      getElementById(id) { return id === 'app' ? appRoot : id === 'toasts' ? toastRoot : inertNode; },
      querySelector() { return inertNode; },
      querySelectorAll() { return []; },
      createElement() { return { ...inertNode, className: '', textContent: '' }; },
      addEventListener() {},
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
  return { context, appRoot, storage };
}

const defaultPage = boot();
assert.match(defaultPage.appRoot.innerHTML, /dsh-core-logo/);
assert.match(defaultPage.appRoot.innerHTML, /class="quick-entry /);
assert.match(defaultPage.appRoot.innerHTML, /onclick="goWorkshop\(\)">Agent 配置/);
assert.doesNotMatch(defaultPage.appRoot.innerHTML, /quick-workbench/);

const configRoute = boot('#config');
assert.match(configRoute.appRoot.innerHTML, /dsh-core-logo/);
assert.doesNotMatch(configRoute.appRoot.innerHTML, /quick-workbench/);

const presetDrawer = boot();
presetDrawer.context.openPresetDrawer();
assert.match(presetDrawer.appRoot.innerHTML, /本次快照已安全映射/);
assert.doesNotMatch(presetDrawer.appRoot.innerHTML, /preset-ref-[a-f0-9]{32}/, 'opaque refs should stay out of ordinary product copy');

const quickRoute = boot('#quick');
assert.match(quickRoute.appRoot.innerHTML, /quick-workbench/);
assert.match(quickRoute.appRoot.innerHTML, /DeepSeek-V4-Pro/);
quickRoute.context.selectQuickSection('context');
assert.match(quickRoute.appRoot.innerHTML, /上下文处理方式/);
assert.doesNotMatch(quickRoute.appRoot.innerHTML, /快速调整忙时消息/);
quickRoute.context.selectQuickSection('prompt');
assert.match(quickRoute.appRoot.innerHTML, /You are a coding agent powered by the/);
assert.match(quickRoute.appRoot.innerHTML, /不写入 localStorage/);
quickRoute.context.selectQuickSection('tools');
assert.match(quickRoute.appRoot.innerHTML, /增删改工具/);
assert.match(quickRoute.appRoot.innerHTML, /从 Agent 移除/);
assert.match(quickRoute.appRoot.innerHTML, /可加入/);
const actualToolRowCount = quickRoute.context.DSH_SNAPSHOT.config.presetRows.filter((row) => row.id.startsWith('tool-')).length;
assert.equal((quickRoute.appRoot.innerHTML.match(/prepareToolStateCandidate\('/g) || []).length, actualToolRowCount);
const beforeCompositionHtml = quickRoute.appRoot.innerHTML;
quickRoute.context.filterQuickTools('zidingyi', { isComposing: true });
assert.equal(quickRoute.appRoot.innerHTML, beforeCompositionHtml, 'IME composition should not rebuild the tool list');
quickRoute.context.filterQuickTools('子 Agent', { isComposing: false });
assert.match(quickRoute.appRoot.innerHTML, /子 Agent/);

const contextCandidate = boot('#quick');
const compaction = contextCandidate.context.DSH_SNAPSHOT.config.presetRows.find((row) => row.id === 'compaction-basic');
const currentContextMode = compaction?.enabled === false ? 'off' : compaction?.config?.auto === false ? 'manual' : 'auto';
contextCandidate.context.setQuickContextMode(currentContextMode === 'auto' ? 'manual' : 'auto');
contextCandidate.context.prepareContextPolicyCandidate();
assert.match(contextCandidate.appRoot.innerHTML, /调整上下文处理方式/);
assert.match(contextCandidate.appRoot.innerHTML, /当前 DSH 配置没有变化/);

const promptCandidate = boot('#quick');
const currentPersona = promptCandidate.context.DSH_SNAPSHOT.config.persona?.text
  ?? promptCandidate.context.DSH_SNAPSHOT.config.presetRows.find((row) => row.id === 'persona')?.config?.text
  ?? '';
promptCandidate.context.updateQuickDraft('personaText', `${currentPersona}\nUse concise, evidence-backed language.`);
promptCandidate.context.preparePersonaCandidate();
assert.match(promptCandidate.appRoot.innerHTML, /更新角色与行为提示词/);
assert.match(promptCandidate.appRoot.innerHTML, /当前 DSH 配置没有变化/);

const toolCandidate = boot('#quick');
toolCandidate.context.selectQuickSection('tools');
const toolAction = toolCandidate.appRoot.innerHTML.match(/prepareToolStateCandidate\('([^']+)',(true|false)\)/);
assert.ok(toolAction, 'quick tool editor should expose at least one real Preset tool action');
toolCandidate.context.prepareToolStateCandidate(toolAction[1], toolAction[2] === 'true');
assert.match(toolCandidate.appRoot.innerHTML, /(?:加入|移除)工具：/);
assert.match(toolCandidate.appRoot.innerHTML, /当前 DSH 配置没有变化/);

const toolConfigCandidate = boot('#quick');
toolConfigCandidate.context.selectQuickSection('tools');
toolConfigCandidate.context.toggleQuickToolEditor('tool-ralph');
toolConfigCandidate.context.updateQuickToolConfig('tool-ralph', 'maxRounds', '32');
toolConfigCandidate.context.prepareToolConfigCandidate('tool-ralph');
assert.match(toolConfigCandidate.appRoot.innerHTML, /maxRounds=64/);
assert.match(toolConfigCandidate.appRoot.innerHTML, /maxRounds=32/);
assert.doesNotMatch(toolConfigCandidate.appRoot.innerHTML, /当前参数.*参数候选/);

const assistant = boot();
assistant.context.attachAssistantContext('module/tools');
assert.match(assistant.appRoot.innerHTML, /下一条消息将分析/);
assert.match(assistant.appRoot.innerHTML, /工具模块/);
assert.doesNotMatch(assistant.appRoot.innerHTML, /class="change-proposal"|写入已完成并回读一致/);
assistant.context.attachAssistantContext('module/tools');
assert.equal((assistant.appRoot.innerHTML.match(/aria-label="移除工具模块"/g) || []).length, 1);

await assistant.context.sendAssistantMessage('只分析这个对象');
assert.match(assistant.appRoot.innerHTML, /本次分析对象/);
assert.match(assistant.appRoot.innerHTML, /模块 · 工具模块/);
assert.match(assistant.appRoot.innerHTML, /按你主动加入的 1 个对象分析/);
assert.match(assistant.appRoot.innerHTML, /可把模块、能力或组件拖到这里/);

const focusedWorkflow = boot();
focusedWorkflow.context.attachAssistantContext('module/tools');
await focusedWorkflow.context.sendAssistantMessage('围绕当前问题和候选配置构建测试集，并写清通过条件。');
assert.match(focusedWorkflow.appRoot.innerHTML, /已生成 3 道测试题草案/);
assert.match(focusedWorkflow.appRoot.innerHTML, /本次分析对象/);

const focusedQuickTools = boot('#quick');
focusedQuickTools.context.attachAssistantContext('module/action');
focusedQuickTools.context.quickConfigAsk('tools');
assert.match(focusedQuickTools.appRoot.innerHTML, /工具入口已加入/);
assert.match(focusedQuickTools.appRoot.innerHTML, /本次附加范围：行动模块/);

const focusedDiagnose = boot();
focusedDiagnose.context.attachAssistantContext('module/memory');
focusedDiagnose.context.askAssistant('diagnose');
assert.match(focusedDiagnose.appRoot.innerHTML, /当前最值得先核对/);
assert.match(focusedDiagnose.appRoot.innerHTML, /本次附加范围：记忆模块/);

const digests = [];
let environmentRead = 0;
assistant.context.DS_HUB_AI_ADAPTER = {
  async describeEnvironment() {
    environmentRead += 1;
    return {
      targetId: 'settings:agent-default-model#/selection',
      settingsRevision: 1,
      evidenceRef: `model-environment-${environmentRead}`,
      routable: true,
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'max' },
    };
  },
  async ask(request) {
    digests.push(request.messageDigest);
    return { text: 'proof intentionally incomplete', environment: {} };
  },
};
assistant.context.attachAssistantContext('module/mind');
await assistant.context.sendAssistantMessage('比较这个对象');
assistant.context.attachAssistantContext('module/memory');
await assistant.context.sendAssistantMessage('比较这个对象');
assert.equal(digests.length, 2);
assert.notEqual(digests[0], digests[1]);

const forgedTransfer = {
  files: [],
  types: ['application/x-dshub-context-ref'],
  getData() { return 'component/tools/extensions/plugin/forged'; },
};
assistant.context.assistantDrop({ preventDefault() {}, dataTransfer: forgedTransfer, currentTarget: inertDropTarget() });
assert.doesNotMatch(assistant.appRoot.innerHTML, /forged/);

const fileTransfer = {
  files: [{}],
  types: ['application/x-dshub-context-ref'],
  getData() { return 'module/tools'; },
};
const fileDrop = boot();
fileDrop.context.assistantDrop({ preventDefault() {}, dataTransfer: fileTransfer, currentTarget: inertDropTarget() });
assert.doesNotMatch(fileDrop.appRoot.innerHTML, /aria-label="移除工具模块"/);

const maxContext = boot();
['sense', 'memory', 'mind', 'tools', 'action'].forEach((key) => maxContext.context.attachAssistantContext(`module/${key}`));
maxContext.context.attachAssistantContext('capability/tools/extensions');
assert.equal((maxContext.appRoot.innerHTML.match(/class="assistant-context-chip"/g) || []).length, 6);

const communityFocus = boot();
let communityRequest;
communityFocus.context.DS_HUB_OPTIMIZATION_ADAPTER = {
  async searchCommunity(request) { communityRequest = request; return []; },
};
communityFocus.context.attachAssistantContext('module/tools');
await communityFocus.context.searchCommunityPlugins('按这个模块找社区插件');
assert.equal(communityRequest.focusItems[0].ref, 'module/tools');
assert.deepEqual(Array.from(communityRequest.contextRefs), ['module/tools']);
assert.match(communityFocus.appRoot.innerHTML, /本次分析对象/);

assert.match(appSource, /presetDerivation: proposal\.kind === 'preset-patch'/);
assert.match(appSource, /normalizePresetDerivationProof\(applyResult\?\.presetDerivation/);
assert.match(appSource, /normalizePresetDerivationProof\(readback\?\.presetDerivation/);
assert.match(appSource, /upsertUnknownWriteMarker\(proposal, writeAttemptedAt, expectedAppliedTargetId\)/);
assert.match(appSource, /readCurrentCandidateTarget\(task, task\.candidate, 'recheck', recoveryTargetId\)/);
assert.match(appSource, /projectVerifiedQuickReadback\(task\.candidate, read\.snapshot\.value\)/);
assert.match(appSource, /document\.getElementById\('quick-model-selection'\).*focus/);
assert.match(quickRoute.context.DSH_SNAPSHOT.config.defaultPresetRef, /^preset-ref-[a-f0-9]{32}$/);
assert.match(quickRoute.context.DSH_SNAPSHOT.config.presetRosterRevision, /^preset-roster-[a-f0-9]{32}$/);
assert.match(quickRoute.context.DSH_SNAPSHOT.config.presetMappingId, /^preset-map-[a-f0-9]{32}$/);
assert.equal(quickRoute.context.unknownRecheckDisposition({ kind: 'preset-patch', key: 'contextPolicy', requiresDerivedPreset: true }, {
  matchesExpected: false,
  matchesPrevious: true,
  derivationRecovered: false,
  presetRosterRecovered: false,
}).canReleaseMarker, false);
assert.equal(quickRoute.context.unknownRecheckDisposition({ kind: 'preset-patch', key: 'contextPolicy', requiresDerivedPreset: true }, {
  matchesExpected: true,
  matchesPrevious: false,
  derivationRecovered: true,
  presetRosterRecovered: true,
}).canReleaseMarker, true);
maxContext.context.attachAssistantContext('component/mind/identity/prompt/%40deepseek-ai%2Fdsh-persona');
assert.equal((maxContext.appRoot.innerHTML.match(/class="assistant-context-chip"/g) || []).length, 6);

const beforeCandidate = boot('#quick');
beforeCandidate.context.updateQuickDraft('modelSelection', 'deepseek-official::deepseek-v4-pro');
beforeCandidate.context.prepareModelSelectionCandidate();
assert.match(beforeCandidate.appRoot.innerHTML, /切换新建 Agent 的默认模型/);
assert.match(beforeCandidate.appRoot.innerHTML, /当前 DSH 配置没有变化/);

const contractRuntime = boot('#quick');
const hooks = contractRuntime.context.DS_HUB_TEST_HOOKS;
assert.ok(hooks, 'test hooks should be available only in the smoke runtime');
for (const invalid of ['', '   ', Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, []]) {
  assert.equal(hooks.validRevision(invalid), false, `invalid revision should be rejected: ${String(invalid)}`);
}
assert.equal(hooks.validRevision(0), true);
assert.equal(hooks.validRevision('revision-1'), true);
assert.equal(hooks.normalizeTargetSnapshot({ targetId: 'settings:test', targetRevision: '', canonicalValue: true, evidenceRef: 'target-proof' }), null);
assert.equal(hooks.modelEnvironmentSnapshot({ targetId: 'settings:model', revision: '', selection: { provider: 'p', model: 'm', reasoningEffort: 'max' }, evidenceRef: 'model-proof' }), null);

const snapshot = contractRuntime.context.DSH_SNAPSHOT;
const snapshotIdentity = [snapshot.schemaVersion, snapshot.capturedAt, snapshot.source?.packageVersion, snapshot.source?.hostVersion].join('|');
const sourcePresetRef = snapshot.config.defaultPresetRef;
const derivedPresetRef = sourcePresetRef === `preset-ref-${'b'.repeat(32)}` ? `preset-ref-${'c'.repeat(32)}` : `preset-ref-${'b'.repeat(32)}`;
const sourceTargetId = `agent-preset-ref:${sourcePresetRef}#/context-policy`;
const derivedTargetId = `agent-preset-ref:${derivedPresetRef}#/context-policy`;
const sourceRosterRevision = snapshot.config.presetRosterRevision;
const derivedRosterRevision = `preset-roster-${'d'.repeat(32)}`;
const derivationCandidate = {
  id: 'candidate-contract',
  kind: 'preset-patch',
  key: 'contextPolicy',
  requiresDerivedPreset: true,
  sourcePresetRef,
  sourcePresetTrust: 'system',
  presetRosterRevision: sourceRosterRevision,
  presetMappingId: snapshot.config.presetMappingId,
  baseTarget: { targetId: sourceTargetId, revision: 'base-1' },
};
const validDerivationProof = {
  sourcePresetRef,
  derivedPresetRef,
  sourcePresetTrust: 'system',
  sourceTargetId,
  derivedTargetId,
  sourceRosterRevision,
  derivedRosterRevision,
  presetMappingId: snapshot.config.presetMappingId,
  copyReceipt: {
    id: 'copy-1', digest: 'copy-digest-1', evidenceRef: 'copy-proof-1', guardReceiptDigest: 'guard-digest-1',
    sourcePresetRef, derivedPresetRef, sourceRosterRevision, derivedRosterRevision, derivedTargetId, appliedRevision: 'applied-2',
  },
  sourceReadback: { presetRef: sourcePresetRef, targetId: sourceTargetId, revision: 'base-1', unchanged: true, evidenceRef: 'source-proof-1' },
  defaultPresetReadback: { targetId: 'settings:agent-presets#/default', presetRef: derivedPresetRef, presetRosterRevision: derivedRosterRevision, revision: 'default-2', evidenceRef: 'default-proof-1' },
};
assert.ok(hooks.normalizePresetDerivationProof(validDerivationProof, derivationCandidate, { guardReceiptDigest: 'guard-digest-1', appliedRevision: 'applied-2' }));
for (const field of ['sourceReadback', 'defaultPresetReadback', 'copyReceipt']) {
  const broken = JSON.parse(JSON.stringify(validDerivationProof));
  if (field === 'sourceReadback') broken.sourceReadback.revision = '';
  if (field === 'defaultPresetReadback') broken.defaultPresetReadback.revision = '';
  if (field === 'copyReceipt') broken.copyReceipt.appliedRevision = '';
  assert.equal(hooks.normalizePresetDerivationProof(broken, derivationCandidate, { guardReceiptDigest: 'guard-digest-1', appliedRevision: 'applied-2' }), null);
}
assert.equal(hooks.normalizePresetRosterSnapshot({
  targetId: 'settings:agent-presets#/roster', revision: '', defaultPresetRef: sourcePresetRef,
  presetMappingId: snapshot.config.presetMappingId, snapshotIdentity, evidenceRef: 'roster-proof',
}), null);
const targetSnapshot = { targetId: sourceTargetId, revision: 'target-1', value: { mode: 'auto' }, evidenceRef: 'target-proof-1' };
const modelSnapshot = { targetId: 'settings:agent-default-model#/selection', revision: 'model-1', selection: { provider: 'p', model: 'm', reasoningEffort: 'max' }, evidenceRef: 'model-proof-1' };
const rosterSnapshot = hooks.normalizePresetRosterSnapshot({
  targetId: 'settings:agent-presets#/roster', revision: sourceRosterRevision, defaultPresetRef: sourcePresetRef,
  presetMappingId: snapshot.config.presetMappingId, snapshotIdentity, evidenceRef: 'roster-proof-1',
});
const guardReceipt = {
  id: 'guard-1', digest: 'guard-digest-1', evidenceRef: 'guard-proof-1', candidateId: derivationCandidate.id,
  idempotencyKey: derivationCandidate.id, expectedTargetRevision: targetSnapshot.revision,
  expectedModelRevision: modelSnapshot.revision, expectedRosterRevision: rosterSnapshot.revision,
  expectedDefaultPresetRef: rosterSnapshot.defaultPresetRef, expectedPresetMappingId: rosterSnapshot.presetMappingId, snapshotIdentity,
};
assert.ok(hooks.normalizeGuardReceipt(guardReceipt, derivationCandidate, targetSnapshot, modelSnapshot, rosterSnapshot));
for (const field of ['expectedTargetRevision', 'expectedModelRevision', 'expectedRosterRevision']) {
  assert.equal(hooks.normalizeGuardReceipt({ ...guardReceipt, [field]: '' }, derivationCandidate, targetSnapshot, modelSnapshot, rosterSnapshot), null);
}

assert.equal(hooks.upsertUnknownWriteMarker(derivationCandidate, '2026-08-28T04:00:00.000Z'), true);
assert.equal(hooks.upsertPresetRosterUnknownMarker(derivationCandidate, '2026-08-28T04:00:00.000Z'), true);
assert.equal(hooks.quickSectionBlocked('context'), true);
assert.equal(hooks.quickSectionBlocked('prompt'), true);
assert.equal(hooks.quickSectionBlocked('tools'), true);
hooks.clearUnknownWriteMarker(derivationCandidate);
assert.equal(hooks.quickSectionBlocked('prompt'), true, 'roster marker should keep every Preset editor gated');
hooks.clearPresetRosterUnknownMarker(derivationCandidate);
assert.equal(hooks.quickSectionBlocked('prompt'), false);

assert.match(appSource, /adoptionPreflight[\s\S]*presetRoster/);
assert.match(appSource, /normalizeGuardReceipt\(applyResult\?\.guardReceipt/);
assert.match(appSource, /upsertPresetRosterUnknownMarker\(proposal, writeAttemptedAt\)/);

console.log('PASS ui-contract-smoke');

function inertDropTarget() {
  return { classList: { remove() {} } };
}
