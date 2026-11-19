// Writes release-output/<id>/evidence-receipt.json, the receipt published with the release.
// Usage: npm run release:receipt -- release-output/<id>
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPackage } from './package.mjs';

const LIMITATIONS = [
  'Physical phones, Safari and other GPU families are untested.',
  'The track data is simulated in the browser; no sensor or server is involved.',
  'The 3D view needs WebGL.',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The hand-written browser check, if present: { archiveSha256, checks: string[], coverage: string }. */
function readBrowserCheck(dir, archiveSha256) {
  const path = join(dir, 'evidence', 'browser-check.json');
  if (!existsSync(path)) {
    return null;
  }
  const check = readJson(path);
  assert.equal(check.archiveSha256, archiveSha256, 'browser-check.json belongs to a different archive');
  assert(Array.isArray(check.checks) && check.checks.every((name) => typeof name === 'string'), 'browser-check.json needs a checks array of strings');
  assert.equal(typeof check.coverage, 'string', 'browser-check.json needs coverage text');
  return check;
}

function verdictFor(manifest, browserCheck) {
  const checks = browserCheck
    ? 'BUILD, PACKAGE AND BROWSER CHECKS PASSED'
    : 'BUILD AND PACKAGE CHECKS PASSED - browser check not run';
  if (manifest.source.dirty) {
    return `CANDIDATE ONLY (dirty tree; clean-commit rebuild required) - ${checks}`;
  }
  return checks;
}

const dir = process.argv[2];
if (!dir) {
  throw new Error('Usage: npm run release:receipt -- release-output/<id>');
}
const releaseDir = resolve(dir);
const { manifest, measurements } = loadPackage(releaseDir);
const archiveSha256 = manifest.archive.sha256;

const buildReceipt = readJson(join(releaseDir, 'evidence', 'build-receipt.json'));
assert.equal(buildReceipt.archiveSha256, archiveSha256, 'build-receipt.json belongs to a different archive');
assert(buildReceipt.packageVerified && buildReceipt.checks.every((check) => check.passed), 'Build checks must pass first');
const browserCheck = readBrowserCheck(releaseDir, archiveSha256);

const receipt = {
  schemaVersion: 1,
  releaseId: manifest.releaseId,
  archiveSha256,
  sourceCommit: manifest.source.commit,
  sourceTreeSha256: manifest.source.treeSha256,
  sourceDirty: manifest.source.dirty,
  verdict: verdictFor(manifest, browserCheck),
  tools: {
    node: manifest.build.node,
    npm: manifest.build.npm,
    zlib: manifest.budgets.compression.zlib,
  },
  measurements,
  checks: {
    build: buildReceipt.checks,
    browser: browserCheck ? browserCheck.checks : 'not run',
  },
  ...(browserCheck ? { coverage: browserCheck.coverage } : {}),
  limitations: LIMITATIONS,
};
const output = join(releaseDir, 'evidence-receipt.json');
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(output);
