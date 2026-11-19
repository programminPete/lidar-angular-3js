// Usage: npm run release:serve -- release-output/<id> [port]
import { resolve } from 'node:path';
import { createHarness } from './harness.mjs';

if (!process.argv[2]) {
  throw new Error('Usage: npm run release:serve -- release-output/<id> [port]');
}
const port = Number(process.argv[3] ?? 5310);
const { server, manifest } = createHarness(resolve(process.argv[2]));
server.listen(port, '127.0.0.1', () => {
  console.log(`Verified ${manifest.archive.sha256}`);
  console.log(`http://127.0.0.1:${port}${manifest.publicRoute}`);
  console.log(`http://127.0.0.1:${port}${manifest.assetBase}app`);
});
