import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDemoRoot = dirname(here);
const defaultPublicRoot = join(here, 'public');

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`DS Hub build 拒绝非普通源文件：${path}`);
  }
}

function assertPublicTarget(pluginRoot, publicRoot) {
  if (dirname(publicRoot) !== pluginRoot || basename(publicRoot) !== 'public') {
    throw new Error(`DS Hub build 只允许重建插件根目录下的 public：${publicRoot}`);
  }
}

async function buildTree(targetRoot, demoRoot) {
  await mkdir(join(targetRoot, 'assets'), { recursive: true, mode: 0o700 });

  const indexPath = join(demoRoot, 'index.html');
  await regularFile(indexPath);
  let index = await readFile(indexPath, 'utf8');
  const appMarker = '<script src="app.js"></script>';
  if (!index.includes(appMarker)) throw new Error(`Missing ${appMarker} in ${indexPath}`);
  if (!index.includes('<script src="dsh-live-adapter.js"></script>')) {
    index = index.replace(appMarker, `<script src="dsh-live-adapter.js"></script>\n${appMarker}`);
  }
  await writeFile(join(targetRoot, 'index.html'), index);

  for (const file of ['app.js', 'dsh-snapshot.js']) {
    const source = join(demoRoot, file);
    await regularFile(source);
    await copyFile(source, join(targetRoot, file));
  }
  const adapterSource = join(demoRoot, 'bridge', 'dsh-live-adapter.js');
  await regularFile(adapterSource);
  await copyFile(adapterSource, join(targetRoot, 'dsh-live-adapter.js'));
  for (const asset of ['dsh-icon.svg', 'ds-mecha-girl.png']) {
    const source = join(demoRoot, 'assets', asset);
    await regularFile(source);
    await copyFile(source, join(targetRoot, 'assets', asset));
  }
}

export async function buildPublic(options = {}) {
  const pluginRoot = resolve(options.pluginRoot || here);
  const demoRoot = resolve(options.demoRoot || defaultDemoRoot);
  const publicRoot = resolve(options.publicRoot || defaultPublicRoot);
  assertPublicTarget(pluginRoot, publicRoot);

  const existing = await lstat(publicRoot).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error(`DS Hub build 拒绝替换 public 符号链接：${publicRoot}`);
  if (existing && !existing.isDirectory()) throw new Error(`DS Hub build 的 public 目标不是目录：${publicRoot}`);

  const token = randomUUID();
  const temporary = join(pluginRoot, `.ds-hub-public-${token}.tmp`);
  const previous = join(pluginRoot, `.ds-hub-public-previous-${token}.tmp`);
  let previousMoved = false;
  try {
    await mkdir(temporary, { mode: 0o700 });
    await buildTree(temporary, demoRoot);
    if (existing) {
      await rename(publicRoot, previous);
      previousMoved = true;
    }
    try {
      await rename(temporary, publicRoot);
    } catch (error) {
      if (previousMoved) await rename(previous, publicRoot).catch(() => undefined);
      throw error;
    }
    if (previousMoved) await rm(previous, { recursive: true, force: true });
    return publicRoot;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const publicRoot = await buildPublic();
  console.log(`DS Hub plugin public files built at ${publicRoot}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`DS Hub build failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export const __test = { assertPublicTarget, regularFile };
