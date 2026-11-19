// Usage: npm run release:verify -- release-output/<id>
import { resolve } from 'node:path';
import { loadPackage } from './package.mjs';

if (!process.argv[2]) {
  throw new Error('Usage: npm run release:verify -- release-output/<id>');
}
const { manifest, measurements } = loadPackage(resolve(process.argv[2]));
console.log(JSON.stringify({
  verified: true,
  releaseId: manifest.releaseId,
  archiveSha256: manifest.archive.sha256,
  source: manifest.source,
  publicationEligible: manifest.publicationEligible,
  ...measurements,
}, null, 2));
