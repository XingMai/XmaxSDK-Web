import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditTarball, compareVersions, run, validateTag, validateVersion, versions, writeJSON } from '../scripts/lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('release versions accept stable/prerelease SemVer but reject unsafe or ambiguous names', () => {
  for (const version of ['0.1.0', '1.2.3-rc.1', '2.0.0-beta-foo.0']) assert.equal(validateVersion(version), version);
  for (const version of ['', 'v1.0.0', '01.0.0', '1.0', '1.0.0+build', '1.0.0-01', '../1.0.0', '1.0.0\n', '--publish']) {
    assert.throws(() => validateVersion(version));
  }
});
test('version order includes numeric prerelease identifiers and stable promotion', () => {
  for (const [a, b] of [['1.0.0', '0.99.99'], ['1.0.0', '1.0.0-rc.1'], ['1.0.0-rc.10', '1.0.0-rc.2'], ['1.0.0-beta', '1.0.0-alpha'], ['1.0.0-alpha.1', '1.0.0-alpha']]) {
    assert.equal(compareVersions(a, b), 1);
    assert.equal(compareVersions(b, a), -1);
    assert.equal(compareVersions(a, a), 0);
  }
});
test('prereleases cannot accidentally update latest', () => {
  validateTag('1.0.0', 'latest'); validateTag('1.0.0-rc.1', 'next');
  assert.throws(() => validateTag('1.0.0-rc.1', 'latest'));
  assert.throws(() => validateTag('1.0.0', '../latest'));
});
test('workspace package versions stay synchronized', () => {
  assert.ok(versions(root));
  assert.throws(() => versions(root, '999999.0.0'));
});
test('help and invalid flags never require credentials or execute release operations', () => {
  for (const command of ['prepare', 'check', 'merge', 'release', 'npm']) {
    const result = spawnSync(process.execPath, [resolve(root, '.cicd/scripts/release.mjs'), command, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /External writes occur ONLY/);
  }
  for (const args of [['check', '--publish'], ['release', '1.0.0', '--push'], ['npm', '1.0.0', '--tag'], ['prepare', 'v1.0.0']]) {
    const result = spawnSync(process.execPath, [resolve(root, '.cicd/scripts/release.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
  }
});
test('tarball audit rejects workspace dependency leaks and missing artifacts', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'xmax-release-test-'));
  try {
    const pkg = join(temporary, 'package');
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    mkdirSync(join(pkg, 'dist/react'));
    for (const entry of ['', 'react/']) {
      for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) writeFileSync(join(pkg, 'dist', entry, file), '// fixture\n');
    }
    cpSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));
    const manifest = JSON.parse(readFileSync(join(root, 'packages/xmax-sdk/package.json'), 'utf8'));
    manifest.version = '1.0.0';
    const archive = join(temporary, 'sdk.tgz');
    const pack = () => run('tar', ['-czf', archive, 'package/package.json', 'package/dist', 'package/LICENSE'], temporary, true);
    writeJSON(join(pkg, 'package.json'), manifest); pack();
    auditTarball(archive, '@xmaxai/web-sdk', '1.0.0');
    manifest.license = 'UNLICENSED';
    writeJSON(join(pkg, 'package.json'), manifest); pack();
    assert.throws(() => auditTarball(archive, '@xmaxai/web-sdk', '1.0.0'), /license metadata/);
    manifest.license = 'MIT';
    writeJSON(join(pkg, 'package.json'), manifest);
    writeFileSync(join(pkg, 'LICENSE'), 'incomplete license'); pack();
    assert.throws(() => auditTarball(archive, '@xmaxai/web-sdk', '1.0.0'), /LICENSE must match/);
    cpSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));
    manifest.dependencies.framegen = 'workspace:*';
    writeJSON(join(pkg, 'package.json'), manifest); pack();
    assert.throws(() => auditTarball(archive, '@xmaxai/web-sdk', '1.0.0'), /workspace/);
    manifest.dependencies.framegen = '1.4.0';
    manifest.peerDependenciesMeta.react.optional = false;
    writeJSON(join(pkg, 'package.json'), manifest); pack();
    assert.throws(() => auditTarball(archive, '@xmaxai/web-sdk', '1.0.0'), /optional peer/);
    manifest.peerDependenciesMeta.react.optional = true;
    writeJSON(join(pkg, 'package.json'), manifest);
    rmSync(join(pkg, 'dist/react/index.cjs')); pack();
    assert.throws(() => auditTarball(archive, '@xmaxai/web-sdk', '1.0.0'), /missing/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

// Real disposable Git repositories + a stub package manager. No network or real publication.
function withRepository(callback) {
  const temporary = mkdtempSync(join(tmpdir(), 'xmax-release-git-test-'));
  try {
    const source = join(temporary, 'source'), remote = join(temporary, 'remote.git'), bin = join(temporary, 'bin');
    mkdirSync(source); mkdirSync(bin);
    cpSync(resolve(root, '.cicd/scripts'), join(source, '.cicd/scripts'), { recursive: true });
    mkdirSync(join(source, '.cicd/release-notes'), { recursive: true });
    writeFileSync(join(source, '.cicd/release-notes/TEMPLATE.md'), '## What\'s New\n\nTODO\n\n## API Changes\n');
    mkdirSync(join(source, '.cicd/tests'));
    writeFileSync(join(source, '.cicd/tests/release.test.mjs'), '// Control-flow fixture only\n');
    writeFileSync(join(source, '.gitignore'), '.cicd/out/\n');
    writeJSON(join(source, 'package.json'), { private: true, version: '0.1.0', packageManager: 'pnpm@9.15.9' });
    mkdirSync(join(source, 'packages/xmax-sdk/src/Foundation/Runtime'), { recursive: true });
    writeFileSync(join(source, 'packages/xmax-sdk/src/Foundation/Runtime/RuntimeInfo.ts'), 'export const XMAX_SDK_VERSION = "0.1.0";\n');
    for (const [folder, name] of [['xmax-sdk', '@xmaxai/web-sdk']]) {
      mkdirSync(join(source, 'packages', folder), { recursive: true });
      writeJSON(join(source, 'packages', folder, 'package.json'), { name, version: '0.1.0', dependencies: {} });
    }
    const git = (...args) => run('git', args, source, true);
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'CI Test'); git('config', 'user.email', 'ci-test@example.invalid');
    git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');
    git('add', '.'); git('commit', '-m', 'fixture');
    git('remote', 'add', 'origin', remote);
    git('push', 'origin', 'main', 'main:develop');
    git('switch', '-c', 'codex/test');
    writeFileSync(join(source, 'feature.txt'), 'new feature\n');
    git('add', '.'); git('commit', '-m', 'feature'); git('push', '-u', 'origin', 'codex/test');
    const pnpm = join(bin, 'pnpm');
    writeFileSync(pnpm, '#!/usr/bin/env node\nif(process.argv[2] === "--version") console.log("9.15.9"); else if(process.argv[2] !== "install") process.exit(23);\n');
    chmodSync(pnpm, 0o755);
    const cli = (...args) => spawnSync(process.execPath, [join(source, '.cicd/scripts/release.mjs'), ...args], {
      cwd: source, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    callback({ source, git, cli });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

test('prepare synchronizes versions without committing, tagging or pushing; dirty reruns stop', () => {
  withRepository(({ source, git, cli }) => {
    const head = git('rev-parse', 'HEAD'), remote = git('ls-remote', 'origin');
    const result = cli('prepare', '0.2.0-rc.1');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(versions(source), '0.2.0-rc.1');
    assert.match(readFileSync(join(source, '.cicd/release-notes/0.2.0-rc.1.md'), 'utf8'), /TODO/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('ls-remote', 'origin'), remote);
    assert.equal(git('tag', '--list'), '');
    assert.notEqual(cli('prepare', '0.3.0').status, 0);
    assert.equal(versions(source), '0.2.0-rc.1');
  });
});
test('failed CI never pushes develop/main, including with explicit --push', () => {
  withRepository(({ git, cli }) => {
    const before = git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/develop');
    const result = cli('merge', '--push');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pnpm .* failed/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/develop'), before);
  });
});
test('CD rejects a missing release tag and missing artifacts before publishing', () => {
  withRepository(({ git, cli }) => {
    git('switch', 'main');
    const result = cli('release', '0.1.0', '--publish');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refs\/tags/);
    assert.equal(cli('npm', '0.1.0', '--publish').status, 1);
    assert.equal(git('tag', '--list'), '');
  });
});
