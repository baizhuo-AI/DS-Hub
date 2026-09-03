import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MODEL_TARGET_ID = 'settings:agent-default-model#/selection';
const PRESET_ROSTER_TARGET_ID = 'settings:agent-presets#/roster';
const DEFAULT_PRESET_MAPPING_PATH = join(homedir(), '.dsh', 'ds-hub', 'private', 'preset-mapping.json');
const BUSY_ENTER_VALUES = new Set(['queue', 'steer']);
const PRESET_REF_PATTERN = /^preset-ref-[a-f0-9]{32}$/;
const PRESET_MAPPING_ID_PATTERN = /^preset-map-[a-f0-9]{32}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

const TARGET_SPECS = Object.freeze({
  'settings:agent-default-model#/selection': {
    key: 'modelSelection',
    namespace: 'agent-default-model',
    read: (value) => readModelSelection(value),
    write(value) {
      const selection = writeModelSelection(value);
      return [
        { op: 'set', path: ['provider'], value: selection.provider },
        { op: 'set', path: ['model'], value: selection.model },
        { op: 'set', path: ['reasoningEffort'], value: selection.reasoningEffort },
      ];
    },
  },
  'settings:agent-default-model#/reasoningEffort': {
    key: 'reasoningEffort',
    namespace: 'agent-default-model',
    read: (value) => requiredString(value?.reasoningEffort, '当前推理强度'),
    write(value) {
      const effort = requiredString(value, '候选推理强度');
      return [{ op: 'set', path: ['reasoningEffort'], value: effort }];
    },
  },
  'settings:ui-conversation#/busyEnter': {
    key: 'busyEnter',
    namespace: 'ui-conversation',
    read: (value) => requiredString(value?.busyEnter, '当前忙时消息策略'),
    write(value) {
      const behavior = requiredString(value, '候选忙时消息策略');
      if (!BUSY_ENTER_VALUES.has(behavior)) throw bridgeError('invalid-value', 'busyEnter 只允许 queue 或 steer');
      return [{ op: 'set', path: ['busyEnter'], value: behavior }];
    },
  },
  'settings:agent-presets#/default': {
    key: 'defaultPresetId',
    namespace: 'agent-presets',
    presetMapped: true,
    read: (value, context) => context.refForRawPreset(requiredString(value?.default, '当前默认角色卡')),
    write(value, context) {
      const presetRef = requiredString(value, '候选默认角色卡');
      if (!PRESET_REF_PATTERN.test(presetRef)) throw bridgeError('invalid-value', '默认角色卡必须使用当前快照的 opaque ref');
      return [{ op: 'set', path: ['default'], value: context.rawPresetForRef(presetRef) }];
    },
  },
  'settings:web-search-deepseek#/maxUses': {
    key: 'webSearchMaxUses',
    namespace: 'web-search-deepseek',
    read(value) {
      const maxUses = value?.maxUses;
      if (!Number.isInteger(maxUses) || maxUses < 1) throw bridgeError('target-unavailable', '当前网页搜索上限不是正整数');
      return maxUses;
    },
    write(value) {
      if (!Number.isInteger(value) || value < 1 || value > 100) throw bridgeError('invalid-value', '网页搜索上限必须是 1–100 的整数');
      return [{ op: 'set', path: ['maxUses'], value }];
    },
  },
  'settings:permission#/defaultPreset': {
    key: 'permissionDefault',
    namespace: 'permission',
    read: (value) => requiredString(value?.defaultPreset, '当前默认权限'),
    write(value, _context, currentValue) {
      const preset = requiredString(value, '候选默认权限');
      if (preset !== 'workspace-write') throw bridgeError('invalid-value', 'DS Hub 目前只允许把新会话默认权限设为 workspace-write');
      if (currentValue !== 'danger-full-access') {
        throw bridgeError('invalid-value', 'DS Hub 只允许把 danger-full-access 收窄为 workspace-write；更严格或自定义权限不会被扩大或覆盖');
      }
      return [{ op: 'set', path: ['defaultPreset'], value: preset }];
    },
  },
});

export const SUPPORTED_SETTINGS_TARGETS = Object.freeze(Object.keys(TARGET_SPECS));

function bridgeError(code, message, state = 'unchanged', details) {
  const error = new Error(message);
  error.code = code;
  error.state = state;
  if (details !== undefined) error.details = details;
  return error;
}

function requiredString(value, label) {
  const raw = typeof value === 'string' ? value : '';
  const text = raw.trim();
  if (!text || text.length > 240 || /[\u0000-\u001f]/.test(text)) {
    throw bridgeError('invalid-value', `${label}无效`);
  }
  if (text !== raw) throw bridgeError('invalid-value', `${label}必须是已规范化字符串，不能带首尾空白`);
  return text;
}

function readModelSelection(value) {
  const provider = requiredString(value?.provider, '当前 Provider');
  const model = requiredString(value?.model, '当前模型');
  const reasoningEffort = typeof value?.reasoningEffort === 'string' && value.reasoningEffort.trim()
    ? requiredString(value.reasoningEffort, '当前推理强度')
    : '';
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

function writeModelSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bridgeError('invalid-value', '模型候选必须包含 provider、model 与 reasoningEffort');
  const allowedKeys = new Set(['provider', 'model', 'reasoningEffort']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw bridgeError('invalid-value', '模型候选包含未允许字段');
  const provider = requiredString(value.provider, '候选 Provider');
  const model = requiredString(value.model, '候选模型');
  const reasoningEffort = requiredString(value.reasoningEffort, '候选推理强度');
  return { provider, model, reasoningEffort };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalEqual(left, right) {
  return typeof left === typeof right && canonicalJson(left) === canonicalJson(right);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function evidence(kind, targetId, revision, rpcId = '') {
  return `dsh:${kind}:${encodeURIComponent(targetId)}:${encodeURIComponent(String(revision))}:${encodeURIComponent(rpcId)}:${randomUUID()}`;
}

function validRevision(value) {
  return Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);
}

function validEvidenceRef(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;
}

function exactTargetSnapshot(raw, expectedTargetId) {
  const targetId = String(raw?.targetId || '').trim();
  const revision = raw?.revision ?? raw?.targetRevision;
  if (targetId !== expectedTargetId || !validRevision(revision)
    || !Object.prototype.hasOwnProperty.call(raw || {}, 'canonicalValue')
    || !validEvidenceRef(raw?.evidenceRef)) return null;
  return { targetId, revision, canonicalValue: raw.canonicalValue, evidenceRef: String(raw.evidenceRef) };
}

function exactModelSnapshot(raw) {
  const targetId = String(raw?.targetId || '').trim();
  const revision = raw?.revision ?? raw?.settingsRevision;
  if (targetId !== MODEL_TARGET_ID || !validRevision(revision) || !validEvidenceRef(raw?.evidenceRef)) return null;
  let selection;
  try {
    selection = readModelSelection(raw.selection);
  } catch {
    return null;
  }
  return { targetId, revision, selection, evidenceRef: String(raw.evidenceRef) };
}

function targetSpec(request) {
  const targetId = String(request?.targetId || '').trim();
  const spec = TARGET_SPECS[targetId];
  if (!spec) throw bridgeError('unsupported-target', `DS Hub 不支持配置目标 ${targetId || '（空）'}`);
  const key = String(request?.key || '').trim();
  if (key !== spec.key) throw bridgeError('unsupported-target', `配置 key 与目标 ${targetId} 不匹配`);
  return { targetId, spec };
}

function rpcFailure(result, fallback) {
  const error = bridgeError(
    String(result?.error?.code || 'dsh-rpc-error'),
    String(result?.error?.message || fallback),
    'unchanged',
    result?.error?.details,
  );
  return error;
}

function ensureRpcSuccess(response, request, fallback) {
  if (response?.rpcId !== request.rpcId || !response?.result || typeof response.result !== 'object') {
    throw bridgeError('dsh-rpc-mismatch', `${fallback}：DSH 返回了不匹配的 RPC 回执`);
  }
  if (response.result.ok === true) return response.result.value;
  throw rpcFailure(response.result, fallback);
}

function namespaceFrom(description, namespace) {
  const found = description?.namespaces?.find((item) => item?.ns === namespace);
  if (!found || !validRevision(found.revision) || !Object.prototype.hasOwnProperty.call(found, 'value')) {
    throw bridgeError('target-unavailable', `DSH 没有返回可核验的 ${namespace} namespace`);
  }
  return found;
}

async function readPresetMapping(path) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  } catch (error) {
    const code = error?.code === 'ELOOP' ? 'preset-mapping-invalid' : 'preset-mapping-unavailable';
    throw bridgeError(code, code === 'preset-mapping-invalid' ? '私有角色卡映射不能是符号链接' : '默认角色卡写入需要当前快照的私有映射', 'unchanged', { cause: error?.code });
  }
  let mapping;
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
      throw bridgeError('preset-mapping-invalid', '私有角色卡映射必须是当前用户拥有的 0600 普通文件');
    }
    mapping = JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error?.code === 'preset-mapping-invalid') throw error;
    throw bridgeError('preset-mapping-invalid', '私有角色卡映射无法安全读取');
  } finally {
    await handle.close().catch(() => undefined);
  }
  const entries = Array.isArray(mapping?.entries) ? mapping.entries.filter((entry) => entry?.inRoster === true) : [];
  const refs = entries.map((entry) => String(entry?.ref || ''));
  const rawIds = entries.map((entry) => String(entry?.rawPresetId || ''));
  if (mapping?.schemaVersion !== 1 || mapping?.kind !== 'ds-hub-private-preset-mapping'
    || !PRESET_MAPPING_ID_PATTERN.test(String(mapping?.presetMappingId || ''))
    || typeof mapping?.snapshotIdentity !== 'string' || !mapping.snapshotIdentity
    || typeof mapping?.presetRosterRevision !== 'string' || !mapping.presetRosterRevision
    || !entries.length || refs.some((ref) => !PRESET_REF_PATTERN.test(ref)) || rawIds.some((id) => !id || id.length > 240)
    || new Set(refs).size !== refs.length || new Set(rawIds).size !== rawIds.length) {
    throw bridgeError('preset-mapping-invalid', '私有角色卡映射与当前 DS Hub 契约不一致');
  }
  return { ...mapping, entries };
}

function verifyPresetIdentity(mapping, request) {
  const identity = request?.presetIdentity;
  if (!identity || identity.presetMappingId !== mapping.presetMappingId
    || identity.snapshotIdentity !== mapping.snapshotIdentity
    || identity.presetRosterRevision !== mapping.presetRosterRevision) {
    throw bridgeError('preset-roster-conflict', '角色卡快照或私有映射已经变化');
  }
}

function liveRosterRevision(mapping, presets, defaultRef) {
  const projection = presets.map((preset) => ({
    ref: preset.ref,
    trust: preset.trust,
    mountable: true,
    isDefault: preset.ref === defaultRef,
  })).sort((left, right) => left.ref.localeCompare(right.ref));
  return `preset-roster-live-${sha256(`${mapping.presetMappingId}\0${canonicalJson(projection)}`).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function compareTarget(actual, expected) {
  return Boolean(actual && expected
    && actual.targetId === expected.targetId
    && actual.revision === expected.revision
    && canonicalEqual(actual.canonicalValue, expected.canonicalValue));
}

function compareModel(actual, expected) {
  return Boolean(actual && expected
    && actual.targetId === expected.targetId
    && actual.revision === expected.revision
    && canonicalEqual(actual.selection, expected.selection));
}

function compareRoster(actual, expected) {
  return Boolean(actual && expected
    && actual.targetId === expected.targetId
    && actual.revision === expected.revision
    && actual.defaultPresetRef === expected.defaultPresetRef
    && actual.presetMappingId === expected.presetMappingId
    && actual.snapshotIdentity === expected.snapshotIdentity
    && actual.candidatePresetRef === expected.candidatePresetRef
    && actual.candidatePresetDigest === expected.candidatePresetDigest);
}

function storedError(record) {
  return bridgeError(record.code, record.message, record.state, record.details);
}

export function createSettingsManagement(apiProxy, rawConfig = {}) {
  const configured = Boolean(apiProxy?.settings?.describe && apiProxy?.settings?.mutate && apiProxy?.llm?.models);
  const presetMappingPath = resolve(String(rawConfig.presetMappingPath || DEFAULT_PRESET_MAPPING_PATH));
  const assistantPreset = requiredString(rawConfig.assistantPreset || 'ds-hub-assistant', 'DS Hub 内部助手角色卡');
  const ledger = new Map();
  let rpcCounter = 0;
  let applyTail = Promise.resolve();

  function rpcRequest(prefix, payload) {
    return {
      rpcId: `ds-hub-${prefix}-${Date.now().toString(36)}-${++rpcCounter}-${randomUUID()}`,
      payload,
    };
  }

  async function describeSettings() {
    if (!configured) throw bridgeError('settings-bridge-unavailable', 'DSH apiProxy settings 服务未连接');
    const request = rpcRequest('settings-describe', {});
    const response = await apiProxy.settings.describe(request);
    const value = ensureRpcSuccess(response, request, 'settings.describe 未完成');
    if (value?.writable !== true) throw bridgeError('settings-read-only', '当前 DSH settings provider 是只读的');
    return { rpcId: request.rpcId, value };
  }

  async function readModelCatalog() {
    if (!apiProxy?.llm?.models) throw bridgeError('model-catalog-unavailable', 'DSH llm.models 服务未连接');
    const request = rpcRequest('llm-models', {});
    const response = await apiProxy.llm.models(request);
    const value = ensureRpcSuccess(response, request, 'llm.models 未完成');
    if (!Array.isArray(value?.groups) || !Array.isArray(value?.failures)) {
      throw bridgeError('model-catalog-unavailable', 'DSH 没有返回可核验的模型目录');
    }
    return { rpcId: request.rpcId, value };
  }

  function validateCatalogSelection(catalog, selection) {
    const provider = requiredString(selection?.provider, '候选 Provider');
    const model = requiredString(selection?.model, '候选模型');
    const effort = requiredString(selection?.reasoningEffort, '候选推理强度');
    const groups = catalog?.value?.groups || [];
    const matchingGroups = groups.filter((group) => group?.id === provider);
    if (matchingGroups.length !== 1 || !Array.isArray(matchingGroups[0]?.models)) {
      const failed = (catalog?.value?.failures || []).find((failure) => failure?.id === provider);
      throw bridgeError('invalid-value', failed
        ? `Provider ${provider} 的实时模型目录不可用：${String(failed.message || '未知错误').slice(0, 180)}`
        : `Provider ${provider} 不在 DSH 当前可用目录中`);
    }
    const models = matchingGroups[0].models.filter((item) => item?.id === model);
    if (models.length !== 1) throw bridgeError('invalid-value', `模型 ${model} 不在 Provider ${provider} 的 DSH 实时目录中`);
    const efforts = models[0]?.reasoning?.efforts;
    if (!Array.isArray(efforts) || efforts.filter((item) => item?.id === effort).length !== 1) {
      throw bridgeError('invalid-value', `模型 ${provider}/${model} 不支持推理强度 ${effort}`);
    }
    return { provider, model, reasoningEffort: effort, catalogRpcId: catalog.rpcId };
  }

  async function listPresets() {
    if (!apiProxy?.agentPresets?.list) throw bridgeError('preset-roster-unavailable', 'DSH agentPreset.list 未连接');
    const request = rpcRequest('preset-list', {});
    const response = await apiProxy.agentPresets.list(request);
    const value = ensureRpcSuccess(response, request, 'agentPreset.list 未完成');
    if (!Array.isArray(value?.presets)) throw bridgeError('preset-roster-unavailable', 'DSH 没有返回可核验的角色卡清单');
    return { rpcId: request.rpcId, value };
  }

  async function readPresetComposition(rawPresetId, expectedTrust) {
    if (!apiProxy?.agentPresets?.read) throw bridgeError('preset-roster-unavailable', 'DSH agentPreset.read 未连接');
    const request = rpcRequest('preset-read', { agentPreset: rawPresetId });
    const response = await apiProxy.agentPresets.read(request);
    const value = ensureRpcSuccess(response, request, 'agentPreset.read 未完成');
    if (String(value?.agentPreset || '') !== rawPresetId || String(value?.trust || '') !== expectedTrust
      || typeof value?.content !== 'string' || value.content.length > 2_000_000) {
      throw bridgeError('preset-roster-conflict', '候选角色卡内容、身份或 trust 无法核验');
    }
    return { digest: sha256(value.content), rpcId: request.rpcId };
  }

  async function presetContext(request, namespace, settingsRpcId) {
    const [mapping, roster] = await Promise.all([readPresetMapping(presetMappingPath), listPresets()]);
    verifyPresetIdentity(mapping, request);
    const byRaw = new Map(mapping.entries.map((entry) => [String(entry.rawPresetId), entry]));
    const byRef = new Map(mapping.entries.map((entry) => [String(entry.ref), entry]));
    if (byRaw.has(assistantPreset)) throw bridgeError('preset-mapping-invalid', '内部助手角色卡不能进入用户角色卡映射');
    const internalRows = roster.value.presets.filter((preset) => String(preset?.id || '') === assistantPreset);
    if (internalRows.length > 1) throw bridgeError('preset-roster-conflict', 'DS Hub 内部助手角色卡身份不唯一');
    if (internalRows.length === 1) {
      const internal = internalRows[0];
      if (internal?.broken || internal?.isDefault === true || !['user', 'system'].includes(String(internal?.trust || ''))) {
        throw bridgeError('preset-roster-conflict', 'DS Hub 内部助手角色卡不可装载、被设为默认或 trust 异常');
      }
    }
    const presets = roster.value.presets.filter((preset) => String(preset?.id || '') !== assistantPreset).map((preset) => {
      const rawId = String(preset?.id || '');
      const mapped = byRaw.get(rawId);
      if (!mapped) throw bridgeError('preset-roster-conflict', '当前 DSH 角色卡清单包含快照外身份');
      if (preset?.broken) throw bridgeError('preset-roster-conflict', '当前 DSH 角色卡清单包含不可装载角色卡');
      const trust = requiredString(preset?.trust, '当前角色卡 trust');
      if (trust !== mapped.trust) throw bridgeError('preset-roster-conflict', '当前 DSH 角色卡 trust 与已锁定清单不一致');
      return { ref: mapped.ref, rawId, trust, mountable: true, isDefault: Boolean(preset?.isDefault) };
    });
    if (presets.length !== mapping.entries.length || new Set(presets.map((item) => item.rawId)).size !== mapping.entries.length) {
      throw bridgeError('preset-roster-conflict', '当前 DSH 角色卡清单与私有映射不一致');
    }
    const rawDefault = requiredString(namespace.value?.default, '当前默认角色卡');
    const current = byRaw.get(rawDefault);
    if (!current) throw bridgeError('preset-roster-conflict', '当前默认角色卡不属于已锁定清单');
    const mappedDefault = mapping.entries.find((entry) => entry.isDefault === true)?.ref || '';
    const listedDefault = presets.find((preset) => preset.isDefault)?.ref || '';
    const unchanged = mappedDefault === current.ref && listedDefault === current.ref;
    const revision = unchanged
      ? mapping.presetRosterRevision
      : liveRosterRevision(mapping, presets, current.ref);
    const rosterMembershipDigest = sha256(canonicalJson(presets.map((preset) => ({
      ref: preset.ref,
      trust: preset.trust,
      mountable: preset.mountable,
    })).sort((left, right) => left.ref.localeCompare(right.ref))));
    const context = {
      mapping,
      rosterMembershipDigest,
      rosterIntegrityDigest: rosterMembershipDigest,
      refForRawPreset(rawId) {
        const entry = byRaw.get(String(rawId));
        if (!entry) throw bridgeError('preset-roster-conflict', '角色卡身份不属于当前私有映射');
        return entry.ref;
      },
      rawPresetForRef(ref) {
        const entry = byRef.get(String(ref));
        if (!entry) throw bridgeError('preset-roster-conflict', '候选角色卡不属于当前私有映射');
        return entry.rawPresetId;
      },
      async compositionForRef(ref) {
        const entry = byRef.get(String(ref));
        if (!entry) throw bridgeError('preset-roster-conflict', '候选角色卡不属于当前私有映射');
        const composition = await readPresetComposition(entry.rawPresetId, entry.trust);
        return { ref: entry.ref, digest: composition.digest, rpcId: composition.rpcId };
      },
      rosterSnapshot: {
        targetId: PRESET_ROSTER_TARGET_ID,
        revision,
        defaultPresetRef: current.ref,
        presetMappingId: mapping.presetMappingId,
        snapshotIdentity: mapping.snapshotIdentity,
        evidenceRef: evidence('preset-roster-read', PRESET_ROSTER_TARGET_ID, revision, `${settingsRpcId}:${roster.rpcId}`),
      },
    };
    return context;
  }

  async function snapshotFromDescription(request, description) {
    const { targetId, spec } = targetSpec(request);
    const namespace = namespaceFrom(description.value, spec.namespace);
    const context = spec.presetMapped ? await presetContext(request, namespace, description.rpcId) : {};
    let canonicalValue;
    try {
      canonicalValue = spec.read(namespace.value, context);
    } catch (error) {
      if (error?.code) throw error;
      throw bridgeError('target-unavailable', `配置目标 ${targetId} 无法读取`);
    }
    if (canonicalValue === undefined) throw bridgeError('target-unavailable', `配置目标 ${targetId} 没有当前值`);
    let presetRoster = context.rosterSnapshot || null;
    if (spec.presetMapped) {
      const candidatePresetRef = Object.prototype.hasOwnProperty.call(request || {}, 'value')
        ? requiredString(request.value, '候选角色卡引用')
        : canonicalValue;
      if (!PRESET_REF_PATTERN.test(candidatePresetRef)) throw bridgeError('invalid-value', '候选角色卡必须使用当前快照的 opaque ref');
      const composition = await context.compositionForRef(candidatePresetRef);
      context.rosterIntegrityDigest = sha256(`${context.rosterMembershipDigest}\0${composition.ref}\0${composition.digest}`);
      presetRoster = {
        ...context.rosterSnapshot,
        candidatePresetRef: composition.ref,
        candidatePresetDigest: composition.digest,
        evidenceRef: evidence('preset-roster-read', PRESET_ROSTER_TARGET_ID, context.rosterSnapshot.revision, `${description.rpcId}:${composition.rpcId}`),
      };
    }
    return {
      targetId,
      revision: namespace.revision,
      canonicalValue,
      evidenceRef: evidence('settings-read', targetId, namespace.revision, description.rpcId),
      namespace,
      context,
      ...(presetRoster ? { presetRoster } : {}),
    };
  }

  function modelSnapshot(description) {
    const namespace = namespaceFrom(description.value, 'agent-default-model');
    return {
      targetId: MODEL_TARGET_ID,
      revision: namespace.revision,
      selection: readModelSelection(namespace.value),
      evidenceRef: evidence('model-environment-guard', MODEL_TARGET_ID, namespace.revision, description.rpcId),
    };
  }

  async function preflight(request) {
    targetSpec(request);
    const description = await describeSettings();
    const current = await snapshotFromDescription(request, description);
    return {
      ok: true,
      targetId: current.targetId,
      targetRevision: current.revision,
      canonicalValue: current.canonicalValue,
      evidenceRef: current.evidenceRef,
      ...(current.presetRoster ? { presetRoster: current.presetRoster } : {}),
    };
  }

  function normalizeGuards(request, targetId) {
    const target = exactTargetSnapshot(request?.adoptionPreflight?.target, targetId);
    const modelEnvironment = exactModelSnapshot(request?.adoptionPreflight?.modelEnvironment);
    if (!target || !modelEnvironment || target.evidenceRef === modelEnvironment.evidenceRef) {
      throw bridgeError('invalid-guard', '写入前必须提供相互独立的目标与模型环境预检');
    }
    return { target, modelEnvironment };
  }

  function normalizeRosterGuard(request, current) {
    const raw = request?.adoptionPreflight?.presetRoster;
    if (!current.presetRoster) {
      if (raw !== undefined) throw bridgeError('invalid-guard', '普通 settings 写入不能携带角色卡 roster guard');
      return null;
    }
    const guard = {
      targetId: String(raw?.targetId || ''),
      revision: raw?.revision ?? raw?.presetRosterRevision,
      defaultPresetRef: String(raw?.defaultPresetRef || ''),
      presetMappingId: String(raw?.presetMappingId || ''),
      snapshotIdentity: String(raw?.snapshotIdentity || ''),
      candidatePresetRef: String(raw?.candidatePresetRef || ''),
      candidatePresetDigest: String(raw?.candidatePresetDigest || ''),
      evidenceRef: String(raw?.evidenceRef || ''),
    };
    if (guard.targetId !== PRESET_ROSTER_TARGET_ID || !validEvidenceRef(guard.evidenceRef)
      || !PRESET_REF_PATTERN.test(guard.candidatePresetRef) || !SHA256_PATTERN.test(guard.candidatePresetDigest)
      || !compareRoster(current.presetRoster, guard)) {
      throw bridgeError('preset-roster-conflict', '角色卡 roster guard 与当前 DSH 状态不一致');
    }
    return guard;
  }

  function guardReceipt(request, guards, rosterGuard) {
    const id = `ds-hub-guard-${randomUUID()}`;
    const receipt = {
      id,
      evidenceRef: evidence('settings-guard', guards.target.targetId, guards.target.revision, id),
      candidateId: request.idempotencyKey,
      idempotencyKey: request.idempotencyKey,
      expectedTargetRevision: guards.target.revision,
      expectedModelRevision: guards.modelEnvironment.revision,
      ...(rosterGuard ? {
        expectedRosterRevision: rosterGuard.revision,
        expectedDefaultPresetRef: rosterGuard.defaultPresetRef,
        expectedPresetMappingId: rosterGuard.presetMappingId,
        snapshotIdentity: rosterGuard.snapshotIdentity,
        expectedCandidatePresetRef: rosterGuard.candidatePresetRef,
        expectedCandidatePresetDigest: rosterGuard.candidatePresetDigest,
      } : {}),
    };
    receipt.digest = sha256(canonicalJson({ ...receipt, digest: undefined }));
    return receipt;
  }

  async function mutateSettings(spec, operations, expectedRevision) {
    const request = rpcRequest('settings-mutate', {
      ns: spec.namespace,
      ops: operations,
      expectedRevision,
    });
    let response;
    try {
      response = await apiProxy.settings.mutate(request);
    } catch (error) {
      throw bridgeError('state-unknown', 'settings.mutate 未返回可判定结果', 'state-unknown', { cause: String(error?.message || error) });
    }
    if (response?.rpcId !== request.rpcId || !response?.result || typeof response.result !== 'object') {
      throw bridgeError('state-unknown', 'settings.mutate 返回了不匹配的 RPC 回执', 'state-unknown');
    }
    if (response.result.ok !== true) {
      if (response.result.error?.code === 'settings-conflict') {
        throw bridgeError('revision-conflict', '目标 settings revision 已变化，未执行写入', 'unchanged', response.result.error.details);
      }
      throw bridgeError('state-unknown', response.result.error?.message || 'settings.mutate 未完成', 'state-unknown', response.result.error?.details);
    }
    return { rpcId: request.rpcId, value: response.result.value };
  }

  async function performApply(request) {
    const { targetId, spec } = targetSpec(request);
    if (!validRevision(request?.expectedRevision)) throw bridgeError('invalid-revision', 'settings 写入必须提供数值 expectedRevision');
    if (!Object.prototype.hasOwnProperty.call(request || {}, 'expectedOldValue')
      || !Object.prototype.hasOwnProperty.call(request || {}, 'value')) {
      throw bridgeError('invalid-value', 'settings 写入缺少原值或候选值');
    }
    const guards = normalizeGuards(request, targetId);
    const beforeDescription = await describeSettings();
    const current = await snapshotFromDescription(request, beforeDescription);
    const currentModel = modelSnapshot(beforeDescription);
    const rosterGuard = normalizeRosterGuard(request, current);
    if (current.revision !== request.expectedRevision
      || !canonicalEqual(current.canonicalValue, request.expectedOldValue)
      || !compareTarget(current, guards.target)
      || !compareModel(currentModel, guards.modelEnvironment)) {
      throw bridgeError('revision-conflict', '写入前目标值、revision 或模型环境已经变化');
    }
    if (targetId === MODEL_TARGET_ID || targetId === 'settings:agent-default-model#/reasoningEffort') {
      const candidateSelection = targetId === MODEL_TARGET_ID
        ? writeModelSelection(request.value)
        : { ...currentModel.selection, reasoningEffort: request.value };
      validateCatalogSelection(await readModelCatalog(), candidateSelection);
    }
    const operations = spec.write(request.value, current.context, current.canonicalValue);
    if (canonicalEqual(current.canonicalValue, request.value)) throw bridgeError('state-conflict', '候选值与当前配置相同，未执行写入');
    const receipt = guardReceipt(request, guards, rosterGuard);
    const written = await mutateSettings(spec, operations, current.revision);

    try {
      // Never treat settings.mutate's response as the readback. This is a fresh,
      // independent settings.describe after the write boundary.
      const afterDescription = await describeSettings();
      const after = await snapshotFromDescription(request, afterDescription);
      const responseRevision = written.value?.revision;
      if (!validRevision(responseRevision) || after.revision !== responseRevision
        || after.revision === current.revision || !canonicalEqual(after.canonicalValue, request.value)) {
        throw bridgeError('state-unknown', '写入回执与独立回读不一致', 'state-unknown');
      }
      const afterModel = modelSnapshot(afterDescription);
      let modelGuardHeld;
      if (targetId === MODEL_TARGET_ID) {
        modelGuardHeld = afterModel.revision === after.revision
          && canonicalEqual(afterModel.selection, writeModelSelection(request.value));
      } else if (targetId === 'settings:agent-default-model#/reasoningEffort') {
        modelGuardHeld = afterModel.revision === after.revision
          && canonicalEqual(afterModel.selection, { ...guards.modelEnvironment.selection, reasoningEffort: request.value });
      } else {
        modelGuardHeld = compareModel(afterModel, guards.modelEnvironment);
      }
      if (!modelGuardHeld) {
        throw bridgeError('state-unknown', '目标写入已发生，但模型环境在同一操作窗口内变化，不能声明采用成功', 'state-unknown');
      }
      if (current.presetRoster && after.context?.rosterIntegrityDigest !== current.context?.rosterIntegrityDigest) {
        throw bridgeError('state-unknown', '默认角色卡写入已发生，但角色卡清单在同一操作窗口内变化，不能声明采用成功', 'state-unknown');
      }
      const response = {
        ok: true,
        targetId,
        targetRevision: after.revision,
        evidenceRef: evidence('settings-write', targetId, after.revision, written.rpcId),
        guardReceipt: receipt,
        guards: {
          target: guards.target,
          modelEnvironment: guards.modelEnvironment,
          ...(rosterGuard ? { presetRoster: rosterGuard } : {}),
        },
      };
      return {
        response,
        verification: {
          modelEnvironment: afterModel,
          rosterIntegrityDigest: after.context?.rosterIntegrityDigest || null,
        },
      };
    } catch (error) {
      if (error?.state === 'state-unknown') throw error;
      throw bridgeError('state-unknown', '写入已发生，但写后环境核验未完成', 'state-unknown', {
        cause: String(error?.message || error),
        code: String(error?.code || 'post-write-verification-error'),
      });
    }
  }

  function idempotencyKey(request) {
    const key = String(request?.idempotencyKey || '').trim();
    if (!key || key.length > 240 || /[\u0000-\u001f]/.test(key)) throw bridgeError('invalid-idempotency-key', '写入需要有效 idempotencyKey');
    return key;
  }

  function withApplyLock(operation) {
    const running = applyTail.then(operation, operation);
    applyTail = running.catch(() => undefined);
    return running;
  }

  async function apply(request) {
    const key = idempotencyKey(request);
    const requestDigest = sha256(canonicalJson(request));
    return withApplyLock(async () => {
      const existing = ledger.get(key);
      if (existing) {
        if (existing.digest !== requestDigest) throw bridgeError('idempotency-conflict', '同一 idempotencyKey 已绑定其他写入');
        if (existing.status === 'completed') return existing.response;
        if (existing.status === 'unknown' || existing.status === 'pending') {
          throw bridgeError('state-unknown', '先前写入状态未知；不会自动重试', 'state-unknown');
        }
        throw storedError(existing.error);
      }
      ledger.set(key, { status: 'pending', digest: requestDigest });
      try {
        const completed = await performApply(request);
        ledger.set(key, { status: 'completed', digest: requestDigest, response: completed.response, verification: completed.verification });
        return completed.response;
      } catch (error) {
        const record = {
          code: String(error?.code || 'bridge-error'),
          message: String(error?.message || 'settings 写入未完成'),
          state: String(error?.state || 'unchanged'),
          details: error?.details,
        };
        ledger.set(key, { status: record.state === 'state-unknown' ? 'unknown' : 'failed', digest: requestDigest, error: record });
        throw error;
      }
    });
  }

  async function readback(request) {
    const key = idempotencyKey(request);
    const record = ledger.get(key);
    if (!record || record.status !== 'completed') {
      throw bridgeError('state-unknown', '本机桥没有可核验的已完成写入回执', 'state-unknown');
    }
    const expected = record.response;
    if (String(request?.appliedTargetId || '') !== expected.targetId
      || request?.appliedTargetRevision !== expected.targetRevision
      || request?.guardReceipt?.digest !== expected.guardReceipt.digest
      || request?.applyEvidenceRef !== expected.evidenceRef) {
      throw bridgeError('state-unknown', '回读请求没有绑定同一次写入回执', 'state-unknown');
    }
    let current;
    let description;
    try {
      description = await describeSettings();
      current = await snapshotFromDescription(request, description);
    } catch (error) {
      throw bridgeError('state-unknown', '独立回读失败', 'state-unknown', { cause: error?.message });
    }
    try {
      const currentModel = modelSnapshot(description);
      const modelGuardHeld = compareModel(currentModel, record.verification?.modelEnvironment);
      const rosterGuardHeld = !record.verification?.rosterIntegrityDigest
        || current.context?.rosterIntegrityDigest === record.verification.rosterIntegrityDigest;
      const verified = current.targetId === expected.targetId
        && current.revision === expected.targetRevision
        && canonicalEqual(current.canonicalValue, request.value)
        && modelGuardHeld
        && rosterGuardHeld;
      return {
        ok: true,
        verified,
        targetId: current.targetId,
        targetRevision: current.revision,
        canonicalValue: current.canonicalValue,
        evidenceRef: current.evidenceRef,
        ...(current.presetRoster ? { presetRoster: current.presetRoster } : {}),
      };
    } catch (error) {
      if (error?.state === 'state-unknown') throw error;
      throw bridgeError('state-unknown', '独立回读无法完成模型与角色卡核验', 'state-unknown', {
        cause: String(error?.message || error),
        code: String(error?.code || 'readback-verification-error'),
      });
    }
  }

  return {
    configured,
    supportedTargets: SUPPORTED_SETTINGS_TARGETS,
    preflight,
    apply,
    readback,
  };
}

export const __test = {
  canonicalEqual,
  canonicalJson,
  liveRosterRevision,
};
