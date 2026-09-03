import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPublic } from '../build.mjs';

async function makeFixture(root) {
  const demoRoot = join(root, 'demo');
  const pluginRoot = join(root, 'plugin');
  await mkdir(join(demoRoot, 'bridge'), { recursive: true });
  await mkdir(join(demoRoot, 'assets'), { recursive: true });
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(demoRoot, 'index.html'), '<body><script src="app.js"></script></body>\n');
  await writeFile(join(demoRoot, 'app.js'), 'window.app = true;\n');
  await writeFile(join(demoRoot, 'dsh-snapshot.js'), 'window.DSH_SNAPSHOT = {};\n');
  await writeFile(join(demoRoot, 'bridge', 'dsh-live-adapter.js'), 'window.adapter = true;\n');
  await writeFile(join(demoRoot, 'assets', 'dsh-icon.svg'), '<svg/>\n');
  await writeFile(join(demoRoot, 'assets', 'ds-mecha-girl.png'), 'png-fixture\n');
  return { demoRoot, pluginRoot, publicRoot: join(pluginRoot, 'public') };
}

async function treeSnapshot(root, relative = '') {
  const rows = [];
  const items = await readdir(join(root, relative), { withFileTypes: true });
  for (const item of items.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(relative, item.name);
    if (item.isDirectory()) rows.push(...await treeSnapshot(root, child));
    else {
      assert.equal(item.isSymbolicLink(), false);
      rows.push([child, await readFile(join(root, child), 'utf8')]);
    }
  }
  return rows;
}

test('build atomically replaces stale public contents with reproducible fixed output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-build-test-'));
  const fixture = await makeFixture(root);
  await buildPublic(fixture);
  const first = await treeSnapshot(fixture.publicRoot);
  const outside = join(root, 'outside.txt');
  await writeFile(outside, 'keep\n');
  await writeFile(join(fixture.publicRoot, 'stale.txt'), 'stale\n');
  await symlink(outside, join(fixture.publicRoot, 'stale-link'));
  await buildPublic(fixture);
  const second = await treeSnapshot(fixture.publicRoot);
  assert.deepEqual(second, first);
  assert.equal(await readFile(outside, 'utf8'), 'keep\n');
  assert.match((await readFile(join(fixture.publicRoot, 'index.html'), 'utf8')), /dsh-live-adapter\.js/);
  await rm(root, { recursive: true, force: true });
});

test('build refuses a public root symlink and never touches its target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-hub-build-test-'));
  const fixture = await makeFixture(root);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'sentinel.txt'), 'keep\n');
  await symlink(outside, fixture.publicRoot);
  await assert.rejects(buildPublic(fixture), /拒绝替换 public 符号链接/);
  assert.equal((await lstat(fixture.publicRoot)).isSymbolicLink(), true);
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'keep\n');
  await rm(root, { recursive: true, force: true });
});
