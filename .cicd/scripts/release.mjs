import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assert, auditTarball, clean, compareVersions, digest, feature, git, json, names, packages, registry, releaseIdentity, remoteTag, repository, run, runtimeVersionFile, toolchain, validateTag, validateVersion, versions, writeJSON } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [command, ...args] = process.argv.slice(2);
const usage = `Web SDK release tools (run via bash .cicd/<script>.sh):
  ci-prepare.sh <version>                 Update versions only; never commit/tag/push
  ci-check.sh [--skip-install]            Test, build, pack and test an isolated consumer
  ci-merge.sh [--push]                    Check pushed feature/codex branch; optionally FF develop/main
  cd-github-release.sh <version> [--artifacts <dir>] [--publish]
                                         Without --publish: build/verify artifacts only
  cd-npm-publish.sh <version> --artifacts <dir> [--tag <dist-tag>] [--publish]
                                         Without --publish: npm dry-run only

Requires Node >=22, pnpm@9.15.9, git, tar; publishing also needs npm/gh authentication.
Git tags omit v. Prereleases default to npm next, stable versions to latest.
External writes occur ONLY with --push or --publish. Artifacts go to .cicd/out/.`;

function parse() {
  const options = { version: undefined, artifacts: undefined, tag: undefined, push: false, publish: false, skipInstall: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--push') options.push = true;
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--skip-install') options.skipInstall = true;
    else if (arg === '--artifacts' || arg === '--tag') {
      assert(args[i + 1] && !args[i + 1].startsWith('--'), `${arg} requires a value`);
      options[arg.slice(2)] = args[++i];
    } else {
      assert(!arg.startsWith('-') && !options.version, `Unknown argument: ${arg}`);
      options.version = validateVersion(arg);
    }
  }
  assert(['prepare', 'check', 'merge', 'release', 'npm'].includes(command), usage);
  assert(!options.push || command === 'merge', '--push is only valid for ci-merge');
  assert(!options.publish || ['release', 'npm'].includes(command), '--publish is only valid for CD');
  assert(!options.skipInstall || command === 'check', '--skip-install is only valid for local checks');
  assert(!options.artifacts || ['release', 'npm'].includes(command), '--artifacts is only valid for CD');
  assert(!options.tag || command === 'npm', '--tag is only valid for npm');
  assert(['check', 'merge'].includes(command) ? !options.version : options.version, 'Unexpected or missing version');
  return options;
}

function prepare(version) {
  clean(root); feature(root); toolchain(root);
  assert(compareVersions(version, versions(root)) >= 0, 'Cannot prepare an older version');
  assert(!git(root, 'tag', '--list', version) && !remoteTag(root, version), 'Release tag already exists');
  for (const folder of ['.', ...packages]) {
    const path = resolve(root, folder, 'package.json');
    writeJSON(path, { ...json(path), version });
  }
  const runtimePath = join(root, runtimeVersionFile);
  const runtime = readFileSync(runtimePath, 'utf8');
  writeFileSync(runtimePath, runtime.replace(/export const XMAX_SDK_VERSION = "[^"]+";/, `export const XMAX_SDK_VERSION = "${version}";`));
  run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], root);
  versions(root, version);
  const notes = join(root, '.cicd/release-notes', `${version}.md`);
  if (!existsSync(notes)) cpSync(join(root, '.cicd/release-notes/TEMPLATE.md'), notes);
  git(root, 'diff', '--check');
  console.log(`Prepared ${version}. Fill in ${notes}; review, commit and push the branch yourself.`);
}

function consumer(source, artifacts, template = 'consumer') {
  const temporary = mkdtempSync(join(tmpdir(), 'xmax-web-consumer-'));
  try {
    cpSync(join(source, '.cicd', template), temporary, { recursive: true });
    const version = versions(source);
    cpSync(join(artifacts, `xmaxai-web-sdk-${version}.tgz`), join(temporary, 'sdk.tgz'));
    // A separate directory prevents workspace aliases/symlinks from hiding packaging defects.
    run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], temporary);
    run('pnpm', ['test'], temporary);
    run('pnpm', ['build'], temporary);
  } finally {
    // Only remove the exact disposable directory created by mkdtemp above.
    rmSync(temporary, { recursive: true, force: true });
  }
}

function check(source, output, skipInstall = false) {
  toolchain(source);
  const version = versions(source);
  if (!skipInstall) run('pnpm', ['install', '--frozen-lockfile'], source);
  run('node', ['--test', '.cicd/tests/release.test.mjs'], source);
  run('pnpm', ['--filter', '@xmaxai/web-sdk', 'test'], source);
  run('pnpm', ['--filter', '@xmaxai/web-sdk', 'exec', 'vitest', 'run', '--globals', '--root', '../../examples/xlab-react', 'tests'], source);
  // Build both entry points before validating the packed consumer.
  run('pnpm', ['build'], source);
  run('pnpm', ['typecheck'], source);
  run('pnpm', ['--filter', 'xlab-react', 'exec', 'tsc', '--noEmit'], source);
  run('pnpm', ['--filter', 'xlab-react', 'build'], source);
  for (const [i, folder] of packages.entries()) {
    run('pnpm', ['pack', '--pack-destination', output], join(source, folder));
    auditTarball(join(output, `${names[i].replace('@', '').replace('/', '-')}-${version}.tgz`), names[i], version);
  }
  consumer(source, output, 'consumer-core');
  consumer(source, output);
  git(source, 'diff', '--check');
}

function outputDirectory(prefix) {
  const parent = join(root, '.cicd/out');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, `${prefix}-`));
}

function merge(push) {
  clean(root);
  const branch = feature(root), commit = git(root, 'rev-parse', 'HEAD');
  // No force updates, even if a remote branch advances while tests are running.
  git(root, 'fetch', 'origin');
  assert(git(root, 'rev-parse', `refs/remotes/origin/${branch}`) === commit, 'Push your source branch before CI');
  for (const target of ['develop', 'main']) {
    git(root, 'merge-base', '--is-ancestor', `refs/remotes/origin/${target}`, commit);
  }
  const output = outputDirectory('check');
  check(root, output);
  clean(root);
  assert(git(root, 'rev-parse', 'HEAD') === commit, 'HEAD changed during CI');
  if (push) run('git', ['push', '--atomic', 'origin', `${commit}:refs/heads/develop`, `${commit}:refs/heads/main`], root);
  console.log(push ? 'Remote develop/main fast-forwarded. Local branches were not moved; use git merge --ff-only origin/main.' : 'Checks passed. No branches pushed; rerun with --push to synchronize develop/main.');
}

function buildRelease(version, commit) {
  const output = outputDirectory(`${version}-${commit.slice(0, 8)}`);
  const temporary = mkdtempSync(join(tmpdir(), 'xmax-web-release-'));
  const checkout = join(temporary, 'source');
  let added = false;
  try {
    git(root, 'worktree', 'add', '--detach', checkout, commit);
    added = true;
    versions(checkout, version);
    const notes = join(checkout, '.cicd/release-notes', `${version}.md`);
    const body = readFileSync(notes, 'utf8');
    assert(body.trim() && !body.includes('TODO'), 'Complete and commit release notes before tagging');
    check(checkout, output);
    clean(checkout); // Includes regenerated model weights and lockfile drift.
    cpSync(notes, join(output, 'release-notes.md'));
    const manifest = {
      schema: 1, version, commit, repository, checks: 'passed',
      notesIntegrity: `sha512-${digest(join(output, 'release-notes.md'))}`,
      packages: names.map((name) => {
        const file = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
        return { name, file, integrity: `sha512-${digest(join(output, file))}` };
      }),
    };
    writeJSON(join(output, 'release.json'), manifest);
    writeFileSync(join(output, 'SHA256SUMS'), [...manifest.packages.map((p) => p.file), 'release-notes.md', 'release.json'].map((file) => {
      const hex = Buffer.from(digest(join(output, file), 'sha256'), 'base64').toString('hex');
      return `${hex}  ${file}\n`;
    }).join(''));
    return output;
  } finally {
    if (added) {
      // This worktree is owned by this invocation; preserve it if unexpected tracked edits exist.
      try { git(root, 'worktree', 'remove', checkout); }
      catch (error) { console.error(`Temporary checkout retained for inspection: ${checkout}`); throw error; }
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyArtifacts(output, version, commit) {
  const manifest = json(join(output, 'release.json'));
  assert(manifest.schema === 1 && manifest.version === version && manifest.commit === commit && manifest.repository === repository && manifest.checks === 'passed', 'Artifact manifest does not match the verified release tag');
  assert(manifest.packages?.length === names.length, 'Expected one SDK artifact including the React entry point');
  names.forEach((name, i) => {
    const p = manifest.packages[i];
    assert(p.name === name && p.file === `${name.replace('@', '').replace('/', '-')}-${version}.tgz` && basename(p.file) === p.file, 'Unexpected artifact name');
    assert(p.integrity === `sha512-${digest(join(output, p.file))}`, 'Artifact checksum mismatch');
    auditTarball(join(output, p.file), name, version);
  });
  assert(manifest.notesIntegrity === `sha512-${digest(join(output, 'release-notes.md'))}`, 'Release notes checksum mismatch');
  const checksums = [...manifest.packages.map((p) => p.file), 'release-notes.md', 'release.json'].map((file) =>
    `${Buffer.from(digest(join(output, file), 'sha256'), 'base64').toString('hex')}  ${file}\n`).join('');
  assert(readFileSync(join(output, 'SHA256SUMS'), 'utf8') === checksums, 'SHA256SUMS mismatch');
  return manifest;
}

function publishGithub(version, artifacts, publish) {
  const commit = releaseIdentity(root, version);
  const output = artifacts ? resolve(artifacts) : buildRelease(version, commit);
  const manifest = verifyArtifacts(output, version, commit);
  console.log(`Verified release artifacts: ${output}`);
  if (!publish) { console.log('No GitHub/npm publication. Review artifacts and rerun with --artifacts <dir> --publish.'); return; }
  run('gh', ['auth', 'status'], root);
  releaseIdentity(root, version); // Recheck after a potentially long isolated build.
  run('gh', ['release', 'create', version,
    ...manifest.packages.map((p) => join(output, p.file)), join(output, 'SHA256SUMS'), join(output, 'release.json'),
    '--repo', repository, '--verify-tag', '--title', `XmaxSDK Web ${version}`, '--notes-file', join(output, 'release-notes.md'),
    ...(version.includes('-') ? ['--prerelease', '--latest=false'] : [])], root);
}

function registryIntegrity(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json', '--registry', registry], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 0) {
    const integrity = JSON.parse(result.stdout);
    assert(typeof integrity === 'string' && integrity, 'Registry did not return an integrity hash');
    return integrity;
  }
  let error;
  try { error = JSON.parse(result.stdout).error; } catch { /* Non-JSON failures are not absence. */ }
  assert(error?.code === 'E404', `Cannot check ${name}@${version}; registry/auth/network failure. ${result.stderr}`);
  return undefined;
}

function publishNpm(version, artifacts, tag, publish) {
  assert(artifacts, '--artifacts is required; first build the tagged release with cd-github-release.sh');
  tag ??= version.includes('-') ? 'next' : 'latest';
  validateTag(version, tag);
  const commit = releaseIdentity(root, version), output = resolve(artifacts);
  const manifest = verifyArtifacts(output, version, commit);
  if (!publish) {
    for (const p of manifest.packages) run('npm', ['publish', join(output, p.file), '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', tag, '--registry', registry], root);
    console.log('npm dry-run complete. No package published. Authentication/ownership are not guaranteed by dry-run.');
    return;
  }
  run('npm', ['whoami', '--registry', registry], root);
  // Check the registry before external writes; identical versions support safe retries.
  const existing = manifest.packages.map((p) => {
    const integrity = registryIntegrity(p.name, version);
    assert(!integrity || integrity === p.integrity, `${p.name}@${version} exists with different bytes; use a new version`);
    return !!integrity;
  });
  for (const [i, p] of manifest.packages.entries()) {
    if (existing[i]) { console.log(`${p.name}@${version} already published with identical bytes; skipping (dist-tag unchanged).`); continue; }
    run('npm', ['publish', join(output, p.file), '--ignore-scripts', '--access', 'public', '--tag', tag, '--registry', registry], root);
    assert(registryIntegrity(p.name, version) === p.integrity, 'Published integrity not yet confirmed; preserve artifacts and retry after checking registry');
  }
  console.log(`Published SDK with tag ${tag}. No GitHub release, branch or Git tag was modified.`);
}

try {
  if (args.includes('--help') || args.includes('-h')) console.log(usage);
  else {
    const options = parse();
    if (command === 'prepare') prepare(options.version);
    if (command === 'check') {
      const output = outputDirectory('check');
      check(root, output, options.skipInstall);
      console.log(`CI passed; candidate archives (not tagged release artifacts): ${output}`);
    }
    if (command === 'merge') merge(options.push);
    if (command === 'release') publishGithub(options.version, options.artifacts, options.publish);
    if (command === 'npm') publishNpm(options.version, options.artifacts, options.tag, options.publish);
  }
} catch (error) {
  console.error(`Release stopped: ${error.message}`);
  process.exitCode = 1;
}
