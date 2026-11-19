// Builds the hosted study release into release-output/<id>/.
// Usage: npm run release:build -- <id> [--candidate]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ROUTE, REPOSITORY, SLUG, releaseTarget, studyEntryHtml } from './target.mjs';
import {
  LIMITS,
  NATIVE_ENTRY,
  archiveName,
  checksumsText,
  gzip,
  inventory,
  loadPackage,
  makeTar,
  measure,
  readTree,
  sha256,
  validateRuntime,
} from './package.mjs';

assert.equal(process.versions.node.split('.')[0], '22', 'Node 22 is required');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.chdir(root);

const [id, ...flags] = process.argv.slice(2);
assert(id, 'Usage: npm run release:build -- <id> [--candidate]');
assert(flags.every((flag) => flag === '--candidate'), 'Unknown build argument');
const candidate = flags.includes('--candidate');
const target = releaseTarget(id);

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Commit, branch, status and a digest over tracked plus untracked-not-ignored files. */
function sourceSnapshot() {
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const paths = listed.split('\0').filter(Boolean).sort();
  const files = paths.map((path) => {
    assert(!/(^|\/)(\.env[^/]*|credentials)(\/|$)/.test(path), `Private file cannot be a release input: ${path}`);
    assert(lstatSync(path).isFile(), `Source links/special files rejected: ${path}`);
    return { path, sha256: sha256(readFileSync(path)) };
  });
  return {
    repository: REPOSITORY,
    commit: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    dirty: status.length > 0,
    status: status ? status.split('\n') : [],
    treeSha256: sha256(JSON.stringify(files)),
  };
}

assert.equal(git('remote', 'get-url', 'origin').replace(/\.git$/, ''), REPOSITORY, 'Unexpected origin remote');
const source = sourceSnapshot();
assert(!source.dirty || candidate, 'Source is dirty: commit reviewed work first, or explicitly use --candidate');

const out = join(root, 'release-output', id);
mkdirSync(join(root, 'release-output'), { recursive: true });
mkdirSync(out); // Fails if the folder exists: a release ID is never reused or overwritten.
const evidence = join(out, 'evidence');
mkdirSync(evidence);
const buildDir = join(out, 'build');

// Each command's output is saved as evidence/<n>-<log>.log.
const commands = [
  { log: 'ci', args: ['ci'] },
  { log: 'test', args: ['test', '--', '--watch=false'] },
  { log: 'test-release', args: ['run', 'test:release'] },
  { log: 'build-study', args: ['run', 'build', '--', '--configuration', 'study', '--deploy-url', target.assetBase, '--output-path', relative(root, buildDir)] },
];
for (const [index, { log, args }] of commands.entries()) {
  console.log(`npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(evidence, `${index + 1}-${log}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  assert.equal(result.status, 0, `npm ${args.join(' ')} failed; see ${evidence}`);
}
assert.deepEqual(sourceSnapshot(), source, 'Source changed during the build; review it and use a new release ID');

// Angular writes the browser files to <output-path>/browser; the licence text beside it is not served.
const built = readTree(join(buildDir, 'browser'));
const index = built.get('index.html');
assert(index, 'Built index.html missing');
built.delete('index.html');
built.set(NATIVE_ENTRY, Buffer.from(studyEntryHtml(index.toString('utf8'), target)));

const files = inventory(built);
const archive = gzip(makeTar(built));
const archiveFile = archiveName(id);
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const steps = commands.map(({ args }) => `npm ${args.join(' ')}`);

const manifest = {
  schemaVersion: 1,
  slug: SLUG,
  ...target,
  nativeEntry: NATIVE_ENTRY,
  publicRoute: PUBLIC_ROUTE,
  source,
  publicationEligible: !source.dirty,
  build: {
    node: process.version,
    npm: npmVersion,
    lockSha256: sha256(readFileSync('package-lock.json')),
    command: `npm run release:build -- ${id}${candidate ? ' --candidate' : ''}`,
    steps,
    environment: { releaseId: id, assetBase: target.assetBase, canonicalUrl: target.canonicalUrl, angularConfiguration: 'study' },
  },
  capabilities: {
    presentation: 'standalone-only',
    contexts: [],
    hostBridge: false,
    portfolioEngine: false,
    webgl: 'The default 3D view uses WebGL through Three.js; without WebGL the 3D viewport stays empty and logs a console error, while the side column and the plan view (SVG and Canvas 2D) still work.',
    externalRuntimeOrigins: [],
    audio: { optional: false, microphone: false },
    storage: { cookies: false, serviceWorker: false, localStorage: false },
    network: 'Tracks are simulated in the browser; the WebSocket client is excluded from this build and the page makes no requests outside the asset base.',
  },
  archive: {
    path: archiveFile,
    size: archive.length,
    sha256: sha256(archive),
    format: 'normalized-ustar+gzip',
    ordering: 'ASCII path ascending',
    mtime: 0,
    uid: 0,
    gid: 0,
    mode: '0644',
  },
  budgets: {
    status: 'proposed study-only limits; owner review required',
    limits: LIMITS,
    measured: measure(built),
    compression: { tool: 'node:zlib gzipSync', node: process.version, zlib: process.versions.zlib, level: 9 },
    rationale: '1 MiB runtime and 280 KiB gzip JavaScript leave about 25% headroom over the first candidate (842,424 bytes; 225,888 bytes of gzip JavaScript). The 3D view is the default, so startup loads every file: 320 KiB encoded startup sits above the gzip total of all six files (231,342 bytes). No portfolio budget changes.',
  },
  files,
};
validateRuntime(built, manifest);

const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(out, archiveFile), archive);
writeFileSync(join(out, 'manifest.json'), manifestBytes);
writeFileSync(join(out, 'SHA256SUMS'), checksumsText(archive, archiveFile, manifestBytes));
const verified = loadPackage(out);

const buildReceipt = {
  schemaVersion: 1,
  releaseId: id,
  archiveSha256: sha256(archive),
  source,
  measurements: verified.measurements,
  checks: steps.map((command) => ({ command, passed: true })),
  packageVerified: true,
  verdict: source.dirty ? 'LOCAL DIRTY CANDIDATE - NOT PUBLISHABLE' : 'CLEAN PACKAGE - browser check still required',
};
writeFileSync(join(evidence, 'build-receipt.json'), `${JSON.stringify(buildReceipt, null, 2)}\n`);
console.log(JSON.stringify({ out, ...verified.measurements, archiveSha256: sha256(archive), publicationEligible: manifest.publicationEligible }, null, 2));
