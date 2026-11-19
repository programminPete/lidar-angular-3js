// Package format and validation for the hosted study. Dependency-free on purpose:
// the portfolio vendors this file to verify the release it imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CANONICAL, PUBLIC_ROUTE, REPOSITORY, SLUG, releaseTarget } from './target.mjs';

export const NATIVE_ENTRY = 'app.html';
export const PUBLIC_FILES = ['favicon.ico'];
export const TITLE = 'Overwatch · Airside C shuttle lobby';

// Proposed study-only limits, measured against the first candidate build
// (see budgets.rationale in build.mjs).
export const LIMITS = {
  totalBytes: 1024 * 1024,
  javascriptGzipBytes: 280 * 1024,
  startupEncodedBytes: 320 * 1024,
};

const MAX_FILES = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
};

// Angular writes hashed bundles at the output root, not under assets/.
const BUNDLE_PATH = /^(main|chunk)-[A-Za-z0-9]+\.js$|^styles-[A-Za-z0-9]+\.css$/;

// Absolute URLs that appear in the bundles as XML namespace identifiers. The browser
// never fetches them; any other http(s) string fails validation.
const INERT_URLS = new Set([
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/2000/xmlns/',
  'http://www.w3.org/XML/1998/namespace',
]);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function gzip(bytes) {
  return gzipSync(bytes, { level: 9 });
}

function byAsciiPath([a], [b]) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

export function safePath(path) {
  assert(typeof path === 'string' && /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/'), `Unsafe path: ${path}`);
  const parts = path.split('/');
  assert(parts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.')), `Unsafe path: ${path}`);
  return path;
}

export function mime(path) {
  safePath(path);
  const approved = path === NATIVE_ENTRY || PUBLIC_FILES.includes(path) || BUNDLE_PATH.test(path);
  assert(approved, `Unapproved runtime file: ${path}`);
  assert(MIME[extname(path)], `Unapproved MIME: ${path}`);
  return MIME[extname(path)];
}

/** Regular files under `dir`, keyed by relative path. Symlinks and special files are rejected. */
export function readTree(dir, prefix = '') {
  const files = new Map();
  for (const name of readdirSync(dir).sort()) {
    const path = `${prefix}${name}`;
    const stat = lstatSync(join(dir, name));
    assert(!stat.isSymbolicLink(), `Symlink rejected: ${path}`);
    if (stat.isDirectory()) {
      for (const [childPath, bytes] of readTree(join(dir, name), `${path}/`)) {
        files.set(childPath, bytes);
      }
      continue;
    }
    assert(stat.isFile(), `Not a regular file: ${path}`);
    files.set(path, readFileSync(join(dir, name)));
  }
  return files;
}

export function inventory(files) {
  return [...files].sort(byAsciiPath).map(([path, bytes]) => ({
    path,
    size: bytes.length,
    sha256: sha256(bytes),
    mime: mime(path),
  }));
}

// Deliberately restricted USTAR: regular files only, so no extractor ever sees links or
// extension records. uid/gid/mtime 0, mode 0644, empty owners, sorted paths, two zero
// blocks at the end, gzip level 9.
function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function headerSum(header) {
  return [...header].reduce((sum, byte) => sum + byte, 0);
}

export function makeTar(files) {
  const blocks = [];
  for (const [path, bytes] of [...files].sort(byAsciiPath)) {
    safePath(path);
    assert(Buffer.byteLength(path) < 100, 'USTAR path too long');
    const header = Buffer.alloc(512);
    header.write(path, 0);
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(bytes.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(`${headerSum(header).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

function tarString(block, start, end) {
  return block.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
}

function tarNumber(block, start, end) {
  const value = tarString(block, start, end).trim();
  assert(/^[0-7]+$/.test(value), 'Invalid tar integer');
  return parseInt(value, 8);
}

export function parseTar(tar) {
  assert(tar.length % 512 === 0 && tar.length >= 1024, 'Truncated archive');
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const rest = tar.subarray(offset);
      assert(rest.length >= 1024 && rest.every((byte) => byte === 0), 'Invalid tar terminator');
      return files;
    }
    const checksum = tarNumber(header, 148, 156);
    const blanked = Buffer.from(header);
    blanked.fill(32, 148, 156);
    assert.equal(headerSum(blanked), checksum, 'Tar header checksum mismatch');
    assert.equal(tarString(header, 257, 263), 'ustar', 'Only USTAR is allowed');
    assert.equal(header[156], 48, 'Links, directories, devices and extension records are forbidden');
    assert.equal(tarString(header, 157, 257), '', 'Link target is forbidden');
    assert.equal(tarString(header, 345, 500), '', 'Prefix fields are forbidden');
    const path = safePath(tarString(header, 0, 100));
    assert(!files.has(path), `Duplicate path: ${path}`);
    const size = tarNumber(header, 124, 136);
    assert(size <= LIMITS.totalBytes && offset + 512 + size <= tar.length - 1024, 'Invalid member size');
    files.set(path, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
    assert(files.size <= MAX_FILES, 'Too many files');
  }
  throw new Error('Missing tar terminator');
}

function totalBytesOf(files) {
  return [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
}

function javascriptGzipBytesOf(files) {
  return [...files]
    .filter(([path]) => path.endsWith('.js'))
    .reduce((sum, [, bytes]) => sum + gzip(bytes).length, 0);
}

export function measure(files) {
  return { totalBytes: totalBytesOf(files), javascriptGzipBytes: javascriptGzipBytesOf(files) };
}

function checkIdentity(manifest) {
  const target = releaseTarget(manifest.releaseId);
  assert(manifest.schemaVersion === 1 && manifest.slug === SLUG, 'Unsupported release identity/schema');
  assert.equal(manifest.assetBase, target.assetBase, 'Asset base must match release identity');
  assert.equal(manifest.canonicalUrl, CANONICAL, 'Canonical URL mismatch');
  assert.equal(manifest.nativeEntry, NATIVE_ENTRY, 'Unexpected native entry');
  assert.equal(manifest.publicRoute, PUBLIC_ROUTE, 'Unexpected public route');
  return target;
}

function checkSource(source, manifest) {
  assert.equal(source.repository, REPOSITORY, 'Unexpected source repository');
  assert(/^[a-f0-9]{40}$/.test(source.commit), 'Full source commit required');
  assert(typeof source.dirty === 'boolean' && /^[a-f0-9]{64}$/.test(source.treeSha256), 'Source provenance required');
  assert.equal(manifest.publicationEligible, !source.dirty, 'Dirty candidates are not publication eligible');
}

function checkCapabilities(capabilities) {
  assert.equal(capabilities.presentation, 'standalone-only');
  assert.deepEqual(capabilities.contexts, []);
  assert.equal(capabilities.hostBridge, false);
  assert.equal(capabilities.portfolioEngine, false);
  assert.deepEqual(capabilities.externalRuntimeOrigins, []);
  assert.deepEqual(capabilities.storage, { cookies: false, serviceWorker: false, localStorage: false });
}

/** Every reference must be a fragment, a data: URL, or a file inside this release. */
function checkLocalReference(url, files, assetBase) {
  if (url.startsWith('#') || url.startsWith('data:')) {
    return;
  }
  assert(url.startsWith(assetBase), `Runtime reference escapes release: ${url}`);
  assert(files.has(url.slice(assetBase.length)), `Missing referenced file: ${url}`);
}

function checkEntry(html, files, assetBase) {
  assert(html.includes(`<title>${TITLE}</title>`), 'Native title required');
  assert(!/<base\b/i.test(html), 'app.html must not contain a <base> tag');
  assert(!/<iframe/i.test(html), 'Unexpected iframe in native entry');
  const canonicalLinks = html.match(/rel="canonical"/g) ?? [];
  assert(canonicalLinks.length === 1 && html.includes(`<link rel="canonical" href="${CANONICAL}">`), 'Canonical link mismatch');
  for (const match of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
    if (match[1] !== CANONICAL) {
      checkLocalReference(match[1], files, assetBase);
    }
  }
}

function checkBundles(files, assetBase) {
  for (const [path, bytes] of files) {
    if (path.endsWith('.ico')) {
      continue;
    }
    const text = bytes.toString('utf8');
    // The study is simulation only: the WebSocket client must not be in the build.
    assert(!text.includes('WebSocket'), `WebSocket client found in ${path}`);
    assert(!/\bwss?:\/\//.test(text), `WebSocket URL found in ${path}`);
    if (path === NATIVE_ENTRY) {
      continue;
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'`)\\]+/g)) {
      assert(INERT_URLS.has(match[0]), `Unexpected absolute URL in ${path}: ${match[0]}`);
    }
    // Component styles are compiled into the JavaScript, so url() is checked there too.
    for (const match of text.matchAll(/url\(\s*["']?([^\s)'"]+)["']?\s*\)/g)) {
      checkLocalReference(match[1], files, assetBase);
    }
  }
}

function checkBudgets(files, budgets) {
  const { totalBytes, javascriptGzipBytes } = measure(files);
  assert.deepEqual(budgets.limits, LIMITS, 'Study limits require review');
  assert.equal(budgets.measured.totalBytes, totalBytes, 'Incorrect total byte measurement');
  // Compressed size is a budget measurement, not an integrity digest: zlib versions may
  // encode identical JavaScript differently. File and archive SHA-256 checks stay exact.
  const producerGzip = budgets.measured.javascriptGzipBytes;
  const producerGzipValid = Number.isSafeInteger(producerGzip) && producerGzip > 0 && producerGzip <= LIMITS.javascriptGzipBytes;
  assert(producerGzipValid, 'Invalid producer JavaScript gzip budget');
  assert(totalBytes <= LIMITS.totalBytes && javascriptGzipBytes <= LIMITS.javascriptGzipBytes, 'Study package budget exceeded');
  return { totalBytes, javascriptGzipBytes, producerJavascriptGzipBytes: producerGzip };
}

export function validateRuntime(files, manifest) {
  const target = checkIdentity(manifest);
  checkSource(manifest.source, manifest);
  checkCapabilities(manifest.capabilities);
  assert.deepEqual(manifest.files, inventory(files), 'File inventory, size, MIME or SHA-256 mismatch');
  for (const path of [NATIVE_ENTRY, ...PUBLIC_FILES]) {
    assert(files.has(path), `Missing runtime file: ${path}`);
  }
  checkEntry(files.get(NATIVE_ENTRY).toString('utf8'), files, target.assetBase);
  checkBundles(files, target.assetBase);
  const measured = checkBudgets(files, manifest.budgets);
  return { ...measured, files: files.size };
}

export function archiveName(releaseId) {
  return `${SLUG}-${releaseId}.tar.gz`;
}

export function checksumsText(archive, archiveFile, manifestBytes) {
  return `${sha256(archive)}  ${archiveFile}\n${sha256(manifestBytes)}  manifest.json\n`;
}

/** Reads a release folder, checks every digest, unpacks the archive and validates it. */
export function loadPackage(dir) {
  const manifestBytes = readFileSync(join(dir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const name = safePath(manifest.archive.path);
  assert(!name.includes('/') && name === archiveName(manifest.releaseId), 'Unexpected archive name');
  const archive = readFileSync(join(dir, name));
  assert(archive.length <= LIMITS.totalBytes * 2, 'Oversized archive');
  const checksums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  assert.equal(checksums, checksumsText(archive, name, manifestBytes), 'Detached checksum mismatch');
  assert.equal(sha256(archive), manifest.archive.sha256, 'Archive SHA-256 mismatch');
  assert.equal(archive.length, manifest.archive.size, 'Archive size mismatch');
  const files = parseTar(gunzipSync(archive, { maxOutputLength: LIMITS.totalBytes + 1024 * 1024 }));
  const measurements = validateRuntime(files, manifest);
  return { manifest, files, measurements };
}
