/** Generic KaTeX pass: read a {key: tex} map, write a {key: html} map.
 *
 *   node build/dprender.mjs <in.json> <out.json>
 *
 * The repo already had four renderers, each with its filenames baked in. This one takes
 * them on the command line so a new builder does not need a fifth. Pinned to the repo's
 * katex 0.18.5 like everything else, so what renders here is what the page ships.
 */
import katex from "katex";
import fs from "node:fs";

// KaTeX warns rather than throws on a glyph it has no metrics for, and renders a hole -
// which is how Hebrew inside \text{} gets onto a page looking like a missing character.
// So a warning is a failure here.
// The one KaTeX warning that means the markup is RIGHT. `\mathrel{\char`≠}` is the only
// spelling of ≠ that renders with these embedded fonts, and it has no metrics entry, so
// it warns every time. Treating it as a failure rejected the good spelling while `\neq`
// - which renders a silent box - sailed through. Every other warning still fails.
const OK_WARN = "No character metrics for '≠'";
let warned = [];
console.warn = (...a) => warned.push(a.join(" "));

const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = {};
const bad = [];
for (const [key, tex] of Object.entries(map)) {
  warned = [];
  try {
    const html = katex.renderToString(tex, { displayMode: false, throwOnError: true, strict: false });
    const real = warned.filter((w) => !w.includes(OK_WARN));
    if (real.length) bad.push(`${JSON.stringify(tex)} -> ${real[0]}`);
    else out[key] = html;
  } catch (e) {
    bad.push(`${JSON.stringify(tex)} -> ${e.message.split("\n")[0]}`);
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(`rendered ${Object.keys(out).length}, failures ${bad.length}`);
for (const b of bad) console.error("  KATEX FAIL: " + b);
process.exit(bad.length ? 1 : 0);
