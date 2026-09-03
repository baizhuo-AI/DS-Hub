#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from '../lib/file-lock.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const presetSource = join(pluginRoot, 'preset', 'ds-hub-assistant');
const INSTALL_START = '# >>> DS HUB INSTALL';
const INSTALL_END = '# <<< DS HUB INSTALL';

function parseArgs(argv) {
  const options = {
    apply: false,
    verifyOnly: false,
    profile: 'web',
    dshHome: process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh'),
    dshUrl: 'http://127.0.0.1:3080',
    dshBin: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--verify-only') options.verifyOnly = true;
    else if (arg === '--profile') options.profile = String(argv[++index] || '');
    else if (arg === '--dsh-home') options.dshHome = resolve(String(argv[++index] || ''));
    else if (arg === '--dsh-url') options.dshUrl = String(argv[++index] || '');
    else if (arg === '--dsh-bin') options.dshBin = resolve(String(argv[++index] || ''));
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.profile)) throw new Error('profile 名称无效');
  const apiUrl = new URL(options.dshUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(apiUrl.hostname)) throw new Error('--dsh-url 必须是 loopback 地址');
  return options;
}

function usage() {
  return `用法：
  node scripts/install-dsh-hub.mjs                 # 只读预检（默认）
  node scripts/install-dsh-hub.mjs --apply         # 构建并安装到 web profile
  node scripts/install-dsh-hub.mjs --verify-only   # 重启 DSH 后做 live 回读

可选：--dsh-home PATH --profile web --dsh-url http://127.0.0.1:3080 --dsh-bin PATH`;
}

async function sameTree(leftRoot, rightRoot) {
  const walk = async (root, relative = '') => {
    const rows = [];
    for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
      const child = join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error(`拒绝 preset 符号链接：${child}`);
      if (item.isDirectory()) rows.push(...await walk(root, child));
      else if (item.isFile()) rows.push(child);
      else throw new Error(`拒绝 preset 特殊文件：${child}`);
    }
    return rows;
  };
  const left = (await walk(leftRoot)).sort();
  const right = (await walk(rightRoot)).sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  for (const relative of left) {
    const [a, b] = await Promise.all([readFile(join(leftRoot, relative)), readFile(join(rightRoot, relative))]);
    if (!a.equals(b)) return false;
  }
  return true;
}

async function copyPresetWithoutOverwrite(destination) {
  if (existsSync(destination)) {
    if (!await sameTree(presetSource, destination)) {
      throw new Error(`已存在内容不同的 ${destination}；安装器不会覆盖，请先人工审阅`);
    }
    return 'already-identical';
  }
  const root = dirname(destination);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, `.ds-hub-assistant-${randomUUID()}.tmp`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const item of await readdir(presetSource, { withFileTypes: true })) {
      if (!item.isFile()) throw new Error(`preset 源只应包含普通文件：${item.name}`);
      const source = join(presetSource, item.name);
      const target = join(temporary, item.name);
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`拒绝 preset 符号链接：${item.name}`);
      await copyFile(source, target);
      await chmod(target, 0o600);
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return 'installed';
}

async function preflightPreset(destination) {
  if (!existsSync(destination)) return 'absent';
  if (!await sameTree(presetSource, destination)) {
    throw new Error(`已存在内容不同的 ${destination}；安装器不会覆盖，请先人工审阅`);
  }
  return 'already-identical';
}

function installBlock(profilePatchPath) {
  return `${INSTALL_START}\n- id: "ui-ds-hub"\n  name: "dsh-ds-hub"\n  config:\n    assistantPreset: "ds-hub-assistant"\n    profilePatchPath: ${JSON.stringify(profilePatchPath)}\n${INSTALL_END}`;
}

function removeEmptyListPlaceholder(content) {
  const significant = content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (significant.length !== 1 || !/^\[\]\s*(?:#.*)?$/.test(significant[0])) return content;
  return content.replace(/^([ \t]*)\[\][ \t]*(#.*)?$/m, (_line, indent, comment) => comment ? `${indent}${comment}` : '');
}

function replaceInstallBlock(content, profilePatchPath) {
  const start = content.indexOf(INSTALL_START);
  const end = content.indexOf(INSTALL_END);
  const block = installBlock(profilePatchPath);
  if (start === -1 && end === -1) {
    const base = removeEmptyListPlaceholder(content);
    const separator = base.length === 0 || base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
    return `${base}${separator}${block}\n`;
  }
  if (start === -1 || end === -1 || end < start
    || content.indexOf(INSTALL_START, start + INSTALL_START.length) !== -1
    || content.indexOf(INSTALL_END, end + INSTALL_END.length) !== -1) {
    throw new Error('cordis.patch.yml 的 DS HUB INSTALL 标记不完整或重复；未修改');
  }
  return content.slice(0, start) + block + content.slice(end + INSTALL_END.length);
}

async function atomicWriteWithBackup(path, content, stamp, expectedContent) {
  return withFileLock(path, async () => {
    const old = await readFile(path);
    if (expectedContent !== undefined && !old.equals(Buffer.from(expectedContent))) {
      const error = new Error(`${path} 在预检后被其他操作修改；本次未覆盖`);
      error.code = 'revision-conflict';
      throw error;
    }
    if (old.equals(Buffer.from(content))) return { changed: false, backup: null };
    const backup = `${path}.ds-hub-backup-${stamp}`;
    await copyFile(path, backup, 0);
    const mode = (await stat(path)).mode;
    const temporary = `${path}.ds-hub-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { mode });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { changed: true, backup };
  });
}

function findDshBin(options) {
  const candidates = [
    options.dshBin,
    join(options.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('未找到已安装的 DSH CLI；请传 --dsh-bin /absolute/path/to/@deepseek-ai/dsh/lib/bin.js');
  return found;
}

function childEnv(overrides = {}) {
  const localBin = join(homedir(), '.local', 'bin');
  return { ...process.env, PATH: `${localBin}:${process.env.PATH || ''}`, ...overrides };
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: childEnv(env) });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(command)} 退出码 ${String(result.status)}`);
}

async function ensurePackage(options, profileDir) {
  const manifestPath = join(profileDir, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const existing = manifest.dependencies?.['dsh-ds-hub'];
  if (existing) {
    const installedPath = join(profileDir, 'node_modules', 'dsh-ds-hub');
    const sameInstall = existsSync(installedPath)
      && await realpath(installedPath).catch(() => '') === await realpath(pluginRoot);
    if (!sameInstall) throw new Error(`profile 已声明其他 dsh-ds-hub（${existing}）；安装器不会替换`);
    return { status: 'already-linked', backup: null };
  }
  const dshBin = findDshBin(options);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const backup = `${manifestPath}.ds-hub-backup-${stamp}`;
  await copyFile(manifestPath, backup, 0);
  run(process.execPath, [dshBin, 'plugin', '--profile', options.profile, 'add', pluginRoot], pluginRoot, { DSH_HOME: options.dshHome });
  return { status: 'installed', backup };
}

async function packagePresent(profileDir) {
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'));
  return Object.hasOwn(manifest.dependencies || {}, 'dsh-ds-hub');
}

async function removeInstalledPackage(options) {
  const dshBin = findDshBin(options);
  run(process.execPath, [dshBin, 'plugin', '--profile', options.profile, 'remove', 'dsh-ds-hub'], pluginRoot, { DSH_HOME: options.dshHome });
}

export async function runInstallTransaction(steps) {
  let packageCreated = false;
  let presetCreated = false;
  try {
    const packageResult = await steps.installPackage();
    packageCreated = packageResult.status === 'installed';
    const presetResult = await steps.installPreset();
    presetCreated = presetResult === 'installed';
    const patchResult = await steps.writePatch();
    return { packageResult, presetResult, patchResult };
  } catch (cause) {
    const rollbackErrors = [];
    try {
      if (presetCreated) await steps.rollbackPreset();
    } catch (error) {
      rollbackErrors.push(`preset: ${error.message}`);
    }
    try {
      if (packageCreated || await steps.packageAppeared()) await steps.rollbackPackage();
    } catch (error) {
      rollbackErrors.push(`package: ${error.message}`);
    }
    if (rollbackErrors.length) {
      const error = new Error(`安装失败，且自动清理未完全核验：${cause.message}; ${rollbackErrors.join('; ')}`);
      error.code = 'state-unknown';
      error.cause = cause;
      throw error;
    }
    const error = new Error(`安装失败，已清理本次新建的 package/preset：${cause.message}`);
    error.code = cause.code || 'install-rolled-back';
    error.cause = cause;
    throw error;
  }
}

async function rpc(baseUrl, method, payload, remote = false) {
  const rpcId = `ds-hub-install-${Date.now().toString(36)}-${randomUUID()}`;
  const endpoint = remote ? method : method.replaceAll('/', '.');
  const body = remote ? { args: payload } : payload;
  const response = await fetch(new URL(`/api/${endpoint}`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: body }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const envelope = await response.json();
  if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId || envelope.result?.ok !== true) {
    throw new Error(envelope?.result?.error?.message || `${method} 未返回有效回执`);
  }
  return envelope.result.value;
}

async function liveVerify(options) {
  try {
    const [presets, inventory, presetRead, expectedPresetContent] = await Promise.all([
      rpc(options.dshUrl, 'agentPreset.list', {}),
      rpc(options.dshUrl, 'pluginInventory/list', {}, true),
      rpc(options.dshUrl, 'agentPreset.read', { agentPreset: 'ds-hub-assistant' }),
      readFile(join(presetSource, 'agent.cordis.yml'), 'utf8'),
    ]);
    const preset = presets.presets?.find((item) => item.id === 'ds-hub-assistant');
    const entry = inventory.entries?.find((item) => item.entryId === 'include:ui-ds-hub' && item.moduleName === 'dsh-ds-hub');
    const presetExact = preset?.trust === 'user'
      && !preset?.broken
      && presetRead?.agentPreset === 'ds-hub-assistant'
      && presetRead?.trust === 'user'
      && presetRead?.content === expectedPresetContent;
    return {
      reachable: true,
      preset: preset ? { id: preset.id, trust: preset.trust, broken: preset.broken || null, exactToolFreeComposition: presetExact } : null,
      loader: entry || null,
      verified: Boolean(presetExact && entry?.enabled === true && entry?.fiberPhase === 'active'),
    };
  } catch (error) {
    return { reachable: false, verified: false, error: error.message };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const profileDir = join(options.dshHome, 'profiles', options.profile);
  const profilePatchPath = join(profileDir, 'cordis.patch.yml');
  const presetDestination = join(options.dshHome, '.agent-presets', 'ds-hub-assistant');
  if (!existsSync(profilePatchPath)) throw new Error(`profile patch 不存在：${profilePatchPath}`);

  if (options.verifyOnly) {
    const verify = await liveVerify(options);
    console.log(JSON.stringify({ mode: 'verify-only', verify }, null, 2));
    if (!verify.verified) process.exitCode = 2;
    return;
  }

  const currentPatch = await readFile(profilePatchPath, 'utf8');
  const nextPatch = replaceInstallBlock(currentPatch, profilePatchPath);
  const presetPreflight = await preflightPreset(presetDestination);
  const packageExistedBefore = await packagePresent(profileDir);
  if (!options.apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      writes: false,
      build: pluginRoot,
      packageTarget: profileDir,
      presetSource,
      presetTarget: presetDestination,
      presetPreflight,
      packageExistedBefore,
      patchTarget: profilePatchPath,
      next: '确认后加 --apply；安装完成并重启 DSH Web 后运行 --verify-only',
    }, null, 2));
    return;
  }

  run(process.execPath, [join(pluginRoot, 'build.mjs')], pluginRoot);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const { packageResult, presetResult, patchResult } = await runInstallTransaction({
    installPackage: () => ensurePackage(options, profileDir),
    installPreset: () => copyPresetWithoutOverwrite(presetDestination),
    writePatch: () => atomicWriteWithBackup(profilePatchPath, nextPatch, stamp, currentPatch),
    packageAppeared: async () => !packageExistedBefore && await packagePresent(profileDir),
    rollbackPackage: async () => {
      await removeInstalledPackage(options);
      if (await packagePresent(profileDir)) throw new Error('remove 后 package 仍在 profile manifest');
    },
    rollbackPreset: async () => {
      if (!existsSync(presetDestination)) return;
      if (!await sameTree(presetSource, presetDestination)) throw new Error('新建 preset 已发生外部修改，未删除');
      await rm(presetDestination, { recursive: true });
    },
  });
  const verify = await liveVerify(options);
  console.log(JSON.stringify({
    mode: 'apply',
    package: packageResult,
    preset: presetResult,
    profilePatch: patchResult,
    verify,
    restartRequired: !verify.verified,
    next: verify.verified
      ? `打开 ${new URL('/ds-hub/', options.dshUrl)}`
      : '重启 DSH Web，再运行本脚本 --verify-only；只有 verified=true 才代表入口和安全 preset 均已观测健康',
  }, null, 2));
  if (!verify.verified) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`DS Hub 安装失败：${error.message}`);
    process.exitCode = 1;
  });
}

export const __test = { atomicWriteWithBackup, childEnv, preflightPreset, replaceInstallBlock, sameTree };
