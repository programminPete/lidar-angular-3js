import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { loadPackage } from './package.mjs';

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Not found');
}

/**
 * Serves verified package bytes the way the portfolio does: app.html at the public route
 * and at <assetBase>app, every other file under the asset base, and a real 404 elsewhere.
 */
export function createHarness(dir) {
  const pkg = loadPackage(dir);
  const { manifest, files } = pkg;
  const internalEntry = `${manifest.assetBase}app`;

  function fileFor(pathname) {
    if (pathname === manifest.publicRoute || pathname === internalEntry) {
      return manifest.nativeEntry;
    }
    if (pathname.startsWith(manifest.assetBase)) {
      return pathname.slice(manifest.assetBase.length);
    }
    return null;
  }

  const server = createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if ([`${manifest.publicRoute}.html`, `${internalEntry}.html`].includes(url.pathname)) {
      res.writeHead(308, { Location: url.pathname.slice(0, -'.html'.length) + url.search, 'Cache-Control': 'no-cache' }).end();
      return;
    }
    const path = fileFor(url.pathname);
    let body = path ? files.get(path) : undefined;
    if (!body) {
      notFound(res);
      return;
    }
    const meta = manifest.files.find((file) => file.path === path);
    const isEntry = path === manifest.nativeEntry;
    const headers = {
      'Content-Type': meta.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': isEntry ? 'no-cache' : 'public, max-age=31536000, immutable',
      Vary: 'Accept-Encoding',
    };
    if (isEntry && url.pathname.startsWith(manifest.assetBase)) {
      headers['X-Robots-Tag'] = 'noindex';
    }
    if (meta.mime.startsWith('text/') && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      body = gzipSync(body, { level: 9 });
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return { ...pkg, server };
}
