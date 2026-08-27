#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, '../dsh-snapshot.js');
const apiBase = (process.argv[2] || 'http://127.0.0.1:3080').replace(/\/$/, '');
const projectPath = path.resolve(process.argv[3] || process.env.DS_HUB_PROJECT_PATH || path.resolve(scriptDir, '..'));

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

function summarizeSessions(items) {
  return {
    total: items.length,
    running: items.filter((item) => item.running).length,
    blank: items.filter((item) => item.blank).length,
    presetCounts: countBy(items, (item) => item.agentPreset),
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
const presetRead = await call('agentPreset.read', { agentPreset: defaultPresetId });
const presetRows = parsePresetRows(presetRead.content);
const sessions = sessionsView.items || [];
const skillSession = sessions
  .filter((item) => item.agentPreset === defaultPresetId)
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  || sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
let skills = [];
if (skillSession) {
  try {
    skills = (await call('skill.list', { sessionId: skillSession.sessionId })).skills || [];
  } catch (error) {
    console.warn(`Skill inventory unavailable: ${error.message}`);
  }
}

const modelSettings = valueOf(namespaces, 'agent-default-model');
const deepseekSettings = valueOf(namespaces, 'llm-deepseek');
const modelSpec = (deepseekSettings.models || []).find((model) => model.id === modelSettings.model) || {};
const projectSessions = sessions.filter((item) => item.cwd === projectPath);
const pluginRows = pluginInventory.entries || [];

const snapshot = {
  schemaVersion: 1,
  capturedAt: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  source: {
    apiBase,
    profile: 'web',
    packageVersion: await packageVersion(),
    hostVersion: host.version,
  },
  config: {
    defaultPresetId,
    presets: presetList.presets,
    authorablePresets: presetList.authorable,
    activePreset: {
      id: presetRead.agentPreset,
      name: presetRead.name || presetRead.agentPreset,
      description: presetRead.description || '',
      trust: presetRead.trust,
    },
    model: {
      provider: modelSettings.provider || host.provider,
      model: modelSettings.model || host.model,
      reasoningEffort: modelSettings.reasoningEffort,
      contextWindow: modelSpec.contextWindow || deepseekSettings.defaultContextWindow,
      inputModalities: modelSpec.inputModalities || ['text'],
      maxTokens: deepseekSettings.maxTokens,
    },
    webSearch: (() => {
      const settings = valueOf(namespaces, 'web-search-deepseek');
      return { model: settings.model, maxTokens: settings.maxTokens, maxUses: settings.maxUses };
    })(),
    agentLoop: valueOf(namespaces, 'agent-loop'),
    shell: valueOf(namespaces, 'shell'),
    permission: valueOf(namespaces, 'permission'),
    locale: valueOf(namespaces, 'locale').preference,
    theme: valueOf(namespaces, 'ui-theme').preference,
    conversation: valueOf(namespaces, 'ui-conversation'),
    presetRows,
  },
  plugins: pluginRows.map(({ entryId, moduleName, enabled, fiberPhase }) => ({
    entryId,
    moduleName,
    enabled,
    fiberPhase,
  })),
  skills: skills.map(({ name, description, whenToUse, modelInvocable }) => ({
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    modelInvocable,
  })),
  sessions: {
    all: summarizeSessions(sessions),
    project: {
      path: '当前项目（已匿名）',
      ...summarizeSessions(projectSessions),
      recent: [],
      daily: dailySessions(projectSessions),
    },
  },
};

const source = `/* Generated by scripts/sync-dsh-snapshot.mjs. Contains no credentials, conversation content, session IDs, or per-session records. */\nwindow.DSH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2).replace(/</g, '\\u003c')};\n`;
await writeFile(outputPath, source, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`Plugins ${pluginRows.filter((row) => row.enabled).length}/${pluginRows.length} enabled; skills ${skills.length}; project sessions ${projectSessions.length}.`);
