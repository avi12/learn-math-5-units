/** Serve the built site over HTTP, the way Firebase Hosting was serving it.
 *
 * Hosting does four things for a single-page app that a bare file server does not, and
 * every one of them is written out here because none of them is automatic:
 *
 *   - the rewrite, so `/anything` is the app and not a 404;
 *   - the cache headers, copied from firebase.json;
 *   - a Content-Type per extension;
 *   - nothing outside the site directory, ever.
 *
 * What it does NOT replace is the CDN. Firebase served the bundle from an edge near
 * whoever asked; Cloud Run serves it from one region. For a tablet and a desktop in the
 * same room that is the right trade, and if it ever stops being one the answer is a load
 * balancer with Cloud CDN in front — not a change here.
 *
 * There is no dependency: `node:http` and `node:fs` are the whole of it, which is why the
 * runtime image installs no packages at all.
 */
import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const INDEX_FILE_NAME = 'index.html';

/* The three cache rules below are the `headers` block of firebase.json, which is still
 * the live configuration while Firebase Hosting serves the site. They are a pair until
 * the cutover, and after it this file is the only home the policy has. */

/** firebase.json matches these by EXTENSION, not by directory, and that is copied rather
 *  than tidied: vite writes every js, css and woff2 into /assets/ with a content hash in
 *  the name, so the two readings pick out the same files, and a rule that is a copy of
 *  the live one cannot be wrong in a way nobody notices. A year is safe because a changed
 *  file is a different URL. */
const IMMUTABLE_EXTENSIONS = new Set(['.css', '.js', '.woff2']);
const IMMUTABLE_CACHE_CONTROL = 'public,max-age=31536000,immutable';

/** How an open tab learns a deploy happened (src/lib/release.ts). It is eight bytes and
 *  it is the one file whose whole purpose is to differ from the copy the tab has, so a
 *  revalidation the browser feels free to skip is worse than useless here. */
const NO_STORE_PATHS = new Set(['/build-id.txt']);
const NO_STORE_CACHE_CONTROL = 'no-store';

/** Everything else, including `/` and index.html: held, but never used without asking. */
const REVALIDATED_CACHE_CONTROL = 'no-cache';

const SERVABLE_METHODS = ['GET', 'HEAD'];

async function findFile(filePath: string): Promise<Stats | null> {
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

/** The path the request is asking for, as a path inside `rootDirectory`, or null if it
 *  points anywhere else.
 *
 *  `decodeURIComponent` is the point of this function. A literal `..` is collapsed by the
 *  client before the request is sent, but `%2e%2e` arrives here intact, so the decode has
 *  to happen before the containment check rather than after it. It also throws on a
 *  malformed escape (`/%zz`), and an exception here would leave the socket hanging with
 *  nothing written to it, so that case is a miss like any other. */
function resolveInsideRoot(rootDirectory: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const requestedPath = resolve(rootDirectory, `.${decoded}`);
  const isInsideRoot = requestedPath === rootDirectory || requestedPath.startsWith(rootDirectory + sep);
  return isInsideRoot ? requestedPath : null;
}

/** Only ever asked about a file that really exists — the rewrite's index.html is HTML
 *  served under someone else's URL, and a year of caching on it would pin the whole app
 *  to one deploy. */
function cacheControlFor(pathname: string): string {
  if (NO_STORE_PATHS.has(pathname)) {
    return NO_STORE_CACHE_CONTROL;
  }
  if (IMMUTABLE_EXTENSIONS.has(extname(pathname).toLowerCase())) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  return REVALIDATED_CACHE_CONTROL;
}

export function createStaticRequestHandler(staticDirectory: string) {
  const rootDirectory = resolve(staticDirectory);
  const indexFilePath = join(rootDirectory, INDEX_FILE_NAME);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!SERVABLE_METHODS.includes(request.method ?? '')) {
      response.writeHead(405, { Allow: SERVABLE_METHODS.join(', ') });
      response.end();
      return;
    }

    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const requestedPath = resolveInsideRoot(rootDirectory, pathname) ?? '';
    const requestedFile = requestedPath ? await findFile(requestedPath) : null;

    // The rewrite: anything that is not a file is the app, at 200, under its own URL.
    const filePath = requestedFile ? requestedPath : indexFilePath;
    const fileStats = requestedFile ?? (await findFile(indexFilePath));
    if (!fileStats) {
      response.writeHead(404, { 'Content-Type': CONTENT_TYPES['.txt'] });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': requestedFile ? cacheControlFor(pathname) : REVALIDATED_CACHE_CONTROL,
      'Content-Length': fileStats.size,
      'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  };
}
