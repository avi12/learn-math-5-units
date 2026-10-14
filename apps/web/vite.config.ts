import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exerciseHtml, markupMath } from './src/lib/tex.ts'

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

/** The same pass over the narrated reel (workbook/build/seqreel.py writes this file).
 *  Its markup arrives with every formula fenced in `$…$` too, so one renderer serves both
 *  files and the component receives HTML it only has to show. */
const REEL = '/src/lib/seqreel.json'
type Scene = { bodyTex: string; captionTex: string; body?: string; caption?: string }
type Reel = { groups: { scenes: Scene[] }[] }

/** The fonts' stylesheet link, from shared/skin/fonts.json — the same URL the workbook's
 *  skin.py writes into its pages, so the two cannot ask for different faces. */
function fontsLinkPlugin(): Plugin {
  const { url } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../shared/skin/fonts.json'), 'utf-8')
  ) as { url: string }
  return {
    name: 'fonts-link',
    transformIndexHtml: (html) =>
      html.replace(/<!-- FONTS:.*?-->/, `<link rel="stylesheet" href="${url}" />`)
  }
}

function exerciseHtmlPlugin(): Plugin {
  return {
    name: 'exercise-html',
    enforce: 'pre',
    load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith(GRADERS)) {
        const graders: Graders = JSON.parse(readFileSync(id, 'utf8'))
        for (const block of graders.blocks) {
          for (const ex of block.exercises) {
            ex.html = exerciseHtml(ex.text, ex.sections)
          }
        }
        return JSON.stringify(graders)
      }

      if (path.endsWith(REEL)) {
        const reel: Reel = JSON.parse(readFileSync(id, 'utf8'))
        for (const act of reel.groups) {
          for (const scene of act.scenes) {
            scene.body = markupMath(scene.bodyTex)
            scene.caption = markupMath(scene.captionTex)
          }
        }
        return JSON.stringify(reel)
      }

      return null
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
    fontsLinkPlugin(),
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
