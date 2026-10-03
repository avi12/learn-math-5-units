import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exerciseHtml } from './src/lib/tex.ts'

/** The identity of this build, generated once and used in two places that must agree:
 *  baked into the bundle as `__BUILD__`, and written to dist/build-id.txt for the deploy
 *  script to publish. Two independently generated ids would drift on the day it matters
 *  — the client would think every deploy was for someone else and reload for ever. */
const BUILD = Date.now().toString(36)

/** Each exercise's maths, rendered once here instead of on every device — see lib/tex.ts.
 *  It runs before Vite's own JSON handling, so the page imports graders.json exactly as
 *  before and every exercise simply arrives with an `html` field. */
const GRADERS = '/src/lib/graders.json'
type Exercise = { text: string; sections: string[]; html?: string }
type Graders = { blocks: { exercises: Exercise[] }[] }

function exerciseHtmlPlugin(): Plugin {
  return {
    name: 'exercise-html',
    enforce: 'pre',
    load(id) {
      if (!id.replaceAll('\\', '/').endsWith(GRADERS)) {
        return null
      }

      const graders: Graders = JSON.parse(readFileSync(id, 'utf8'))
      for (const block of graders.blocks) {
        for (const ex of block.exercises) {
          ex.html = exerciseHtml(ex.text, ex.sections)
        }
      }
      return JSON.stringify(graders)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // The one .env at the repo root (shared/env.mjs says why there is only one).
  envDir: resolve(import.meta.dirname, '../..'),
  resolve: {
    alias: [
      /* Temml's Latin Modern stylesheet expects the font file beside it, and the package
       * does not ship it (lib/tex.ts says why this font). Unresolved, Vite leaves the url
       * as it is — the build passes and the font 404s — so it is pointed at the copy here. */
      {
        find: /^\.\/latinmodernmath\.woff2$/,
        replacement: resolve(import.meta.dirname, 'src/lib/fonts/latinmodernmath.woff2')
      }
    ]
  },
  plugins: [
    exerciseHtmlPlugin(),
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
