#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, '../dsh-snapshot.js');
const cliArgs = process.argv.slice(2);
const includeSkillCopy = cliArgs.includes('--include-skill-copy');
const includeUserPresetNames = cliArgs.includes('--include-user-preset-names');
const positionalArgs = cliArgs.filter((arg) => !arg.startsWith('--'));
const apiBase = (positionalArgs[0] || 'http://127.0.0.1:3080').replace(/\/$/, '');
const projectPath = path.resolve(positionalArgs[1] || process.env.DS_HUB_PROJECT_PATH || path.resolve(scriptDir, '..'));
const apiUrl = new URL(apiBase);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
if (!['http:', 'https:'].includes(apiUrl.protocol) || !loopbackHosts.has(apiUrl.hostname)) {
  throw new Error('Snapshot sync only accepts a loopback DSH API. Refusing to persist a remote endpoint.');
}

async function call(method, payload = {}) {
  const rpcId = `studio-snapshot-${method.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`;
  const response = await fetch(`${apiBase}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.result?.ok) {
    throw new Error(`${method}: ${body?.result?.error?.message || 'unknown DSH error'}`);
  }
  return body.result.value;
}

function valueOf(namespaces, ns) {
  return namespaces.find((item) => item.ns === ns)?.value || {};
}

function modelMetadataOf(namespaces, selection) {
  const candidates = [];
  for (const namespace of namespaces) {
    if (!namespace.ns?.startsWith('llm-')) continue;
    const settings = namespace.value || {};
    const models = Array.isArray(settings) ? settings
      : [settings.models, settings.availableModels, settings.modelCatalog].find(Array.isArray) || [];
    for (const model of models) {
      const id = model?.id || model?.model;
      if (!id) continue;
      const provider = model.provider || settings.provider || settings.id;
      const score = Number(id === selection.model) * 4 + Number(provider === selection.provider) * 2;
      candidates.push({ score, namespace: namespace.ns, settings, model: { ...model, id, provider } });
    }
  }
  return candidates.filter((candidate) => candidate.model.id === selection.model).sort((a, b) => b.score - a.score)[0]
    || { namespace: null, settings: {}, model: {} };
}

function parseScalar(text) {
  const value = text.trim().replace(/^['"]|['"]$/g, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parsePresetRows(content) {
  const lines = content.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)-\s+id:\s*(.+?)\s*$/);
    if (match) starts.push({ index, indent: match[1].length, id: parseScalar(match[2]) });
  });
  return starts.map((start, rowIndex) => {
    const end = starts[rowIndex + 1]?.index ?? lines.length;
    const block = lines.slice(start.index, end);
    const moduleLine = block.find((line) => /^\s+name:\s*/.test(line));
    const moduleName = moduleLine ? parseScalar(moduleLine.replace(/^\s+name:\s*/, '')) : '';
    const disabledLine = block.find((line) => /^\s+disabled:\s*/.test(line));
    let disabled = disabledLine ? parseScalar(disabledLine.replace(/^\s+disabled:\s*/, '')) : false;
    if (typeof disabled === 'string' && disabled.includes('process.platform')) {
      disabled = start.id.includes('pwsh') ? process.platform !== 'win32' : process.platform === 'win32';
    }
    const config = {};
    for (const key of ['provider', 'toolName', 'mode', 'fetch', 'searchTimeoutMs', 'maxRounds', 'maxBytes', 'thresholdChars', 'allowParallelInProgress']) {
      const line = block.find((item) => new RegExp(`^\\s+${key}:\\s*`).test(item));
      if (line) config[key] = parseScalar(line.replace(new RegExp(`^\\s+${key}:\\s*`), ''));
    }
    return { id: String(start.id), moduleName: String(moduleName), enabled: !disabled, config };
  }).filter((row) => row.moduleName && row.moduleName !== 'cordis:group');
}

function sumStats(items) {
  const total = {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const item of items) {
    const values = item.projections?.values || {};
    const stats = values.sessionStats || {};
    const tokens = values.tokenUsage || {};
    for (const key of ['turns', 'steps', 'llmMs', 'toolMs']) total[key] += stats[key] || 0;
    for (const key of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) total[key] += tokens[key] || 0;
  }
  return total;
}

function countBy(items, pick) {
  const counts = {};
  for (const item of items) {
    const key = pick(item) || '未记录';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(value || {}, key)).map((key) => [key, value[key]]));
}

function createPresetPrivacyMap(presets) {
  let userIndex = 0;
  return new Map((presets || []).map((preset) => {
    const rawId = String(preset?.id || '');
    if (preset?.trust === 'system') return [rawId, rawId];
    userIndex += 1;
    return [rawId, `user-preset-${userIndex}`];
  }));
}

function publicPreset(preset, presetPrivacyMap) {
  const trust = preset?.trust || 'unknown';
  const canExposeName = trust === 'system' || includeUserPresetNames;
  return {
    id: presetPrivacyMap.get(String(preset?.id || '')) || 'user-preset',
    trust,
    isDefault: Boolean(preset?.isDefault),
    name: canExposeName ? String(preset?.name || preset?.id || '') : '用户角色卡',
  };
}

function summarizeSessions(items, publicPresetId = (value) => value) {
  return {
    total: items.length,
    running: items.filter((item) => item.running).length,
    blank: items.filter((item) => item.blank).length,
    presetCounts: countBy(items, (item) => publicPresetId(item.agentPreset)),
    permissionCounts: countBy(items, (item) => item.projections?.values?.permissions?.currentValue),
    stats: sumStats(items),
  };
}

function dailySessions(items, now = Date.now()) {
  const dayMs = 86_400_000;
  const dayStart = (timestamp) => {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const today = dayStart(now);
  return Array.from({ length: 7 }, (_, index) => {
    const start = today - (6 - index) * dayMs;
    const end = start + dayMs;
    return {
      date: new Date(start).toISOString().slice(0, 10),
      count: items.filter((item) => item.updatedAt >= start && item.updatedAt < end).length,
    };
  });
}

async function packageVersion() {
  const packageCandidates = [
    process.env.DSH_PACKAGE_JSON,
    path.resolve(process.cwd(), 'node_modules/@deepseek-ai/dsh/package.json'),
  ].filter(Boolean);
  for (const packagePath of packageCandidates) {
    try {
      const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
      if (manifest.version) return manifest.version;
    } catch { /* Try the next portable location. */ }
  }
  try {
    const linkRoot = path.join(homedir(), 'Library/pnpm/store/v11/links/@deepseek-ai/dsh');
    const candidates = await Promise.all((await readdir(linkRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
      .map(async (entry) => ({ name: entry.name, mtimeMs: (await stat(path.join(linkRoot, entry.name))).mtimeMs })));
    return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

const [host, presetList, settingsView, sessionsView, pluginInventory] = await Promise.all([
  call('host.describe'),
  call('agentPreset.list'),
  call('settings.describe'),
  call('session.list'),
  call('pluginInventory/list', { args: {} }),
]);

const namespaces = settingsView.namespaces || [];
const defaultPresetId = valueOf(namespaces, 'agent-presets').default
  || presetList.presets.find((preset) => preset.isDefault)?.id;
const presetPrivacyMap = createPresetPrivacyMap(presetList.presets);
const publicPresetId = (presetId) => presetPrivacyMap.get(String(presetId || '')) || 'user-preset';
const presetRead = await call('agentPreset.read', { agentPreset: defaultPresetId });
const presetRows = parsePresetRows(presetRead.content);
const sessions = sessionsView.items || [];
const projectSessions = sessions.filter((item) => item.cwd === projectPath);
const skillSession = projectSessions
  .filter((item) => item.agentPreset === defaultPresetId)
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  || null;
let skills = [];
if (skillSession) {
  try {
    skills = (await call('skill.list', { sessionId: skillSession.sessionId })).skills || [];
  } catch (error) {
    console.warn(`Skill inventory unavailable: ${error.message}`);
  }
}

const modelSettings = valueOf(namespaces, 'agent-default-model');
const selectedModel = {
  provider: modelSettings.provider || host.provider,
  model: modelSettings.model || host.model,
};
const modelMetadata = modelMetadataOf(namespaces, selectedModel);
const modelSpec = modelMetadata.model;
const providerSettings = modelMetadata.settings;
const pluginRows = pluginInventory.entries || [];

const snapshot = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: {
    api: 'loopback-dsh-web',
    profile: 'web',
    packageVersion: await packageVersion(),
    hostVersion: host.version,
  },
  config: {
    defaultPresetId: publicPresetId(defaultPresetId),
    presets: presetList.presets.map((preset) => publicPreset(preset, presetPrivacyMap)),
    authorablePresets: Boolean(presetList.authorable),
    activePreset: {
      id: publicPresetId(presetRead.agentPreset),
      trust: presetRead.trust,
      name: presetRead.trust === 'system' || includeUserPresetNames ? (presetRead.name || presetRead.agentPreset) : '用户角色卡',
    },
    model: {
      provider: selectedModel.provider,
      model: selectedModel.model,
      reasoningEffort: modelSettings.reasoningEffort,
      contextWindow: modelSpec.contextWindow || modelSpec.context?.contextWindow || providerSettings.defaultContextWindow,
      inputModalities: modelSpec.inputModalities || ['text'],
      maxTokens: modelSpec.maxTokens || modelSpec.defaultMaxTokens || providerSettings.maxTokens,
      metadataNamespace: modelMetadata.namespace,
    },
    webSearch: (() => {
      const settings = valueOf(namespaces, 'web-search-deepseek');
      return { model: settings.model, maxTokens: settings.maxTokens, maxUses: settings.maxUses };
    })(),
    agentLoop: pick(valueOf(namespaces, 'agent-loop'), ['maxParallelToolCalls']),
    shell: pick(valueOf(namespaces, 'shell'), ['timeoutMs', 'maxTimeoutMs']),
    permission: pick(valueOf(namespaces, 'permission'), ['defaultPreset']),
    locale: valueOf(namespaces, 'locale').preference,
    theme: valueOf(namespaces, 'ui-theme').preference,
    conversation: pick(valueOf(namespaces, 'ui-conversation'), ['busyEnter']),
    presetRows,
  },
  plugins: pluginRows.map(({ entryId, moduleName, enabled, fiberPhase }) => ({
    entryId,
    moduleName,
    enabled,
    fiberPhase,
  })),
  skillInventory: {
    status: skillSession ? 'available' : 'unavailable',
    source: 'project_session',
    presetId: publicPresetId(defaultPresetId),
    copyIncluded: includeSkillCopy,
  },
  skills: skills.map(({ name, description, whenToUse, modelInvocable }) => ({
    name,
    modelInvocable,
    ...(includeSkillCopy && description ? { description } : {}),
    ...(includeSkillCopy && whenToUse ? { whenToUse } : {}),
  })),
  sessions: {
    all: summarizeSessions(sessions, publicPresetId),
    project: {
      path: '当前项目（已匿名）',
      ...summarizeSessions(projectSessions, publicPresetId),
      recent: [],
      daily: dailySessions(projectSessions),
    },
  },
};

function assertPublicSnapshot(value, trail = []) {
  const deniedKeys = new Set(['sessionid', 'cwd', 'apikey', 'api_key', 'accesstoken', 'refreshtoken', 'password', 'secret', 'credential', 'credentials']);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicSnapshot(item, [...trail, String(index)]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (deniedKeys.has(key.toLowerCase())) throw new Error(`Refusing to write sensitive key at ${[...trail, key].join('.')}`);
      if (key.toLowerCase() === 'path' && item !== '当前项目（已匿名）') throw new Error(`Refusing to write a non-anonymous path at ${[...trail, key].join('.')}`);
      assertPublicSnapshot(item, [...trail, key]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (/(?:^|[\s"'])(?:\/(?:Users|home|private|var|tmp|opt|Volumes)\/|[A-Za-z]:\\)/.test(value)) throw new Error(`Refusing to write an absolute path at ${trail.join('.')}`);
  if (/https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$)|localhost(?::\d+)?(?:\/|$)|\[::1\](?::\d+)?(?:\/|$))/i.test(value)) {
    throw new Error(`Refusing to write a non-loopback URL at ${trail.join('.')}`);
  }
}

assertPublicSnapshot(snapshot);
const source = `/* Generated privacy-minimized snapshot. Review before public sharing; no conversation text or per-session records are included. */\nwindow.DSH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2).replace(/</g, '\\u003c')};\n`;
await writeFile(outputPath, source, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`Plugins ${pluginRows.filter((row) => row.enabled).length}/${pluginRows.length} enabled; skills ${skills.length}; project sessions ${projectSessions.length}.`);
