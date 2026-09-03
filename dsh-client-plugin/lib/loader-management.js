import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { withFileLock } from './file-lock.js';

const MANAGED_START = '# >>> DS HUB MANAGED LOADER OVERRIDES';
const MANAGED_END = '# <<< DS HUB MANAGED LOADER OVERRIDES';
const ROOT_ENTRY = /^include:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
const MODULE_NAME_MAX_LENGTH = 512;
const PACKAGE_NAME_MAX_LENGTH = 214;
const MODULE_NAME_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const BUILTIN_MUTABLE_ROOT_IDS = new Set([
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'agent-instructions',
  'skill-filesystem',
  'skill-badge',
  'tool-skill',
  'plan-mode',
  'compaction-basic',
  'command-compact',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'fork',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-result-pruner',
  'tool-todo',
  'tool-goal',
  'tool-ralph',
  'tool-str-replace-editor',
  'tool-web',
  'web-search-deepseek',
]);
const MANAGED_ROW = /^- \{ id: ("(?:[^"\\]|\\.)*"), name: ("(?:[^"\\]|\\.)*"), disabled: (true|false) \}$/;
const FIBER_PHASE = Object.freeze({
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
});
const READBACK_TIMEOUT_MS = 8_000;
const READBACK_INTERVAL_MS = 120;

function bridgeError(code, message, details = undefined, state = 'unchanged') {
  const error = new Error(message);
  error.code = code;
  error.state = state;
  if (details !== undefined) error.details = details;
  return error;
}

export function revisionOf(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function isSafeModuleName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MODULE_NAME_MAX_LENGTH) return false;
  const segments = value.split('/');
  const scoped = value.startsWith('@');
  if ((scoped && segments.length < 2) || (!scoped && segments.length < 1)) return false;
  const packageSegments = scoped ? [segments[0].slice(1), segments[1]] : [segments[0]];
  const subpathSegments = segments.slice(scoped ? 2 : 1);
  if (packageSegments.some((segment) => !MODULE_NAME_SEGMENT.test(segment))
    || subpathSegments.some((segment) => !MODULE_NAME_SEGMENT.test(segment))) {
    return false;
  }
  const packageName = scoped ? `@${packageSegments[0]}/${packageSegments[1]}` : packageSegments[0];
  return packageName.length <= PACKAGE_NAME_MAX_LENGTH;
}

function requireRequestModuleName(value) {
  if (!isSafeModuleName(value)) {
    throw bridgeError('invalid-request', 'moduleName 必须是安全的 npm 包名或包内子路径；不接受空白、URL、脚本片段或本地路径');
  }
  return value;
}

function managedSpan(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start
    || content.indexOf(MANAGED_START, start + MANAGED_START.length) !== -1
    || content.indexOf(MANAGED_END, end + MANAGED_END.length) !== -1) {
    throw bridgeError('managed-block-invalid', 'cordis.patch.yml 的 DS Hub 管理标记不完整或重复；为避免覆盖人工内容，本次未写入');
  }
  return { start, end: end + MANAGED_END.length };
}

export function parseManagedRows(content) {
  const span = managedSpan(content);
  const rows = new Map();
  if (!span) return rows;
  const lines = content.slice(span.start + MANAGED_START.length, span.end - MANAGED_END.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = MANAGED_ROW.exec(line);
    if (!match) {
      throw bridgeError('managed-block-invalid', 'DS Hub 管理块包含无法识别的内容；为避免覆盖人工内容，本次未写入');
    }
    const rawId = JSON.parse(match[1]);
    const moduleName = JSON.parse(match[2]);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(rawId) || !isSafeModuleName(moduleName)) {
      throw bridgeError('managed-block-invalid', 'DS Hub 管理块包含无效条目；本次未写入');
    }
    if (rows.has(rawId)) throw bridgeError('managed-block-invalid', `DS Hub 管理块重复声明 ${rawId}；本次未写入`);
    rows.set(rawId, { rawId, moduleName, enabled: match[3] === 'false' });
  }
  return rows;
}

function renderManagedRows(rows) {
  const body = [...rows.values()]
    .sort((left, right) => left.rawId.localeCompare(right.rawId))
    .map((row) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(row?.rawId) || !isSafeModuleName(row?.moduleName)) {
        throw bridgeError('managed-block-invalid', '待写入的 DS Hub 管理块包含无效条目；本次未写入');
      }
      return `- { id: ${JSON.stringify(row.rawId)}, name: ${JSON.stringify(row.moduleName)}, disabled: ${String(!row.enabled)} }`;
    })
    .join('\n');
  return `${MANAGED_START}\n${body}${body ? '\n' : ''}${MANAGED_END}`;
}

function removeEmptyListPlaceholder(content) {
  const significant = content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (significant.length !== 1 || !/^\[\]\s*(?:#.*)?$/.test(significant[0])) return content;
  return content.replace(/^([ \t]*)\[\][ \t]*(#.*)?$/m, (_line, indent, comment) => comment ? `${indent}${comment}` : '');
}

export function replaceManagedRows(content, rows) {
  const block = renderManagedRows(rows);
  const span = managedSpan(content);
  if (span) return content.slice(0, span.start) + block + content.slice(span.end);
  const base = removeEmptyListPlaceholder(content);
  const separator = base.length === 0 || base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return `${base}${separator}${block}\n`;
}

function entrySnapshot(entry) {
  return {
    entryId: entry.id,
    moduleName: entry.options.name,
    enabled: !entry.disabled,
    fiberPhase: entry.fiber === undefined ? null : (FIBER_PHASE[entry.fiber.state] ?? 'unknown'),
  };
}

function rootEntryMutability(entry) {
  const rootMatch = typeof entry?.id === 'string' ? ROOT_ENTRY.exec(entry.id) : null;
  if (!rootMatch || entry?.options?.group || typeof entry?.options?.name !== 'string') {
    return { mutable: false, reason: 'not-root-entry', rawId: rootMatch?.[1] || null };
  }
  const rawId = rootMatch[1];
  const moduleName = entry.options.name;
  if (!isSafeModuleName(moduleName)) {
    return { mutable: false, reason: 'invalid-module-name', rawId };
  }
  if (entry.id === 'include:ui-ds-hub' || moduleName === 'dsh-ds-hub') {
    return { mutable: false, reason: 'ds-hub-self', rawId };
  }
  if (!moduleName.startsWith('@deepseek-ai/')) {
    return { mutable: true, reason: 'third-party-root-entry', rawId };
  }
  if (BUILTIN_MUTABLE_ROOT_IDS.has(rawId)) {
    return { mutable: true, reason: 'optional-builtin-entry', rawId };
  }
  return { mutable: false, reason: 'protected-builtin-entry', rawId };
}

function exactEntry(loader, entryId, moduleName) {
  requireRequestModuleName(moduleName);
  const rootMatch = ROOT_ENTRY.exec(entryId);
  if (!rootMatch) {
    throw bridgeError('entry-scope-denied', '只允许管理 Web Profile 顶层 Host Loader 条目；Preset 组合子条目必须在角色卡中单独管理');
  }
  const entries = [...loader.entries()].filter((entry) => entry.id === entryId);
  if (entries.length !== 1) throw bridgeError('entry-not-found', `没有找到唯一 Loader 条目 ${entryId}`);
  const [entry] = entries;
  if (entry?.options?.group) throw bridgeError('entry-scope-denied', 'Loader group 不能通过 DS Hub 开关');
  if (!isSafeModuleName(entry?.options?.name)) {
    throw bridgeError('entry-scope-denied', 'Loader Inventory 返回了不安全的模块标识；DS Hub 已拒绝将其送入写入边界', {
      entryId,
      policy: 'invalid-module-name',
    });
  }
  if (entry.options.name !== moduleName) {
    throw bridgeError('identity-mismatch', `Loader 条目模块已变化：期望 ${moduleName}，实际 ${entry.options.name}`);
  }
  const policy = rootEntryMutability(entry);
  if (!policy.mutable) {
    const message = policy.reason === 'ds-hub-self'
      ? 'DS Hub 不能在处理请求时关闭自身桥接条目'
      : '这是 DSH 核心、安全或运行时入口；DS Hub 只允许管理第三方根入口和明确列出的可选能力入口';
    throw bridgeError('entry-scope-denied', message, {
      entryId,
      moduleName,
      policy: policy.reason,
    });
  }
  return { entry, rawId: rootMatch[1] };
}

async function atomicWrite(path, content, mode, expectedRevision, conflictCode = 'revision-conflict') {
  const tempPath = `${path}.ds-hub-${process.pid}-${randomUUID()}.tmp`;
  try {
    if (expectedRevision && revisionOf(await readFile(path)) !== expectedRevision) {
      throw bridgeError(conflictCode, 'cordis.patch.yml 在写入前发生并发变化；本次未覆盖', undefined, conflictCode === 'state-unknown' ? 'unknown' : 'unchanged');
    }
    await writeFile(tempPath, content, { mode });
    if (expectedRevision && revisionOf(await readFile(path)) !== expectedRevision) {
      throw bridgeError(conflictCode, 'cordis.patch.yml 在原子替换前发生并发变化；本次未覆盖', undefined, conflictCode === 'state-unknown' ? 'unknown' : 'unchanged');
    }
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEntry(loader, entryId, moduleName, desiredEnabled) {
  const deadline = Date.now() + READBACK_TIMEOUT_MS;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      if (typeof loader.await === 'function') await Promise.race([loader.await(), sleep(350)]);
    } catch {
      // The exact Fiber phase below is the authoritative readback for this row.
    }
    try {
      latest = entrySnapshot(exactEntry(loader, entryId, moduleName).entry);
      const observed = latest.enabled === desiredEnabled
        && (!desiredEnabled || latest.fiberPhase === 'active');
      if (observed) return latest;
    } catch (error) {
      if (error.code !== 'entry-not-found') throw error;
    }
    await sleep(READBACK_INTERVAL_MS);
  }
  throw bridgeError('apply-not-observed', '补丁已写入，但 Loader/Fiber 未在时限内回读到目标状态', { latest }, 'pending-rollback');
}

function ensureConfigured(profilePatchPath) {
  if (!profilePatchPath || !isAbsolute(profilePatchPath) || basename(profilePatchPath) !== 'cordis.patch.yml') {
    throw bridgeError('bridge-not-configured', 'DS Hub Loader 写桥未配置绝对 profilePatchPath');
  }
}

export function createLoaderManagement(ctx, { profilePatchPath }) {
  let mutationQueue = Promise.resolve();
  const idempotency = new Map();
  const configured = Boolean(profilePatchPath && isAbsolute(profilePatchPath) && basename(profilePatchPath) === 'cordis.patch.yml');

  async function preflight(request) {
    ensureConfigured(profilePatchPath);
    const entryId = String(request?.entryId || '').trim();
    const moduleName = requireRequestModuleName(request?.moduleName);
    const desiredEnabled = request?.desiredEnabled;
    if (typeof desiredEnabled !== 'boolean') throw bridgeError('invalid-request', 'desiredEnabled 必须是布尔值');
    const { entry } = exactEntry(ctx.loader, entryId, moduleName);
    const content = await readFile(profilePatchPath);
    parseManagedRows(content.toString('utf8'));
    const canonicalValue = entrySnapshot(entry);
    return {
      ok: true,
      mutable: true,
      scope: 'web-profile-root-loader-entry',
      targetId: `loader-entry:web:${encodeURIComponent(entryId)}`,
      targetRevision: revisionOf(content),
      canonicalValue,
      desiredValue: { enabled: desiredEnabled },
      evidenceRef: `dsh-loader-preflight:${revisionOf(content)}:${encodeURIComponent(entryId)}`,
    };
  }

  async function mutate(request) {
    ensureConfigured(profilePatchPath);
    const entryId = String(request?.entryId || '').trim();
    const moduleName = requireRequestModuleName(request?.moduleName);
    const desiredEnabled = request?.enabled;
    const expectedRevision = String(request?.expectedRevision || '');
    const expectedEnabled = request?.expectedEnabled;
    const idempotencyKey = String(request?.idempotencyKey || '').trim();
    if (typeof desiredEnabled !== 'boolean' || typeof expectedEnabled !== 'boolean'
      || !expectedRevision.startsWith('sha256:') || !idempotencyKey || idempotencyKey.length > 180) {
      throw bridgeError('invalid-request', 'setEnabled 缺少布尔目标、CAS revision、旧状态或幂等键');
    }
    return withFileLock(profilePatchPath, async () => {
      const { entry, rawId } = exactEntry(ctx.loader, entryId, moduleName);
      const beforeSnapshot = entrySnapshot(entry);
      if (beforeSnapshot.enabled !== expectedEnabled) {
        throw bridgeError('state-conflict', 'Loader 当前状态与预检状态不一致；请刷新后重试');
      }
      const beforeContent = await readFile(profilePatchPath);
      const beforeRevision = revisionOf(beforeContent);
      if (beforeRevision !== expectedRevision) {
        throw bridgeError('revision-conflict', 'cordis.patch.yml 已被其他操作修改；本次未写入');
      }
      if (beforeSnapshot.enabled === desiredEnabled) {
        return {
          ok: true,
          applied: false,
          targetId: `loader-entry:web:${encodeURIComponent(entryId)}`,
          targetRevision: beforeRevision,
          canonicalValue: beforeSnapshot,
          readback: beforeSnapshot,
          evidenceRef: `dsh-loader-readback:${beforeRevision}:${encodeURIComponent(entryId)}:${String(desiredEnabled)}`,
        };
      }

      const beforeText = beforeContent.toString('utf8');
      const rows = parseManagedRows(beforeText);
      rows.set(rawId, { rawId, moduleName, enabled: desiredEnabled });
      const nextText = replaceManagedRows(beforeText, rows);
      const nextContent = Buffer.from(nextText);
      const nextRevision = revisionOf(nextContent);
      const fileStat = await stat(profilePatchPath);
      await atomicWrite(profilePatchPath, nextContent, fileStat.mode, beforeRevision);

      try {
        const readback = await waitForEntry(ctx.loader, entryId, moduleName, desiredEnabled);
        const persisted = await readFile(profilePatchPath);
        const persistedRevision = revisionOf(persisted);
        if (persistedRevision !== nextRevision) {
          throw bridgeError('state-unknown', 'Loader 已变化，但补丁文件又被其他操作修改；不能把本次写入声明为最终状态', { readback }, 'unknown');
        }
        return {
          ok: true,
          applied: true,
          targetId: `loader-entry:web:${encodeURIComponent(entryId)}`,
          targetRevision: persistedRevision,
          canonicalValue: readback,
          readback,
          evidenceRef: `dsh-loader-readback:${persistedRevision}:${encodeURIComponent(entryId)}:${String(desiredEnabled)}`,
        };
      } catch (applyError) {
        const current = await readFile(profilePatchPath).catch(() => null);
        if (!current || revisionOf(current) !== nextRevision) {
          throw bridgeError('state-unknown', 'Loader 回读失败，且补丁文件发生并发变化；为避免覆盖他人修改，未自动恢复', {
            cause: applyError.message,
          }, 'unknown');
        }
        await atomicWrite(profilePatchPath, beforeContent, fileStat.mode, nextRevision, 'state-unknown');
        try {
          const restored = await waitForEntry(ctx.loader, entryId, moduleName, expectedEnabled);
          throw bridgeError('apply-not-observed', 'Loader 未达到目标状态；DS Hub 已恢复原补丁并核验原状态', {
            cause: applyError.message,
            restored,
          });
        } catch (rollbackError) {
          if (rollbackError.code === 'apply-not-observed' && rollbackError.details?.restored) throw rollbackError;
          throw bridgeError('state-unknown', '目标状态未生效，自动恢复也未能完成回读；请刷新 DSH 后检查', {
            apply: applyError.message,
            rollback: rollbackError.message,
          }, 'unknown');
        }
      }
    });
  }

  function setEnabled(request) {
    try {
      requireRequestModuleName(request?.moduleName);
    } catch (error) {
      return Promise.reject(error);
    }
    const idempotencyKey = String(request?.idempotencyKey || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 180) {
      return Promise.reject(bridgeError('invalid-request', 'setEnabled 缺少有效幂等键'));
    }
    const fingerprint = JSON.stringify({
      entryId: request?.entryId,
      moduleName: request?.moduleName,
      enabled: request?.enabled,
      expectedRevision: request?.expectedRevision,
      expectedEnabled: request?.expectedEnabled,
    });
    const previous = idempotency.get(idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return Promise.reject(bridgeError('idempotency-conflict', '同一幂等键不能用于不同 Loader 写入'));
      }
      return previous.task;
    }
    const task = mutationQueue.then(() => mutate(request), () => mutate(request));
    idempotency.set(idempotencyKey, { fingerprint, task });
    if (idempotency.size > 100) idempotency.delete(idempotency.keys().next().value);
    mutationQueue = task.catch(() => undefined);
    return task;
  }

  function mutableEntries() {
    const entries = [...ctx.loader.entries()];
    const counts = new Map();
    for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
    return entries
      .filter((entry) => counts.get(entry.id) === 1 && rootEntryMutability(entry).mutable)
      .map(entrySnapshot);
  }

  return { configured, mutableEntries, preflight, setEnabled };
}

export const __test = {
  MANAGED_START,
  MANAGED_END,
  BUILTIN_MUTABLE_ROOT_IDS,
  exactEntry,
  entrySnapshot,
  rootEntryMutability,
  isSafeModuleName,
};
