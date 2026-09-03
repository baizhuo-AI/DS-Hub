#!/usr/bin/env node

import { chmod, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, '../dsh-snapshot.js');
const repositoryPath = path.resolve(scriptDir, '..');
const privateDirectoryPath = path.resolve(process.env.DS_HUB_PRIVATE_DIR || path.join(homedir(), '.dsh', 'ds-hub', 'private'));
const privatePresetMappingPath = path.join(privateDirectoryPath, 'preset-mapping.json');
const INTERNAL_ASSISTANT_PRESET = 'ds-hub-assistant';
const cliArgs = process.argv.slice(2);
const includeSkillCopy = cliArgs.includes('--include-skill-copy');
const includeUserPresetNames = cliArgs.includes('--include-user-preset-names');
const includeUserPromptCopy = cliArgs.includes('--include-user-prompt-copy');
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

function valueAtPath(value, parts = []) {
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function modelListOf(settings) {
  if (Array.isArray(settings)) return settings;
  if (!settings || typeof settings !== 'object') return [];
  return [settings.models, settings.availableModels, settings.modelCatalog].find(Array.isArray) || [];
}

function modelMetadataOf(namespaces, selection, providerDirectory = []) {
  const providerEntry = providerDirectory.find((entry) => entry?.provider === selection.provider);
  if (providerEntry) {
    const namespace = namespaces.find((item) => item.ns === providerEntry.settingsNs);
    const settings = valueAtPath(namespace?.value, providerEntry.settingsPath || []);
    const model = modelListOf(settings).find((item) => (item?.id || item?.model) === selection.model);
    if (model) {
      return {
        namespace: providerEntry.settingsNs,
        settings: settings || {},
        model: { ...model, id: model.id || model.model, provider: selection.provider },
      };
    }
    return { namespace: providerEntry.settingsNs, settings: settings || {}, model: {} };
  }
  const candidates = [];
  for (const namespace of namespaces) {
    if (!namespace.ns?.startsWith('llm-')) continue;
    const settings = namespace.value || {};
    const models = modelListOf(settings);
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

function modelDirectoryOf(catalog, namespaces, providerDirectory) {
  const byRoute = new Map();
  for (const group of catalog?.groups || []) {
    const provider = String(group?.id || '');
    if (!provider) continue;
    for (const advertised of group.models || []) {
      const id = String(advertised?.id || '');
      if (!id) continue;
      const metadata = modelMetadataOf(namespaces, { provider, model: id }, providerDirectory);
      const spec = metadata.model || {};
      const settings = metadata.settings || {};
      const contextWindow = spec.contextWindow ?? spec.context?.contextWindow ?? settings.defaultContextWindow;
      const maxTokens = spec.maxTokens ?? spec.defaultMaxTokens ?? settings.defaultMaxTokens ?? settings.maxTokens;
      const inputModalities = Array.isArray(spec.inputModalities) ? [...spec.inputModalities] : [];
      const reasoningEfforts = Array.isArray(advertised?.reasoning?.efforts)
        ? advertised.reasoning.efforts.map((effort) => ({
          id: String(effort?.id || ''),
          label: String(effort?.name || effort?.id || ''),
        })).filter((effort) => effort.id)
        : [];
      const next = {
        provider,
        id,
        label: String(advertised.name || spec.name || id),
        contextWindow: Number.isInteger(contextWindow) && contextWindow > 0 ? contextWindow : null,
        inputModalities,
        maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : null,
        metadataNamespace: metadata.namespace,
        reasoningEfforts,
        defaultReasoningEffort: reasoningEfforts.some((effort) => effort.id === advertised?.reasoning?.defaultEffort)
          ? String(advertised.reasoning.defaultEffort)
          : null,
      };
      const key = `${provider}\u0000${id}`;
      const previous = byRoute.get(key);
      if (!previous) {
        byRoute.set(key, next);
        continue;
      }
      byRoute.set(key, {
        provider,
        id,
        label: previous.label !== previous.id ? previous.label : next.label,
        contextWindow: previous.contextWindow ?? next.contextWindow,
        inputModalities: previous.inputModalities.length ? previous.inputModalities : next.inputModalities,
        maxTokens: previous.maxTokens ?? next.maxTokens,
        metadataNamespace: previous.metadataNamespace ?? next.metadataNamespace,
        reasoningEfforts: previous.reasoningEfforts.length ? previous.reasoningEfforts : next.reasoningEfforts,
        defaultReasoningEffort: previous.defaultReasoningEffort ?? next.defaultReasoningEffort,
      });
    }
  }
  return [...byRoute.values()];
}

function parseScalar(text) {
  const value = text.trim().replace(/^['"]|['"]$/g, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function yamlValueOf(block, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*)${escapedKey}:\\s*(.*?)\\s*$`);
  const index = block.findIndex((line) => pattern.test(line));
  if (index < 0) return undefined;
  const match = block[index].match(pattern);
  const rawValue = match?.[2] || '';
  const blockMarker = rawValue.match(/^([>|])([+-]?)(?:\d+)?(?:\s+#.*)?$/);
  if (!blockMarker) return parseScalar(rawValue);

  const keyIndent = match[1].length;
  const body = [];
  for (let lineIndex = index + 1; lineIndex < block.length; lineIndex += 1) {
    const line = block[lineIndex];
    if (!line.trim()) {
      body.push('');
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= keyIndent) break;
    body.push(line);
  }
  const contentIndent = body.filter((line) => line.trim()).reduce((minimum, line) => (
    Math.min(minimum, line.match(/^\s*/)[0].length)
  ), Number.POSITIVE_INFINITY);
  const normalized = body.map((line) => line ? line.slice(Number.isFinite(contentIndent) ? contentIndent : 0) : '');
  if (blockMarker[1] === '|') return normalized.join('\n').replace(/\n+$/, '');
  return normalized.join('\n').split(/\n{2,}/).map((paragraph) => paragraph.replace(/\n/g, ' ')).join('\n').trimEnd();
}

function parsePresetRows(content, { includePersonaCopy = false } = {}) {
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
    for (const key of [
      'provider', 'toolName', 'mode', 'fetch', 'searchTimeoutMs', 'maxRounds', 'maxBytes', 'allowParallelInProgress',
      'auto', 'thresholdRatio', 'retainRatio', 'retainTokens', 'summarizationProvider', 'summarizationModel', 'maxTokens',
      'thresholdChars', 'headChars', 'tailChars',
    ]) {
      const value = yamlValueOf(block, key);
      if (value !== undefined) config[key] = value;
    }
    if (String(start.id) === 'persona') {
      const text = yamlValueOf(block, 'text');
      if (includePersonaCopy && typeof text === 'string') config.text = text;
      return {
        id: String(start.id),
        moduleName: String(moduleName),
        enabled: !disabled,
        config,
        promptCopy: includePersonaCopy && typeof text === 'string' ? 'included' : includePersonaCopy ? 'unavailable' : 'withheld',
      };
    }
    return { id: String(start.id), moduleName: String(moduleName), enabled: !disabled, config };
  }).filter((row) => row.moduleName && row.moduleName !== 'cordis:group');
}

function assertPresetPromptPrivacy(rows, presetTrust) {
  if (presetTrust === 'system' || includeUserPromptCopy) return;
  const persona = rows.find((row) => row.id === 'persona');
  if (!persona) return;
  if (Object.prototype.hasOwnProperty.call(persona.config || {}, 'text') || persona.promptCopy !== 'withheld') {
    throw new Error('Refusing to write user preset prompt copy without --include-user-prompt-copy.');
  }
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

function randomPublicRef(prefix, used = new Set()) {
  let value;
  do value = `${prefix}-${randomBytes(16).toString('hex')}`;
  while (used.has(value));
  used.add(value);
  return value;
}

function createPresetRefMap(rawPresetIds) {
  const refs = new Map();
  const used = new Set();
  for (const rawPresetId of rawPresetIds) {
    const rawId = String(rawPresetId || '');
    if (!rawId) continue;
    if (refs.has(rawId)) continue;
    refs.set(rawId, randomPublicRef('preset-ref', used));
  }
  return refs;
}

function presetRosterRevision(publicPresets, presetMappingId) {
  const projection = (publicPresets || []).map((preset) => ({
    ref: String(preset?.ref || ''),
    trust: String(preset?.trust || 'unknown'),
    isDefault: Boolean(preset?.isDefault),
    name: String(preset?.name || ''),
  })).sort((a, b) => a.ref.localeCompare(b.ref));
  return `preset-roster-${createHash('sha256').update(`${presetMappingId}\0${JSON.stringify(projection)}`).digest('hex').slice(0, 32)}`;
}

function publicPreset(preset, presetRefMap) {
  const trust = preset?.trust || 'unknown';
  const canExposeName = trust === 'system' || includeUserPresetNames;
  const rawId = String(preset?.id || '');
  const ref = presetRefMap.get(rawId);
  if (!ref) throw new Error('Preset roster contains an unmapped identity.');
  return {
    id: ref,
    ref,
    trust,
    isDefault: Boolean(preset?.isDefault),
    name: canExposeName && preset?.name && String(preset.name) !== rawId
      ? String(preset.name)
      : trust === 'system' ? '内置角色卡' : '用户角色卡',
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

function snapshotIdentityOf(snapshot) {
  return [snapshot.schemaVersion, snapshot.capturedAt, snapshot.source?.packageVersion, snapshot.source?.hostVersion].join('|');
}

function pathIsWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function privatePresetMappingOf({ presetMappingId, snapshot, presets, presetRefMap }) {
  const roster = new Map((presets || []).map((preset) => [String(preset?.id || ''), preset]));
  return {
    schemaVersion: 1,
    kind: 'ds-hub-private-preset-mapping',
    presetMappingId,
    snapshotIdentity: snapshotIdentityOf(snapshot),
    presetRosterRevision: snapshot.config.presetRosterRevision,
    createdAt: snapshot.capturedAt,
    entries: [...presetRefMap.entries()].map(([rawPresetId, ref]) => {
      const preset = roster.get(rawPresetId);
      return {
        ref,
        rawPresetId,
        inRoster: Boolean(preset),
        ...(preset ? { trust: String(preset.trust || 'unknown'), isDefault: Boolean(preset.isDefault) } : {}),
      };
    }),
  };
}

function presetMappingMatchesSnapshot(mapping, snapshot) {
  if (mapping?.presetMappingId !== snapshot?.config?.presetMappingId
    || mapping?.snapshotIdentity !== snapshotIdentityOf(snapshot)
    || mapping?.presetRosterRevision !== snapshot?.config?.presetRosterRevision
    || presetRosterRevision(snapshot?.config?.presets, snapshot?.config?.presetMappingId) !== snapshot?.config?.presetRosterRevision) return false;
  const publicRosterRefs = (snapshot.config.presets || []).map((preset) => preset.ref).sort();
  const privateRosterRefs = (mapping.entries || []).filter((entry) => entry.inRoster === true).map((entry) => entry.ref).sort();
  return JSON.stringify(publicRosterRefs) === JSON.stringify(privateRosterRefs);
}

function resolveRawPresetId(mapping, snapshot, ref) {
  if (!presetMappingMatchesSnapshot(mapping, snapshot)) throw new Error('Preset mapping binding mismatch.');
  const entry = (mapping.entries || []).find((candidate) => candidate.ref === ref && candidate.inRoster === true);
  if (!entry) throw new Error('Unknown preset public reference.');
  return entry.rawPresetId;
}

function assertPresetMappingInvariant(mapping, snapshot) {
  if (mapping?.kind !== 'ds-hub-private-preset-mapping' || mapping?.schemaVersion !== 1) {
    throw new Error('Preset mapping sidecar schema is unsupported.');
  }
  if (!/^preset-map-[a-f0-9]{32}$/.test(String(mapping?.presetMappingId || ''))) {
    throw new Error('Preset mapping id is not a CSPRNG 128-bit public token.');
  }
  if (!/^preset-roster-[a-f0-9]{32}$/.test(String(mapping?.presetRosterRevision || ''))) {
    throw new Error('Preset roster revision is malformed.');
  }
  const entries = mapping.entries || [];
  const refs = entries.map((entry) => entry.ref);
  const rawIds = entries.map((entry) => entry.rawPresetId);
  if (!refs.length || refs.some((ref) => !/^preset-ref-[a-f0-9]{32}$/.test(String(ref || '')))) {
    throw new Error('Preset mapping contains an invalid public reference.');
  }
  if (new Set(refs).size !== refs.length || new Set(rawIds).size !== rawIds.length) {
    throw new Error('Preset mapping identities are not one-to-one.');
  }
  if (!presetMappingMatchesSnapshot(mapping, snapshot)) throw new Error('Preset mapping is not bound to this snapshot roster.');

  const publicIdentityValues = [
    snapshot.config.defaultPresetId,
    snapshot.config.defaultPresetRef,
    snapshot.config.activePreset?.id,
    snapshot.config.activePreset?.ref,
    snapshot.config.activePreset?.name,
    snapshot.skillInventory?.presetId,
    ...(snapshot.config.presets || []).flatMap((preset) => [preset.id, preset.ref, preset.name]),
    ...Object.keys(snapshot.sessions?.all?.presetCounts || {}),
    ...Object.keys(snapshot.sessions?.project?.presetCounts || {}),
  ];
  if (rawIds.some((rawId) => publicIdentityValues.includes(rawId))) {
    throw new Error('Public snapshot still exposes a raw preset identity.');
  }
  const mappedRefs = new Set(refs);
  const publicRefs = publicIdentityValues.filter((value) => /^preset-ref-[a-f0-9]{32}$/.test(String(value || '')));
  if (publicRefs.some((ref) => !mappedRefs.has(ref))) {
    throw new Error('Public snapshot contains an unresolvable preset reference.');
  }
  const rosterRefs = entries.filter((entry) => entry.inRoster === true).map((entry) => entry.ref);
  const nonRosterRefs = entries.filter((entry) => entry.inRoster !== true).map((entry) => entry.ref);
  for (const ref of rosterRefs) resolveRawPresetId(mapping, snapshot, ref);
  for (const ref of nonRosterRefs) {
    let rejected = false;
    try {
      resolveRawPresetId(mapping, snapshot, ref);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('Non-roster preset reference was accepted for configuration access.');
  }

  const staleMapping = { ...mapping, snapshotIdentity: `${mapping.snapshotIdentity}|stale` };
  if (presetMappingMatchesSnapshot(staleMapping, snapshot)) {
    throw new Error('Stale preset mapping was not rejected.');
  }
  const differentMappingId = mapping.presetMappingId === `preset-map-${'0'.repeat(32)}`
    ? `preset-map-${'1'.repeat(32)}`
    : `preset-map-${'0'.repeat(32)}`;
  const newerSnapshot = { ...snapshot, config: { ...snapshot.config, presetMappingId: differentMappingId } };
  if (presetMappingMatchesSnapshot(mapping, newerSnapshot)) {
    throw new Error('Old preset mapping was accepted by a new snapshot binding.');
  }
}

async function writePrivatePresetMapping(mapping) {
  if (pathIsWithin(repositoryPath, privateDirectoryPath)) {
    throw new Error('Private preset mapping directory must be outside the repository.');
  }
  await mkdir(privateDirectoryPath, { recursive: true, mode: 0o700 });
  const [realRepositoryPath, realPrivateDirectoryPath] = await Promise.all([
    realpath(repositoryPath),
    realpath(privateDirectoryPath),
  ]);
  if (pathIsWithin(realRepositoryPath, realPrivateDirectoryPath)) {
    throw new Error('Private preset mapping directory resolves inside the repository.');
  }
  await chmod(realPrivateDirectoryPath, 0o700);

  const temporaryPath = path.join(realPrivateDirectoryPath, `.preset-mapping.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, privatePresetMappingPath);
    await chmod(privatePresetMappingPath, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  const written = await stat(privatePresetMappingPath);
  if (!written.isFile() || (written.mode & 0o777) !== 0o600) {
    throw new Error('Private preset mapping permissions are not 0600.');
  }
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

const [host, presetList, settingsView, sessionsView, pluginInventory, providerDirectoryView, modelCatalogView] = await Promise.all([
  call('host.describe'),
  call('agentPreset.list'),
  call('settings.describe'),
  call('session.list'),
  call('pluginInventory/list', { args: {} }),
  call('llm.providers'),
  call('llm.models'),
]);

const namespaces = settingsView.namespaces || [];
const defaultPresetId = valueOf(namespaces, 'agent-presets').default
  || presetList.presets.find((preset) => preset.isDefault)?.id;
if (defaultPresetId === INTERNAL_ASSISTANT_PRESET) {
  throw new Error('DS Hub internal assistant preset cannot be the DSH default preset.');
}
const presetRead = await call('agentPreset.read', { agentPreset: defaultPresetId });
const publicPresets = (presetList.presets || []).filter((preset) => String(preset?.id || '') !== INTERNAL_ASSISTANT_PRESET);
const sessions = (sessionsView.items || []).filter((session) => String(session?.agentPreset || '') !== INTERNAL_ASSISTANT_PRESET);
const observedPresetIds = new Set([
  ...publicPresets.map((preset) => String(preset?.id || '')),
  String(defaultPresetId || ''),
  String(presetRead.agentPreset || ''),
  ...sessions.map((item) => String(item?.agentPreset || '')),
].filter(Boolean));
const presetMappingId = randomPublicRef('preset-map');
const presetRefMap = createPresetRefMap(observedPresetIds);
const publicPresetRef = (presetId) => {
  const rawId = String(presetId || '');
  if (!rawId) return '';
  const ref = presetRefMap.get(rawId);
  if (!ref) throw new Error('Observed preset identity is missing from the private mapping.');
  return ref;
};
const publicPresetRoster = publicPresets.map((preset) => publicPreset(preset, presetRefMap));
const rosterRevision = presetRosterRevision(publicPresetRoster, presetMappingId);
const presetRows = parsePresetRows(presetRead.content, {
  includePersonaCopy: presetRead.trust === 'system' || includeUserPromptCopy,
});
assertPresetPromptPrivacy(presetRows, presetRead.trust);
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
const providerDirectory = providerDirectoryView.providers || [];
const modelMetadata = modelMetadataOf(namespaces, selectedModel, providerDirectory);
const modelSpec = modelMetadata.model;
const providerSettings = modelMetadata.settings;
const models = modelDirectoryOf(modelCatalogView, namespaces, providerDirectory);
const pluginRows = pluginInventory.entries || [];
const schemaVersion = 1;
const capturedAt = new Date().toISOString();
const sourceMetadata = {
  api: 'loopback-dsh-web',
  profile: 'web',
  packageVersion: await packageVersion(),
  hostVersion: host.version,
};

const snapshot = {
  schemaVersion,
  capturedAt,
  source: sourceMetadata,
  config: {
    presetMappingId,
    defaultPresetId: publicPresetRef(defaultPresetId),
    defaultPresetRef: publicPresetRef(defaultPresetId),
    presetRosterRevision: rosterRevision,
    presets: publicPresetRoster,
    authorablePresets: Boolean(presetList.authorable),
    activePreset: {
      id: publicPresetRef(presetRead.agentPreset),
      ref: publicPresetRef(presetRead.agentPreset),
      trust: presetRead.trust,
      name: (presetRead.trust === 'system' || includeUserPresetNames)
        && presetRead.name && String(presetRead.name) !== String(presetRead.agentPreset || '')
        ? String(presetRead.name)
        : presetRead.trust === 'system' ? '内置角色卡' : '用户角色卡',
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
    models,
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
    presetId: publicPresetRef(defaultPresetId),
    copyIncluded: includeSkillCopy,
  },
  skills: skills.map(({ name, description, whenToUse, modelInvocable }) => ({
    name,
    modelInvocable,
    ...(includeSkillCopy && description ? { description } : {}),
    ...(includeSkillCopy && whenToUse ? { whenToUse } : {}),
  })),
  sessions: {
    all: summarizeSessions(sessions, publicPresetRef),
    project: {
      path: '当前项目（已匿名）',
      ...summarizeSessions(projectSessions, publicPresetRef),
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
const privatePresetMapping = privatePresetMappingOf({
  presetMappingId,
  snapshot,
  presets: publicPresets,
  presetRefMap,
});
assertPresetMappingInvariant(privatePresetMapping, snapshot);
await writePrivatePresetMapping(privatePresetMapping);
const source = `/* Generated privacy-minimized snapshot. Review before public sharing; no conversation text or per-session records are included. */\nwindow.DSH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2).replace(/</g, '\\u003c')};\n`;
await writeFile(outputPath, source, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`Preset mapping invariant verified for ${presetRefMap.size} one-time refs; stale bindings rejected.`);
console.log(`Plugins ${pluginRows.filter((row) => row.enabled).length}/${pluginRows.length} enabled; skills ${skills.length}; project sessions ${projectSessions.length}.`);
