/**
 * The harness's static server: the repository root, on `PORT` (4173), for Playwright's `webServer`.
 *
 * It is a **static file server and nothing else** — no directory listing, no rewriting, no watch. Playwright
 * starts it, waits for the port, and (with `reuseExistingServer`) reuses one that is already up, which is what
 * lets a person keep `bun run harness:serve` running while they iterate in a browser.
 *
 * Two details matter:
 *   · `/` serves `harness/index.html`, so the page's URLs — `../styles.css`, `./build/harness.js` — resolve from
 *     the repository root exactly as they would from a folder of build artefacts.
 *   · every path is resolved and then **checked to be inside the root**, because a static server that can be
 *     asked for `../../etc/passwd` is a bug even when it only ever runs on localhost.
 *
 * `no-store` on every response: a stale `styles.css` would make a layout assertion pass against the previous
 * build, which is the one failure mode a layout gate must not have.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number.parseInt(process.env.HARNESS_PORT ?? '4173', 10);
const HOST = process.env.HARNESS_HOST ?? '0.0.0.0';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.map': 'application/json; charset=utf-8',
};

/** The file a URL asks for, or `null` when it escapes the root or does not exist. */
function fileFor(urlPath) {
	const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
	// `/` and `/harness/` both mean "the page": the URLs inside it are absolute (`/harness/…`, `/styles.css`),
	// so they resolve from the repository root whatever the entry point was.
	const relative = decoded === '/' ? 'harness/index.html' : decoded.replace(/^\/+/, '');
	const withIndex = decoded.endsWith('/') ? `${relative}index.html` : relative;
	const candidate = resolve(ROOT, normalize(withIndex));
	if (candidate !== ROOT && !candidate.startsWith(`${ROOT}/`)) {
		return null;
	}
	if (!existsSync(candidate) || !statSync(candidate).isFile()) {
		return null;
	}
	return candidate;
}

createServer((request, response) => {
	const file = fileFor(request.url ?? '/');
	if (file === null) {
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('not found\n');
		return;
	}
	response.writeHead(200, {
		'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
		'cache-control': 'no-store',
	});
	createReadStream(file).pipe(response);
}).listen(PORT, HOST, () => {
	process.stdout.write(`harness: http://${HOST}:${String(PORT)}/ (root ${ROOT})\n`);
});
