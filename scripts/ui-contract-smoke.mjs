#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const snapshotSource = await readFile(new URL('dsh-snapshot.js', root), 'utf8');
const appSource = await readFile(new URL('app.js', root), 'utf8');

function boot(hash = '', globals = {}) {
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
  Object.assign(context, globals);
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

const SETTINGS_CAPABILITY_TARGETS = Object.freeze([
  'settings:agent-default-model#/selection',
  'settings:agent-default-model#/reasoningEffort',
  'settings:ui-conversation#/busyEnter',
  'settings:agent-presets#/default',
  'settings:web-search-deepseek#/maxUses',
  'settings:permission#/defaultPreset',
]);

function settingsCapabilityAdapter(targets = SETTINGS_CAPABILITY_TARGETS) {
  return {
    async capabilities() {
      return { ok: true, configManagement: { settingsMutation: true, targets: [...targets] } };
    },
    async preflight() { throw new Error('not used by UI capability smoke'); },
    async apply() { throw new Error('not used by UI capability smoke'); },
    async readback() { throw new Error('not used by UI capability smoke'); },
  };
}

function buttonTag(html, onclick) {
  const escaped = onclick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<button\\b[^>]*onclick="${escaped}"[^>]*>[^<]*<\\/button>`));
  assert.ok(match, `missing button: ${onclick}`);
  return match[0];
}

const defaultPage = boot();
assert.match(defaultPage.appRoot.innerHTML, /<h1>工作方式<\/h1>/);
assert.match(defaultPage.appRoot.innerHTML, /工具决定“能做什么”，这里决定“什么时候、按什么方法去做”/);
assert.match(defaultPage.appRoot.innerHTML, /横向处理链/);
assert.match(defaultPage.appRoot.innerHTML, /纵向任务方法/);
assert.match(defaultPage.appRoot.innerHTML, /自动动作/);
assert.match(defaultPage.appRoot.innerHTML, /常驻规则/);
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-flow-step"/g) || []).length, 6, 'the horizontal axis must expose six understandable message-lifecycle actions');
assert.match(defaultPage.appRoot.innerHTML, /收到消息/);
assert.match(defaultPage.appRoot.innerHTML, /分析消息/);
assert.match(defaultPage.appRoot.innerHTML, /选择处理方法/);
assert.match(defaultPage.appRoot.innerHTML, /发送结果/);
assert.match(defaultPage.appRoot.innerHTML, /诊断式对话/);
assert.match(defaultPage.appRoot.innerHTML, /了解现状/);
assert.match(defaultPage.appRoot.innerHTML, /分析具体原因/);
assert.match(defaultPage.appRoot.innerHTML, /给出行动建议/);
assert.match(defaultPage.appRoot.innerHTML, /完成后回到横轴/);
assert.match(defaultPage.appRoot.innerHTML, /class="quick-entry /);
assert.match(defaultPage.appRoot.innerHTML, /onclick="goWays\(\)">工作方式/);
assert.match(defaultPage.appRoot.innerHTML, /onclick="goWorkshop\(\)">能力仓库/);
assert.doesNotMatch(defaultPage.appRoot.innerHTML, /quick-workbench/);
assert.match(defaultPage.appRoot.innerHTML, /class="assistant-chatbar"/, 'the assistant bar must remain reachable from the work-method surface');
assert.match(
  defaultPage.appRoot.innerHTML,
  /<button\b[^>]*class="logo"[^>]*onclick="goWays\(\)"[^>]*aria-label="返回 DS Hub 首页"/,
  'the DS Hub logo must be a focusable home button',
);

defaultPage.context.selectWaysSection('vertical');
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-method-workbench"/g) || []).length, 1, 'the vertical-method workbench must be reachable');
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-method-workbench"[\s\S]*?<nav/g) || []).length, 1);
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-vertical-step-wrap"/g) || []).length, 3, 'diagnostic conversation must show its three-step reasoning method');
assert.match(defaultPage.appRoot.innerHTML, /产品方法模板/);
defaultPage.context.focusWaysMethod('plan-method');
assert.match(defaultPage.appRoot.innerHTML, /确认目标/);
assert.match(defaultPage.appRoot.innerHTML, /制定计划/);
assert.match(defaultPage.appRoot.innerHTML, /执行动作/);
assert.match(defaultPage.appRoot.innerHTML, /验收结果/);
defaultPage.context.selectWaysSection('hook');
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-hook-stop"/g) || []).length, 3, 'automatic actions must be separated from the main flow');
defaultPage.context.selectWaysSection('rule');
assert.equal((defaultPage.appRoot.innerHTML.match(/class="ways-rule-band"/g) || []).length, 5, 'standing rules must remain visible without becoming flow steps');
defaultPage.context.openWaysDetail('permission-rule');
assert.match(defaultPage.appRoot.innerHTML, /换掉它会怎样/);
assert.match(defaultPage.appRoot.innerHTML, /danger-full-access/);
defaultPage.context.openImpactPreview('permission-rule');
assert.match(defaultPage.appRoot.innerHTML, /根据当前配置判断/);
assert.match(defaultPage.appRoot.innerHTML, /尚未运行验证/);
assert.match(defaultPage.appRoot.innerHTML, /权限会不会变/);
defaultPage.context.closeImpactPreview();
defaultPage.context.closeWaysDetail();

const configRoute = boot('#config');
assert.match(configRoute.appRoot.innerHTML, /dsh-core-logo/);
assert.doesNotMatch(configRoute.appRoot.innerHTML, /quick-workbench/);
assert.equal((configRoute.appRoot.innerHTML.match(/id="home-goal-input"/g) || []).length, 1, 'the capability repository keeps exactly one primary goal input');
assert.match(configRoute.appRoot.innerHTML, /你想让这个 Agent 做什么？/);
for (const [moduleName, question] of [
  ['感知', '能看到什么'],
  ['记忆', '能记住什么'],
  ['心智', '怎么想'],
  ['工具', '能做什么'],
  ['行动', '怎么做'],
]) {
  assert.match(
    configRoute.appRoot.innerHTML,
    new RegExp(`<div class="mod-name">${moduleName}<\\/div><div class="mod-question">${question}<\\/div>`),
    `${moduleName} module must use the agreed novice-facing question`,
  );
}

const relationshipRoute = boot();
relationshipRoute.context.openModule('memory');
assert.match(relationshipRoute.appRoot.innerHTML, /class="capability-orbit"/, 'module overview must show the capability choices');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /class="capability-focus-page"/, 'module overview must not preload a capability detail below itself');
relationshipRoute.context.selectCapability('context');
assert.match(relationshipRoute.appRoot.innerHTML, /class="capability-focus-page"/);
assert.match(relationshipRoute.appRoot.innerHTML, /返回记忆模块/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /class="spatial-workbench"/, 'capability detail must replace the module overview');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /class="capability-orbit"/, 'capability choices must leave the visual surface while one capability is open');
assert.match(relationshipRoute.appRoot.innerHTML, /relationship-explorer kind-collaboration/);
assert.match(relationshipRoute.appRoot.innerHTML, /先判断上下文是否过长，再压缩对话，最后裁掉过大的工具结果/);
assert.match(relationshipRoute.appRoot.innerHTML, /发现快要超长/);
assert.match(relationshipRoute.appRoot.innerHTML, /压缩对话内容/);
assert.match(relationshipRoute.appRoot.innerHTML, /裁剪工具结果/);
assert.match(relationshipRoute.appRoot.innerHTML, /它和谁有关/);
assert.match(relationshipRoute.appRoot.innerHTML, /关掉后会怎样/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /插件关系 ·/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /是怎么拼出来的/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /先看每个组件负责哪一步，再决定是否查看详情、停用或替换/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /职责链来自当前配置身份，不是运行轨迹/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /空间浏览/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /relationship-orbit-details/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /relationship-legend/);
assert.match(relationshipRoute.appRoot.innerHTML, /按列表查看全部/);
assert.ok((relationshipRoute.appRoot.innerHTML.match(/class="relationship-role-card(?: |")/g) || []).length <= 7, 'relationship story must show only a small focus set');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /后一环节是“社区增强方案”/, 'uninstalled candidates must not be presented as the next current stage');

relationshipRoute.context.openModule('sense');
relationshipRoute.context.selectCapability('input');
assert.match(relationshipRoute.appRoot.innerHTML, /relationship-explorer kind-mixed/);
assert.match(relationshipRoute.appRoot.innerHTML, /材料先进入会话，再变成 Agent 能定位的引用/);
assert.match(relationshipRoute.appRoot.innerHTML, /接住材料/);
assert.match(relationshipRoute.appRoot.innerHTML, /让 Agent 找得到/);
assert.match(relationshipRoute.appRoot.innerHTML, /理解图片内容/);
assert.match(relationshipRoute.appRoot.innerHTML, /视觉理解 ModLens/);
assert.match(relationshipRoute.appRoot.innerHTML, /视觉路由与像素工具/);
assert.match(relationshipRoute.appRoot.innerHTML, /候选未安装/);
const relationshipRefs = [...relationshipRoute.appRoot.innerHTML.matchAll(/data-relationship-ref="([^"]+)"/g)].map((match) => match[1]);
const firstRelationshipRef = relationshipRefs[0];
assert.ok(firstRelationshipRef, 'relationship story needs a focusable component');
let relationshipKeyPrevented = false;
relationshipRoute.context.relationshipRoleCardKeydown({ key: 'Enter', preventDefault() { relationshipKeyPrevented = true; } }, relationshipRefs[1]);
assert.equal(relationshipKeyPrevented, true);
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.relationshipFocusRef, relationshipRefs[1], 'Enter must select the relationship card');
relationshipRoute.context.focusRelationshipItem(firstRelationshipRef);
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.relationshipFocusRef, firstRelationshipRef);
assert.match(relationshipRoute.appRoot.innerHTML, /aria-pressed="true"/);
relationshipRoute.context.resetRelationshipFocus();
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.relationshipFocusRef, null);

relationshipRoute.context.closeCapabilityDetail();
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.capability, null);
assert.match(relationshipRoute.appRoot.innerHTML, /class="capability-orbit"/, 'back must restore the parent module overview');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /class="capability-focus-page"/);

relationshipRoute.context.openModule('mind');
relationshipRoute.context.selectCapability('model');
assert.match(relationshipRoute.appRoot.innerHTML, /id="capability-focus-title">选择与调用模型</);
assert.match(relationshipRoute.appRoot.innerHTML, /模型服务负责把请求发出去/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /Provider 负责|Provider 适配器/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /插件关系 · 模型调用链/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /选择与调用模型是怎么拼出来的/);

relationshipRoute.context.openModule('mind');
relationshipRoute.context.selectCapability('plan');
assert.match(relationshipRoute.appRoot.innerHTML, /15\/15/);
assert.match(relationshipRoute.appRoot.innerHTML, /全部组件都能继续查看/);
assert.match(relationshipRoute.appRoot.innerHTML, /Agent 工具和用户命令从两条入口/);
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="relationship-depth-stage"/g) || []).length, 5, 'the 15 planning components must first resolve into five understandable groups');
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="relationship-role-card(?: |")/g) || []).length, 0, 'the group overview must not dump plugin cards onto the first level');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML.split('<details class="relationship-all-components">')[0], /让能力在 DSH 中成立|运行支持/);
let reachablePlanningComponents = 0;
for (const [stageId, expectedCount] of [['mode', 2], ['state', 2], ['commands', 4], ['agent-tools', 4], ['pages', 3]]) {
  relationshipRoute.context.openRelationshipStage(stageId);
  const count = (relationshipRoute.appRoot.innerHTML.match(/class="relationship-role-card(?: |")/g) || []).length;
  assert.equal(count, expectedCount, `${stageId} must expose every real component in that group`);
  assert.match(relationshipRoute.appRoot.innerHTML, /全部 15 个组件/);
  reachablePlanningComponents += count;
  relationshipRoute.context.closeRelationshipStage();
}
assert.equal(reachablePlanningComponents, 15, 'all 15 planning components must be reachable through the hierarchy');
relationshipRoute.context.openRelationshipStage('agent-tools');
assert.match(relationshipRoute.appRoot.innerHTML, /启用目标能力/);
assert.match(relationshipRoute.appRoot.innerHTML, /Agent 可以读取或更新长期目标/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /客户端|Loader|Host/);

relationshipRoute.context.openModule('tools');
relationshipRoute.context.selectCapability('extensions');
assert.match(relationshipRoute.appRoot.innerHTML, /典型路径/);
assert.match(relationshipRoute.appRoot.innerHTML, /本次实际运行 · 暂无记录/);
assert.match(relationshipRoute.appRoot.innerHTML, /Agent 做任务时/);
assert.match(relationshipRoute.appRoot.innerHTML, /DSH 启动时/);
assert.match(relationshipRoute.appRoot.innerHTML, /用户打开网页时/);
assert.match(relationshipRoute.appRoot.innerHTML, /工具结果太长时/);
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-branch(?: |")/g) || []).length, 4, 'root must branch into four lifecycle paths');
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-node(?: |")/g) || []).length, 0, 'root must not expose leaf plugins before the user drills down');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /@deepseek-ai\/dsh-client-ui-layout/, 'technical plugin identities belong at the leaf level');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /空间浏览（次要视图）/, '38 components must use the grouped system map instead of an unreadable orbit');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /38 项 · 逐层理解/, 'the canvas must not narrate its own progressive-disclosure design');
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /一条 Agent 主线，三类支撑/, 'the old equal-card mental model must be removed');

relationshipRoute.context.openExtensionLevel('runtime');
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.extensionPath, 'runtime');
assert.match(relationshipRoute.appRoot.innerHTML, /DSH 怎样让插件可用/);
assert.match(relationshipRoute.appRoot.innerHTML, /读取启动设置/);
assert.match(relationshipRoute.appRoot.innerHTML, /准备并启动插件/);
assert.match(relationshipRoute.appRoot.innerHTML, /启动后台服务/);
assert.match(relationshipRoute.appRoot.innerHTML, /连接网页/);
assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, />loader<|>Host<|>client</);
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-stage-node(?: |")/g) || []).length, 4, 'startup view must show four human-readable phases');
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-node(?: |")/g) || []).length, 0);

relationshipRoute.context.openExtensionLevel('ui');
assert.match(relationshipRoute.appRoot.innerHTML, /先画出页面，再同时加上功能/);
assert.match(relationshipRoute.appRoot.innerHTML, /提供工作区域/);
assert.match(relationshipRoute.appRoot.innerHTML, /提供配置页面/);
assert.match(relationshipRoute.appRoot.innerHTML, /显示运行反馈/);
assert.equal((relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-stage-node(?: |")/g) || []).length, 4, 'UI view must show shell first and three parallel areas');

const extensionLeafPaths = [
  ['skill', 5],
  ['runtime/config', 1],
  ['runtime/load', 4],
  ['runtime/host', 5],
  ['runtime/client', 6],
  ['ui/shell', 4],
  ['ui/workspace', 4],
  ['ui/manage', 6],
  ['ui/observe', 2],
  ['cross', 1],
];
let reachableExtensionComponents = 0;
for (const [path, expectedCount] of extensionLeafPaths) {
  relationshipRoute.context.openExtensionLevel(path);
  const count = (relationshipRoute.appRoot.innerHTML.match(/class="extension-flow-node(?: |")/g) || []).length;
  assert.equal(count, expectedCount, `${path} must expose exactly its real leaf components`);
  assert.match(relationshipRoute.appRoot.innerHTML, /extension-hierarchy-crumbs/);
  if (path === 'runtime/load') {
    assert.match(relationshipRoute.appRoot.innerHTML, /插件启动入口/);
    assert.match(relationshipRoute.appRoot.innerHTML, /登记插件信息/);
    assert.match(relationshipRoute.appRoot.innerHTML, /创建插件实例/);
    assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /<b>Cordis加载入口<\/b>|<b>类型系统加载器<\/b>/);
  }
  if (path === 'runtime/host') {
    assert.match(relationshipRoute.appRoot.innerHTML, /启动后台插件/);
    assert.match(relationshipRoute.appRoot.innerHTML, /接收所有请求/);
    assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /<b>Host|<b>API网关<\/b>/);
  }
  if (path === 'runtime/client') {
    assert.match(relationshipRoute.appRoot.innerHTML, /启动网页功能/);
    assert.match(relationshipRoute.appRoot.innerHTML, /连接网页与后台/);
    assert.doesNotMatch(relationshipRoute.appRoot.innerHTML, /<b>客户端|<b>Cordis/);
  }
  reachableExtensionComponents += count;
}
assert.equal(reachableExtensionComponents, 38, 'all 38 synced extension components must be reachable through the hierarchy');
assert.match(relationshipRoute.appRoot.innerHTML, /缩短过长的工具结果/);
assert.match(relationshipRoute.appRoot.innerHTML, /不可直接替换/);
const extensionRefs = [...relationshipRoute.appRoot.innerHTML.matchAll(/data-extension-component="([^"]+)"/g)].map((match) => match[1]);
relationshipRoute.context.focusRelationshipItem(extensionRefs[0]);
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.state.relationshipFocusRef, extensionRefs[0], 'every leaf component must remain selectable');
assert.match(relationshipRoute.appRoot.innerHTML, /工具结果超过上下文需要/);

relationshipRoute.context.openExtensionLevel('runtime/load');
assert.match(relationshipRoute.appRoot.innerHTML, /可直接停用/);
assert.match(relationshipRoute.appRoot.innerHTML, /不可直接替换/);
relationshipRoute.context.openExtensionLevel('ui/shell');
assert.match(relationshipRoute.appRoot.innerHTML, /可换同类/);
assert.match(relationshipRoute.appRoot.innerHTML, /当前无备选/);

relationshipRoute.context.openModule('action');
relationshipRoute.context.selectCapability('permission');
assert.match(relationshipRoute.appRoot.innerHTML, /relationship-explorer kind-constraint/);
assert.match(relationshipRoute.appRoot.innerHTML, /权限方案先划定默认范围/);
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.relationshipSpec('tools', 'files').kind, 'toolbox');
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.relationshipSpec('mind', 'identity').kind, 'layers');
assert.equal(relationshipRoute.context.DS_HUB_TEST_HOOKS.relationshipSpec('mind', 'model').kind, 'collaboration');

const presetDrawer = boot('#config');
presetDrawer.context.openPresetDrawer();
assert.match(presetDrawer.appRoot.innerHTML, /<section class="plugin-dialog preset-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.doesNotMatch(presetDrawer.appRoot.innerHTML, /<aside class="drawer"[^>]*aria-label="角色卡/);
assert.match(presetDrawer.appRoot.innerHTML, /DSH 0\.1\.1-rc\.2 随附说明/);
assert.doesNotMatch(presetDrawer.appRoot.innerHTML.replace(/<[^>]+>/g, ' '), /preset-ref-[a-f0-9]{32}/, 'opaque refs should stay out of visible product copy');

const presetCandidate = boot('#config', { DS_HUB_CONFIG_ADAPTER: settingsCapabilityAdapter() });
presetCandidate.context.openPresetDrawer();
await new Promise((resolve) => setTimeout(resolve, 0));
const nextPreset = presetCandidate.context.DSH_SNAPSHOT.config.presets.find(
  (item) => item.id !== presetCandidate.context.DSH_SNAPSHOT.config.defaultPresetId,
);
assert.ok(nextPreset, 'the synced DSH roster must include a non-default role card for switching');
assert.match(presetCandidate.appRoot.innerHTML, /生成切换候选/);
presetCandidate.context.preparePresetSelection(nextPreset.id);
assert.equal(presetCandidate.context.DS_HUB_TEST_HOOKS.state.assistantTask?.candidate?.key, 'defaultPresetId');
assert.equal(presetCandidate.context.DS_HUB_TEST_HOOKS.state.assistantTask?.candidate?.status, 'draft');
assert.equal(presetCandidate.context.DS_HUB_TEST_HOOKS.state.assistantTask?.candidate?.expectedValue, nextPreset.id);
assert.match(presetCandidate.appRoot.innerHTML, /当前 DSH 配置没有变化/);

const quickRoute = boot('#quick');
assert.match(quickRoute.appRoot.innerHTML, /quick-workbench/);
assert.match(quickRoute.appRoot.innerHTML, /DeepSeek-V4-Pro/);
assert.match(quickRoute.appRoot.innerHTML, /仅查看/);
quickRoute.context.selectQuickSection('context');
assert.match(quickRoute.appRoot.innerHTML, /上下文处理方式/);
assert.doesNotMatch(quickRoute.appRoot.innerHTML, /快速调整忙时消息/);
assert.match(buttonTag(quickRoute.appRoot.innerHTML, 'prepareContextPolicyCandidate()'), /disabled/);
assert.match(buttonTag(quickRoute.appRoot.innerHTML, 'prepareContextPolicyCandidate()'), />当前只读<\/button>$/);
quickRoute.context.selectQuickSection('prompt');
assert.match(quickRoute.appRoot.innerHTML, /You are a coding agent powered by the/);
assert.match(quickRoute.appRoot.innerHTML, /不写入 localStorage/);
assert.match(quickRoute.appRoot.innerHTML, /<textarea[^>]*disabled[^>]*>/);
assert.match(quickRoute.appRoot.innerHTML, /Persona<\/b>当前只读/);
quickRoute.context.selectQuickSection('tools');
assert.match(quickRoute.appRoot.innerHTML, /查看工具组成/);
assert.match(quickRoute.appRoot.innerHTML, /可加入/);
assert.match(quickRoute.appRoot.innerHTML, /当前只能查看工具组成，暂不能修改/);
const actualToolRowCount = quickRoute.context.DSH_SNAPSHOT.config.presetRows.filter((row) => row.id.startsWith('tool-')).length;
assert.equal((quickRoute.appRoot.innerHTML.match(/prepareToolStateCandidate\(/g) || []).length, actualToolRowCount);
const readOnlyToolActions = [...quickRoute.appRoot.innerHTML.matchAll(/<button\b[^>]*onclick="prepareToolStateCandidate\([^>]+>[^<]*<\/button>/g)].map((match) => match[0]);
assert.equal(readOnlyToolActions.length, actualToolRowCount);
assert.equal(readOnlyToolActions.every((tag) => /disabled/.test(tag) && />当前只读<\/button>$/.test(tag)), true);
const beforeCompositionHtml = quickRoute.appRoot.innerHTML;
quickRoute.context.filterQuickTools('zidingyi', { isComposing: true });
assert.equal(quickRoute.appRoot.innerHTML, beforeCompositionHtml, 'IME composition should not rebuild the tool list');
quickRoute.context.filterQuickTools('子 Agent', { isComposing: false });
assert.match(quickRoute.appRoot.innerHTML, /子 Agent/);

// The live Host currently exposes six settings targets. This must unlock the
// exact model controls without turning real Preset/context/tool data into fake
// writable controls.
const settingsOnlyRoute = boot('#quick', { DS_HUB_CONFIG_ADAPTER: settingsCapabilityAdapter() });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(settingsOnlyRoute.context.DS_HUB_TEST_HOOKS.state.configManagementCapability.status, 'ready');
assert.deepEqual(
  Array.from(settingsOnlyRoute.context.DS_HUB_TEST_HOOKS.state.configManagementCapability.targets),
  Array.from(SETTINGS_CAPABILITY_TARGETS),
);
const modelSelect = settingsOnlyRoute.appRoot.innerHTML.match(/<select id="quick-model-selection"[^>]*>/)?.[0] || '';
assert.ok(modelSelect, 'settings-only capability must keep the real DSH model selector visible');
assert.doesNotMatch(modelSelect, /disabled/);
assert.doesNotMatch(buttonTag(settingsOnlyRoute.appRoot.innerHTML, 'prepareModelSelectionCandidate()'), /disabled/);
assert.match(buttonTag(settingsOnlyRoute.appRoot.innerHTML, 'prepareModelSelectionCandidate()'), />保存为候选<\/button>$/);

settingsOnlyRoute.context.selectQuickSection('context');
assert.match(settingsOnlyRoute.appRoot.innerHTML, /上下文处理方式/);
const contextModeTags = [...settingsOnlyRoute.appRoot.innerHTML.matchAll(/<button\b[^>]*data-context-mode="[^"]+"[^>]*>/g)].map((match) => match[0]);
assert.equal(contextModeTags.length, 3);
assert.equal(contextModeTags.every((tag) => /disabled/.test(tag)), true, 'context values stay visible but read-only');
assert.match(buttonTag(settingsOnlyRoute.appRoot.innerHTML, 'prepareContextPolicyCandidate()'), /disabled/);
settingsOnlyRoute.context.selectQuickSection('prompt');
assert.match(settingsOnlyRoute.appRoot.innerHTML, /You are a coding agent powered by the/);
assert.match(settingsOnlyRoute.appRoot.innerHTML, /<textarea[^>]*disabled[^>]*>/);
assert.match(settingsOnlyRoute.appRoot.innerHTML, /当前 DSH 暂未开放角色卡写入/);
settingsOnlyRoute.context.selectQuickSection('tools');
const settingsOnlyToolActions = [...settingsOnlyRoute.appRoot.innerHTML.matchAll(/<button\b[^>]*onclick="prepareToolStateCandidate\([^>]+>[^<]*<\/button>/g)].map((match) => match[0]);
assert.equal(settingsOnlyToolActions.length, actualToolRowCount);
assert.equal(settingsOnlyToolActions.every((tag) => /disabled/.test(tag) && />当前只读<\/button>$/.test(tag)), true);

function readyAdoptionTask(targetId) {
  const candidateId = 'candidate-capability-boundary';
  const suiteId = 'suite-capability-boundary';
  const baseTarget = { targetId, revision: 'target-revision-1', value: { mode: 'auto' }, evidenceRef: 'target-proof-1' };
  const baseModelEnvironment = {
    targetId: 'settings:agent-default-model#/selection',
    revision: 'model-revision-1',
    selection: {
      provider: settingsOnlyRoute.context.DSH_SNAPSHOT.config.model.provider,
      model: settingsOnlyRoute.context.DSH_SNAPSHOT.config.model.model,
      reasoningEffort: settingsOnlyRoute.context.DSH_SNAPSHOT.config.model.reasoningEffort,
    },
    evidenceRef: 'model-proof-1',
  };
  return {
    id: 'optimization-capability-boundary',
    title: '配置能力边界',
    goal: '只采用 Host 明确开放的目标',
    status: 'active',
    configArea: 'context',
    decision: null,
    candidate: {
      id: candidateId,
      kind: 'preset-patch',
      key: 'contextPolicy',
      targetId,
      target: '当前角色卡上下文策略',
      title: '调整上下文处理方式',
      impact: '仅用于验证采用按钮的精确目标能力边界。',
      oldValue: { mode: 'auto' },
      expectedValue: { mode: 'manual' },
      configArea: 'context',
      status: 'draft',
      baseTarget,
      baseModelEnvironment,
    },
    testSuite: {
      id: suiteId,
      version: 1,
      name: '能力边界测试集',
      status: 'locked',
      contentHash: 'suite-hash-1',
      configArea: 'context',
      candidateId,
      cases: [],
    },
    comparison: {
      status: 'completed',
      verified: true,
      acceptanceMet: true,
      environmentAligned: true,
      targetAligned: true,
      candidateId,
      testSuiteId: suiteId,
      testSuiteVersion: 1,
      testSuiteHash: 'suite-hash-1',
      baseTarget: { ...baseTarget },
      modelEnvironment: { ...baseModelEnvironment, selection: { ...baseModelEnvironment.selection } },
      summary: { total: 0, improved: 0, regressed: 0, criticalFailures: 0 },
      caseResults: [],
    },
  };
}

const presetTarget = `agent-preset-ref:${settingsOnlyRoute.context.DSH_SNAPSHOT.config.defaultPresetRef}#/context-policy`;
settingsOnlyRoute.context.DS_HUB_TEST_HOOKS.state.assistantTask = readyAdoptionTask(presetTarget);
settingsOnlyRoute.context.goTrial();
assert.match(buttonTag(settingsOnlyRoute.appRoot.innerHTML, 'prepareAdoption()'), /disabled/);
assert.match(settingsOnlyRoute.appRoot.innerHTML, /当前 DSH 不允许修改这里/);

// Keep every regression fact identical and change only candidate.targetId. The
// exact settings target is writable, so the adoption control can open.
settingsOnlyRoute.context.DS_HUB_TEST_HOOKS.state.assistantTask = readyAdoptionTask('settings:agent-default-model#/selection');
settingsOnlyRoute.context.goTrial();
assert.doesNotMatch(buttonTag(settingsOnlyRoute.appRoot.innerHTML, 'prepareAdoption()'), /disabled/);

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
const toolAction = toolCandidate.appRoot.innerHTML.match(/prepareToolStateCandidate\(&quot;([^&]+)&quot;,(true|false)\)/);
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
assistant.context.DS_HUB_TEST_HOOKS.state.assistantMessages = [{
  role: 'assistant',
  text: '第一段\n\n- **重点** <img src=x onerror=alert(1)>\n- 第二项',
}];
assistant.context.openAssistant();
assert.match(assistant.appRoot.innerHTML, /<div class="assistant-copy"><p>第一段<\/p><ul><li><strong>重点<\/strong> &lt;img src=x onerror=alert\(1\)&gt;<\/li><li>第二项<\/li><\/ul><\/div>/);
assert.doesNotMatch(assistant.appRoot.innerHTML, /<img src=x onerror=/, 'assistant HTML must remain escaped before Markdown formatting');
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
const assistantContexts = [];
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
    assistantContexts.push(request.context);
    return { text: 'proof intentionally incomplete', environment: {} };
  },
};
assistant.context.attachAssistantContext('module/mind');
await assistant.context.sendAssistantMessage('比较这个对象');
assistant.context.attachAssistantContext('module/memory');
await assistant.context.sendAssistantMessage('比较这个对象');
assert.equal(digests.length, 2);
assert.notEqual(digests[0], digests[1]);
assert.equal(assistantContexts[0].config.currentDefaultRoleCard.name, assistant.context.DSH_SNAPSHOT.config.activePreset.name);
assert.equal(assistantContexts[0].config.currentDefaultRoleCard.isDefault, true);
assert.match(assistantContexts[0].evidence.roleCardComponentsMeaning, /不是角色卡名称/);

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
