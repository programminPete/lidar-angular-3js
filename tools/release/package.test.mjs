import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANONICAL, PUBLIC_ROUTE, REPOSITORY, SLUG, releaseTarget, studyEntryHtml } from './target.mjs';
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
  parseTar,
  sha256,
  validateRuntime,
} from './package.mjs';
import { createHarness } from './harness.mjs';

const RELEASE_ID = 'v0.0.0-test.1';

// The shape of Angular's built index.html with --deploy-url set.
function angularIndexHtml(assetBase) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Overwatch · Airside C shuttle lobby</title>',
    '  <base href="/">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <link rel="icon" type="image/x-icon" href="favicon.ico">',
    `<link rel="stylesheet" href="${assetBase}styles-TEST.css"></head>`,
    '<body>',
    '  <ow-root></ow-root>',
    `<script src="${assetBase}main-TEST.js" type="module"></script></body>`,
    '</html>',
  ].join('\n');
}

function makeManifest(target, files) {
  const archive = gzip(makeTar(files));
  const manifest = {
    schemaVersion: 1,
    slug: SLUG,
    ...target,
    nativeEntry: NATIVE_ENTRY,
    publicRoute: PUBLIC_ROUTE,
    source: { repository: REPOSITORY, commit: 'a'.repeat(40), dirty: true, treeSha256: 'b'.repeat(64) },
    publicationEligible: false,
    capabilities: {
      presentation: 'standalone-only',
      contexts: [],
      hostBridge: false,
      portfolioEngine: false,
      externalRuntimeOrigins: [],
      storage: { cookies: false, serviceWorker: false, localStorage: false },
    },
    archive: { path: archiveName(target.releaseId), size: archive.length, sha256: sha256(archive) },
    budgets: { limits: LIMITS, measured: measure(files) },
    files: inventory(files),
  };
  return { manifest, archive };
}

function fixture() {
  const target = releaseTarget(RELEASE_ID);
  const files = new Map([
    ['favicon.ico', Buffer.from('icon')],
    ['main-TEST.js', Buffer.from('const svg = "http://www.w3.org/2000/svg"; import("./chunk-TEST.js");')],
    ['chunk-TEST.js', Buffer.from('export const stroke = "url(#plan-guideway-fade)";')],
    ['styles-TEST.css', Buffer.from('body { background: url(data:image/png;base64,AAAA); }')],
  ]);
  files.set(NATIVE_ENTRY, Buffer.from(studyEntryHtml(angularIndexHtml(target.assetBase), target)));
  const { manifest, archive } = makeManifest(target, files);
  return { target, files, manifest, archive };
}

/** Re-inventories after a change, so only the rule under test can fail. */
function withChangedFile(path, bytes) {
  const f = fixture();
  f.files.set(path, Buffer.from(bytes));
  f.manifest.files = inventory(f.files);
  f.manifest.budgets.measured = measure(f.files);
  return f;
}

function writePackage(f) {
  const dir = mkdtempSync(join(tmpdir(), 'lidar-platform-package-test-'));
  const archiveFile = archiveName(f.target.releaseId);
  const manifestBytes = Buffer.from(JSON.stringify(f.manifest));
  writeFileSync(join(dir, archiveFile), f.archive);
  writeFileSync(join(dir, 'manifest.json'), manifestBytes);
  writeFileSync(join(dir, 'SHA256SUMS'), checksumsText(f.archive, archiveFile, manifestBytes));
  return dir;
}

test('release IDs are validated and map to the asset base', () => {
  assert.deepEqual(releaseTarget('v0.1.0'), {
    releaseId: 'v0.1.0',
    assetBase: '/_studies/lidar-platform/v0.1.0/',
    canonicalUrl: CANONICAL,
  });
  for (const id of ['latest', '../oops', 'a..b', '/absolute', 'V0.1.0', '', undefined]) {
    assert.throws(() => releaseTarget(id));
  }
});

test('the entry rewrite removes <base>, moves the favicon and adds the canonical link', () => {
  const { files, target } = fixture();
  const html = files.get(NATIVE_ENTRY).toString();
  assert(!html.includes('<base'));
  assert(html.includes(`href="${target.assetBase}favicon.ico"`));
  assert(html.includes(`<link rel="canonical" href="${CANONICAL}">`));
  assert.throws(() => studyEntryHtml(html, target), /<base href/);
});

test('the archive round-trips byte for byte and validates', () => {
  const f = fixture();
  const reversed = new Map([...f.files].reverse());
  assert.deepEqual(gzip(makeTar(reversed)), f.archive);
  assert.deepEqual(parseTar(makeTar(f.files)), new Map([...f.files].sort(([a], [b]) => (a < b ? -1 : 1))));
  validateRuntime(f.files, f.manifest);
  const dir = writePackage(f);
  try {
    const { measurements } = loadPackage(dir);
    assert.equal(measurements.files, f.files.size);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('unsafe paths are rejected', () => {
  for (const path of ['../evil', '/absolute', 'assets/../evil', 'a\\b', '.env', 'a//b']) {
    assert.throws(() => makeTar(new Map([[path, Buffer.from('x')]])), /Unsafe path/);
  }
  const f = fixture();
  f.files.set('notes.txt', Buffer.from('x'));
  assert.throws(() => validateRuntime(f.files, f.manifest), /Unapproved runtime file/);
});

test('a tampered file fails the inventory check', () => {
  const f = fixture();
  f.files.set('main-TEST.js', Buffer.from('console.log("changed");'));
  assert.throws(() => validateRuntime(f.files, f.manifest), /File inventory/);
});

test('an app.html reference outside the asset base is rejected', () => {
  const f = fixture();
  const escaped = f.files.get(NATIVE_ENTRY).toString().replace(`${f.target.assetBase}main-TEST.js`, '/main-TEST.js');
  const changed = withChangedFile(NATIVE_ENTRY, escaped);
  assert.throws(() => validateRuntime(changed.files, changed.manifest), /escapes release/);
});

test('a bundle containing the WebSocket client is rejected', () => {
  const withClient = withChangedFile('chunk-TEST.js', 'const socket = new WebSocket(url);');
  assert.throws(() => validateRuntime(withClient.files, withClient.manifest), /WebSocket client/);
  const withUrl = withChangedFile('chunk-TEST.js', 'const url = "ws://localhost:8787";');
  assert.throws(() => validateRuntime(withUrl.files, withUrl.manifest), /WebSocket URL/);
});

test('an absolute runtime URL in a bundle is rejected', () => {
  const f = withChangedFile('chunk-TEST.js', 'fetch("https://example.com/tracks");');
  assert.throws(() => validateRuntime(f.files, f.manifest), /Unexpected absolute URL/);
});

test('the harness serves the entry at both routes and 404s elsewhere', async () => {
  const f = fixture();
  const dir = writePackage(f);
  const { server } = createHarness(dir);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of [PUBLIC_ROUTE, `${f.target.assetBase}app`]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.files.get(NATIVE_ENTRY));
    }
    assert.equal((await fetch(`${origin}${f.target.assetBase}main-TEST.js`)).status, 200);
    for (const path of ['/', '/main-TEST.js', `${f.target.assetBase}missing.js`, `${f.target.assetBase}.env`, '/studies/unknown']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true });
  }
});
