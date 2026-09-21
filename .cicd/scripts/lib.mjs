import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const packages = ['packages/xmax-sdk'];
export const names = ['@xmaxai/web-sdk'];
export const registry = 'https://registry.npmjs.org/';
export const repository = 'XingMai/XmaxSDK-Web';
export const runtimeVersionFile = 'packages/xmax-sdk/src/Foundation/Runtime/RuntimeInfo.ts';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `${command} ${args.join(' ')} failed${capture ? `: ${result.stderr || result.stdout}` : ''}`);
  return capture ? result.stdout.trim() : '';
}
export const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const writeJSON = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
export const git = (cwd, ...args) => run('git', args, cwd, true);
export const digest = (path, algorithm = 'sha512') => createHash(algorithm).update(readFileSync(path)).digest('base64');

// Release tags deliberately omit "v" and build metadata: npm versions cannot distinguish builds.
export function validateVersion(version) {
  assert(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(version), 'Expected SemVer without v or +build metadata');
  const pre = version.split('-').slice(1).join('-');
  assert(!pre || pre.split('.').every((part) => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')), 'Numeric prerelease identifiers cannot have leading zeros');
  return version;
}
export function compareVersions(a, b) {
  validateVersion(a); validateVersion(b);
  const parts = (v) => { const i = v.indexOf('-'); return [v.split('-')[0].split('.').map(BigInt), i < 0 ? [] : v.slice(i + 1).split('.')]; };
  const [ac, ap] = parts(a), [bc, bp] = parts(b);
  for (let i = 0; i < 3; i++) if (ac[i] !== bc[i]) return ac[i] > bc[i] ? 1 : -1;
  if (!ap.length || !bp.length) return ap.length === bp.length ? 0 : ap.length ? -1 : 1;
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) return BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}
export function validateTag(version, tag) {
  validateVersion(version);
  assert(/^[a-z][a-z0-9-]*$/.test(tag), 'Invalid npm dist-tag');
  assert(!version.includes('-') || tag !== 'latest', 'Prereleases must not use the latest dist-tag');
}
export function versions(root, expected) {
  const manifests = ['package.json', ...packages.map((p) => `${p}/package.json`)].map((p) => json(resolve(root, p)));
  const version = validateVersion(expected ?? manifests[0].version);
  assert(manifests.every((p) => p.version === version), 'Root and SDK versions must match');
  const runtimeVersion = readFileSync(resolve(root, runtimeVersionFile), 'utf8').match(/export const XMAX_SDK_VERSION = "([^"]+)";/)?.[1];
  assert(runtimeVersion === version, 'RuntimeInfo SDK version must match the package version');
  assert(manifests[0].private === true, 'Workspace root must remain private');
  names.forEach((name, i) => assert(manifests[i + 1].name === name && !manifests[i + 1].private, `Invalid release package: ${name}`));
  return version;
}
export function toolchain(root) {
  assert(Number(process.versions.node.split('.')[0]) >= 22, 'CI/CD requires Node.js 22 or newer (SDK runtime requirement is unchanged)');
  const expected = json(resolve(root, 'package.json')).packageManager;
  const actual = run('pnpm', ['--version'], root, true);
  assert(`pnpm@${actual}` === expected, `Use ${expected}; found pnpm@${actual}. Enable Corepack or install the pinned pnpm.`);
}
export function clean(root) {
  assert(!git(root, 'status', '--porcelain'), 'Working tree must be clean; commit all source, scripts and release notes first');
}
export function feature(root) {
  const branch = git(root, 'branch', '--show-current');
  assert(/^(feature|codex)\/.+/.test(branch), 'Run from a feature/* or codex/* branch');
  return branch;
}
export function remoteTag(root, version) {
  const lines = git(root, 'ls-remote', 'origin', `refs/tags/${version}`, `refs/tags/${version}^{}`).split('\n').filter(Boolean);
  return (lines.find((line) => line.endsWith('^{}')) ?? lines[0])?.split(/\s+/)[0];
}
export function releaseIdentity(root, version) {
  validateVersion(version); clean(root); versions(root, version);
  assert(git(root, 'branch', '--show-current') === 'main', 'Release must run from main');
  const commit = git(root, 'rev-parse', 'HEAD');
  const remoteMain = git(root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
  assert(commit === remoteMain, 'Local main must equal origin/main');
  assert(git(root, 'rev-parse', `refs/tags/${version}^{commit}`) === commit, 'Local release tag must point to main');
  assert(remoteTag(root, version) === commit, 'Remote release tag must point to main');
  return commit;
}
export function auditTarball(file, name, version) {
  const entries = run('tar', ['-tzf', file], undefined, true).split('\n');
  assert(entries.every((entry) => entry.startsWith('package/') && !entry.split('/').includes('..')), 'Unexpected tarball path');
  const manifest = JSON.parse(run('tar', ['-xOf', file, 'package/package.json'], undefined, true));
  assert(manifest.name === name && manifest.version === version && !manifest.private, 'Tarball identity mismatch');
  assert(!/(workspace:|file:|link:)/.test(JSON.stringify([manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies])), 'Packed dependencies must not reference the workspace');
  for (const path of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'dist/index.d.cts', 'dist/react/index.js', 'dist/react/index.cjs', 'dist/react/index.d.ts', 'dist/react/index.d.cts']) {
    assert(entries.includes(`package/${path}`), `Tarball missing ${path}`);
  }
  assert(entries.every((entry) => /^package\/(?:dist\/|package\.json$|README(?:\.md)?$|LICENSE(?:\.md)?$)/i.test(entry)), 'Unexpected source, credential or tooling file in tarball');
  assert(manifest.license === 'MIT', 'SDK license metadata must be MIT');
  assert(entries.includes('package/LICENSE'), 'SDK LICENSE is missing');
  const license = run('tar', ['-xOf', file, 'package/LICENSE'], undefined, true);
  const expectedLicense = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8').trim();
  assert(license === expectedLicense, 'Packed LICENSE must match the repository LICENSE');
  if (name === '@xmaxai/web-sdk') {
    assert(manifest.dependencies?.framegen === '1.4.0', 'Framegen dependency must be pinned');
  }
  assert(manifest.peerDependencies?.react && manifest.peerDependenciesMeta?.react?.optional === true, 'React must remain an optional peer dependency');
  assert(!manifest.dependencies?.react && !manifest.dependencies?.['react-dom'], 'Core must not depend on React');
  for (const [entry, directory] of [['.', 'dist'], ['./react', 'dist/react']]) {
    for (const [condition, extension] of [['types', 'd.ts'], ['import', 'js'], ['require', 'cjs']]) {
      assert(manifest.exports?.[entry]?.[condition] === `./${directory}/index.${extension}`, `Invalid ${entry} ${condition} export`);
    }
  }
  return manifest;
}
