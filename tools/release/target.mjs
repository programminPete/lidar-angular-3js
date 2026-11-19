// Identity of the hosted study. The portfolio serves app.html at PUBLIC_ROUTE and
// every other file from the versioned asset base.
export const SLUG = 'lidar-platform';
export const PUBLIC_ROUTE = `/studies/${SLUG}`;
export const CANONICAL = `https://www.alldayonrepete.com/studies/${SLUG}`;
export const REPOSITORY = 'https://github.com/programminPete/lidar-angular-3js';

const RESERVED_IDS = ['latest', 'main', 'master'];

export function assetBaseFor(releaseId) {
  return `/_studies/${SLUG}/${releaseId}/`;
}

/** Validates a release ID and returns the identity block recorded in the manifest. */
export function releaseTarget(releaseId) {
  const valid = typeof releaseId === 'string'
    && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(releaseId)
    && !releaseId.includes('..')
    && !RESERVED_IDS.includes(releaseId);
  if (!valid) {
    throw new Error(`Use a unique versioned release ID (for example v0.1.0), not: ${releaseId}`);
  }
  return { releaseId, assetBase: assetBaseFor(releaseId), canonicalUrl: CANONICAL };
}

function replaceOnce(html, pattern, replacement, description) {
  const matches = html.match(new RegExp(pattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${description} in the built index.html, found ${matches.length}`);
  }
  return html.replace(pattern, replacement);
}

/**
 * Turns Angular's index.html into the study's app.html. `--deploy-url` already points
 * scripts and styles at the asset base; this removes `<base>` (it would redirect the
 * plan view's `url(#id)` paint references), moves the favicon under the asset base and
 * adds the canonical link. Fails if Angular's output no longer has the expected shape.
 */
export function studyEntryHtml(html, target) {
  let entry = replaceOnce(html, /[ \t]*<base href="\/">\n?/, '', '<base href="/">');
  entry = replaceOnce(entry, /href="favicon\.ico"/, `href="${target.assetBase}favicon.ico"`, 'favicon link');
  entry = replaceOnce(entry, /(<meta name="viewport"[^>]*>)/, `$1\n  <link rel="canonical" href="${target.canonicalUrl}">`, 'viewport meta tag');
  return entry;
}
