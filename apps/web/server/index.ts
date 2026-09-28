/** The whole server: one static handler on the port Cloud Run hands it.
 *
 * Cloud Run decides the port and passes it in PORT; 8080 is only what it always is, so
 * `node server/index.ts` works by hand as well. STATIC_DIRECTORY is where the built site
 * is: `static` in the image (the Dockerfile copies dist/ there), and `dist` when this is
 * run against a local build.
 *
 * Node runs this TypeScript directly — types are stripped, nothing is compiled — so the
 * image has no build step for the server and no node_modules at all.
 */
import { createStaticRequestHandler } from './static.ts';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIRECTORY = process.env.STATIC_DIRECTORY ?? 'static';

const serveStaticRequest = createStaticRequestHandler(STATIC_DIRECTORY);

createServer((request, response) => void serveStaticRequest(request, response)).listen(PORT, () => {
  console.log(`serving ${resolve(STATIC_DIRECTORY)} on port ${PORT}`);
});
