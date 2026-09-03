import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoaderManagement } from './loader-management.js';
import { createSettingsManagement } from './settings-management.js';

export const name = 'ds-hub';
export const inject = ['webServer', 'loader', 'apiProxy'];

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const EXPECTED_ASSISTANT_PRESET_CONTENT = await readFile(new URL('../preset/ds-hub-assistant/agent.cordis.yml', import.meta.url), 'utf8');
const EXPECTED_ASSISTANT_PRESET_DIGEST = `sha256:${createHash('sha256').update(EXPECTED_ASSISTANT_PRESET_CONTENT).digest('hex')}`;
const STATIC_MISS_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR']);
const STATIC_FILES = new Set([
  'index.html',
  'app.js',
  'dsh-snapshot.js',
  'dsh-live-adapter.js',
  'assets/dsh-icon.svg',
  'assets/ds-mecha-girl.png',
]);
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
});

function validPresetId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function securityHeaders(contentType, cacheControl = 'no-store') {
  return {
    'content-type': contentType,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  };
}

function runtimeConfigScript(config) {
  const json = JSON.stringify({
    assistantPreset: config.assistantPreset,
    assistantPresetDigest: EXPECTED_ASSISTANT_PRESET_DIGEST,
    apiPrefix: '/api',
  }).replaceAll('<', '\\u003c');
  return `<script>window.__DS_HUB_RUNTIME_CONFIG__=${json};</script>`;
}

function jsonResponse(res, status, payload, method = 'GET') {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'content-length': String(body.length),
  });
  if (method === 'HEAD') res.end();
  else res.end(body);
}

function publicError(error) {
  return {
    code: String(error?.code || 'bridge-error'),
    message: String(error?.message || 'DS Hub 本机桥未完成请求'),
    state: String(error?.state || 'unchanged'),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}

function loopbackRequest(req) {
  const host = String(req.headers.host || '');
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname)) return false;
  const fetchSite = String(req.headers['sec-fetch-site'] || '');
  if (fetchSite === 'cross-site') return false;
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(req, limit = 16_384) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw Object.assign(new Error('请求必须使用 application/json'), { code: 'invalid-content-type' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体超过本机桥限制'), { code: 'body-too-large' });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是有效 JSON'), { code: 'invalid-json' });
  }
}

function injectRuntimeConfig(html, config) {
  const marker = '<script src="dsh-live-adapter.js"></script>';
  if (!html.includes(marker)) throw new Error('ds-hub: built index is missing dsh-live-adapter.js');
  return html.replace(marker, `${runtimeConfigScript(config)}\n${marker}`);
}

async function serveFile(req, res, rootDir, config) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/ds-hub') {
    res.writeHead(308, { location: '/ds-hub/' });
    res.end();
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname.slice('/ds-hub/'.length)) || 'index.html';
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (!STATIC_FILES.has(relative)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const target = resolve(normalize(join(rootDir, relative)));
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const [realRoot, targetInfo, realTarget] = await Promise.all([
      realpath(rootDir),
      lstat(target),
      realpath(target),
    ]);
    if (targetInfo.isSymbolicLink() || (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep))) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body = await readFile(target);
    const extension = extname(target).toLowerCase();
    if (target === join(rootDir, 'index.html')) {
      body = Buffer.from(injectRuntimeConfig(body.toString('utf8'), config));
    }
    const cacheControl = extension === '.png' || extension === '.svg'
      ? 'private, max-age=3600'
      : 'no-store';
    res.writeHead(200, securityHeaders(MIME[extension] || 'application/octet-stream', cacheControl));
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch (error) {
    if (!STATIC_MISS_CODES.has(error?.code)) throw error;
    res.writeHead(404);
    res.end();
  }
}

function managementErrorStatus(error) {
  if (error?.code === 'revision-conflict' || error?.code === 'state-conflict' || error?.code === 'idempotency-conflict'
    || error?.code === 'preset-roster-conflict') return 409;
  if (error?.code === 'entry-not-found' || error?.code === 'target-unavailable') return 404;
  if (error?.code === 'unsupported-target') return 422;
  if (error?.code === 'state-unknown') return 503;
  return 400;
}

async function serveManagement(req, res, config, loaderManagement, settingsManagement) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (!loopbackRequest(req)) {
    jsonResponse(res, 403, { ok: false, error: { code: 'origin-denied', message: '只接受 DSH loopback 同源请求', state: 'unchanged' } }, req.method);
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD')
    && (url.pathname === '/ds-hub-api/capabilities' || url.pathname === '/ds-hub-api/health')) {
    const payload = url.pathname.endsWith('/health')
      ? { ok: true, service: 'dsh-ds-hub', apiVersion: 1 }
      : {
        ok: true,
        apiVersion: 1,
        assistant: {
          available: true,
          transport: 'same-origin-dsh-session',
          preset: config.assistantPreset,
          presetDigest: EXPECTED_ASSISTANT_PRESET_DIGEST,
          credentials: 'host-only',
        },
        pluginManagement: {
          inventoryRead: true,
          loaderMutation: loaderManagement.configured,
          mutableEntries: loaderManagement.configured ? loaderManagement.mutableEntries() : [],
          scope: 'web-profile-root-loader-entry',
          presetMutation: false,
          packageInstall: false,
          ...(loaderManagement.configured ? {} : { reason: 'host entry 未配置绝对 profilePatchPath' }),
        },
        configManagement: {
          settingsMutation: settingsManagement.configured,
          targets: [...settingsManagement.supportedTargets],
          expectedRevisionCAS: true,
          independentReadback: true,
          isolatedComparison: false,
          onlineObservation: false,
          ...(settingsManagement.configured ? {} : { reason: 'Host apiProxy settings 服务未连接' }),
        },
      };
    jsonResponse(res, 200, payload, req.method);
    return;
  }
  if (req.method === 'POST'
    && (url.pathname === '/ds-hub-api/loader/preflight' || url.pathname === '/ds-hub-api/loader/set-enabled')) {
    try {
      const request = await readJsonBody(req);
      const result = url.pathname.endsWith('/preflight')
        ? await loaderManagement.preflight(request)
        : await loaderManagement.setEnabled(request);
      jsonResponse(res, 200, result, req.method);
    } catch (error) {
      jsonResponse(res, managementErrorStatus(error), { ok: false, error: publicError(error) }, req.method);
    }
    return;
  }
  if (req.method === 'POST' && [
    '/ds-hub-api/config/preflight',
    '/ds-hub-api/config/apply',
    '/ds-hub-api/config/readback',
  ].includes(url.pathname)) {
    try {
      const request = await readJsonBody(req);
      const method = url.pathname.slice('/ds-hub-api/config/'.length);
      const result = await settingsManagement[method](request);
      jsonResponse(res, 200, result, req.method);
    } catch (error) {
      jsonResponse(res, managementErrorStatus(error), { ok: false, error: publicError(error) }, req.method);
    }
    return;
  }
  res.writeHead(405, { allow: 'GET, HEAD, POST' });
  res.end();
}

export function apply(ctx, rawConfig = {}) {
  const assistantPreset = String(rawConfig.assistantPreset || 'ds-hub-assistant').trim();
  if (!validPresetId(assistantPreset)) throw new Error('ds-hub: assistantPreset is invalid');
  const rootDir = resolve(String(rawConfig.rootDir || DEFAULT_PUBLIC_ROOT));
  const profilePatchPath = String(rawConfig.profilePatchPath || '').trim();
  const presetMappingPath = String(rawConfig.presetMappingPath || '').trim();
  const config = { assistantPreset, profilePatchPath, presetMappingPath };
  const loaderManagement = createLoaderManagement(ctx, config);
  const settingsManagement = createSettingsManagement(ctx.apiProxy, config);

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ds-hub',
    handler: (req, res) => serveFile(req, res, rootDir, config),
  }), 'ds-hub: static route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ds-hub-api',
    handler: (req, res) => serveManagement(req, res, config, loaderManagement, settingsManagement),
  }), 'ds-hub: controlled API route');
}

export const __test = {
  EXPECTED_ASSISTANT_PRESET_DIGEST,
  STATIC_FILES,
  injectRuntimeConfig,
  securityHeaders,
  loopbackRequest,
  readJsonBody,
  serveFile,
  serveManagement,
  managementErrorStatus,
};
