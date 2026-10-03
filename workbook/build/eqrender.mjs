import katex from "katex";
import fs from "fs";
const tex = JSON.parse(fs.readFileSync("eqtex.json", "utf8"));
let bad = 0;
const out = tex.map(t => {
  try { return katex.renderToString(t, { displayMode: false, throwOnError: true, strict: false }); }
  catch (e) { bad++; console.error("FAIL:", t, e.message); return "<b>?</b>"; }
});
fs.writeFileSync("eqtexhtml.json", JSON.stringify(out));
console.log("rendered:", out.length, "| failures:", bad);
