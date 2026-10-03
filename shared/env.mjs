/** The one config file: `.env` at the repo root (see `.env.example`).
 *
 * Every part reads the same file — the web app through Vite (`envDir`), the extension's
 * build, the browser tests and the deploy scripts through here, the Android build through
 * its own few lines in build.gradle.kts. Nothing names a deployment in the source: the
 * code is public and the deployed board is not, so every copy brings its own project.
 *
 * The pad's origin is DERIVED from the Firebase project (its default Hosting site), so
 * the project id is the only thing a fork has to set for all four parts to agree. */
import { readFileSync } from 'node:fs';

const FILE = new URL('../.env', import.meta.url);

function parse() {
  try {
    return Object.fromEntries(
      readFileSync(FILE, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^\s*[A-Z0-9_]+\s*=/.test(line))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const FROM_FILE = parse();

/** A value from the environment, else from `.env`. Throws with the fix, not a stack. */
export function env(name) {
  const value = process.env[name] || FROM_FILE[name];
  if (!value) {
    throw new Error(`${name} is not set - copy .env.example to .env at the repo root and fill it in`);
  }
  return value;
}

/** The Firebase project the pad lives in. */
export function firebaseProject() {
  return env('VITE_FIREBASE_PROJECT_ID');
}

/** Where the deployed pad is served: PAD_ORIGIN if set, else the project's default site. */
export function padOrigin() {
  return process.env.PAD_ORIGIN || FROM_FILE.PAD_ORIGIN || `https://${firebaseProject()}.web.app`;
}
