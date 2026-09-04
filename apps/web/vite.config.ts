import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The identity of this build, generated once and used in two places that must agree:
 *  baked into the bundle as `__BUILD__`, and written to dist/build-id.txt for the deploy
 *  script to publish. Two independently generated ids would drift on the day it matters
 *  — the client would think every deploy was for someone else and reload for ever. */
const BUILD = Date.now().toString(36)

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    svelte(),
    {
      name: 'build-id',
      apply: 'build',
      writeBundle(options) {
        writeFileSync(resolve(options.dir ?? 'dist', 'build-id.txt'), BUILD)
      }
    }
  ],
})
