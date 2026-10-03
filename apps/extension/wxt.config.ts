import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

/** Which deployed board the extension listens on — `WXT_PAD_ORIGIN` in `.env` (see
 *  `.env.example`). Never in the source: the code is public, the board is not. WXT hands
 *  WXT_* variables to the entrypoints too, so pad.content.ts reads the same value. */
/* WXT loads .env for the entrypoints, but only after this file has been read. */
const PAD =
  process.env.WXT_PAD_ORIGIN ??
  (() => {
    try {
      return readFileSync(new URL('.env', import.meta.url), 'utf8').match(/^WXT_PAD_ORIGIN=(.+)$/m)?.[1]?.trim();
    } catch {
      return undefined;
    }
  })();
if (!PAD) throw new Error('Set WXT_PAD_ORIGIN in extension/.env, e.g. https://<your-site>.web.app');

/** The extension's manifest, minus what WXT works out from the entrypoints themselves.
 *
 *  `content_scripts` and `background` are deliberately NOT here: each entrypoint declares
 *  its own `matches` and `runAt` next to the code they govern, which is the whole reason
 *  for moving to WXT — the old `manifest.json` listed three files by name, and a rename
 *  or a changed match pattern had two places to remember and no way to notice one.
 *
 *  `host_permissions` stays hand-written, because it is a different claim from `matches`:
 *  matches says where the code runs, host_permissions says what it may reach. They happen
 *  to be the same two origins today and that is a coincidence worth keeping visible. */
export default defineConfig({
  /** Source under `src/`, config at the root. `entrypointsDir` and the `utils/` alias
   *  both hang off this, so nothing else has to know. */
  srcDir: 'src',
  manifest: {
    name: 'לוח מתמטיקה → קלוד',
    description: 'לוקח את הלוח ואת קריטריוני הבדיקה של הנושא, ופותח איתם שיחה בקלוד.',
    default_locale: undefined,
    permissions: ['storage'],
    host_permissions: [`${PAD}/*`, 'https://claude.ai/*']
  }
});
