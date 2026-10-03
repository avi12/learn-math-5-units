import katex from "katex";
import fs from "fs";
const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = {};
let bad = 0;
for (const [k, t] of Object.entries(map)) {
  try { out[k] = katex.renderToString(t, {displayMode:false, throwOnError:true, strict:false}); }
  catch (e) { bad++; console.error("KATEX FAIL:", t, "->", e.message); }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.error("rendered " + Object.keys(out).length + ", failures " + bad);
