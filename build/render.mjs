import katex from "katex";
import fs from "fs";
const map = JSON.parse(fs.readFileSync("texmap.json", "utf8"));
const out = {};
let bad = 0;
for (const [key, tex] of Object.entries(map)) {
  try {
    out[key] = katex.renderToString(tex, { displayMode: false, throwOnError: true, strict: false });
  } catch (e) {
    bad++; console.error("KATEX FAIL:", tex, "->", e.message);
    out[key] = null;
  }
}
fs.writeFileSync("texhtml.json", JSON.stringify(out));
console.log("rendered:", Object.keys(out).length, "| failures:", bad);
