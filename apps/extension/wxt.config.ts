import { padOrigin } from '@learn-math/shared/env';
import { defineConfig } from 'wxt';

/** Which deployed board the extension listens on: derived from the root `.env` by the same
 *  loader every other part uses. It is handed on as WXT_PAD_ORIGIN, because WXT gives WXT_*
 *  variables to the entrypoints — that is how pad.content.ts's `matches` gets it. */
const PAD = padOrigin();
process.env.WXT_PAD_ORIGIN = PAD;

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
