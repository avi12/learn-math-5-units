import json, re, shutil

# KaTeX 0.18 builds \ne / \neq / \not= as an rlap composition that renders as tofu
# with the inlined web fonts. Emitting the raw glyph via \char works correctly.
NE = "\\mathrel{\\char`\u2260}"

m = json.load(open("texmap.json", encoding="utf-8"))
n = 0
for k, v in list(m.items()):
    rep = lambda _m: NE + " "
    new = re.sub(r"\\neq(?![a-zA-Z])\s*", rep, v)
    new = re.sub(r"\\ne(?![a-zA-Z])\s*", rep, new)
    if new != v:
        m[k] = new
        n += 1
json.dump(m, open("texmap.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("expressions fixed:", n)
for k, v in m.items():
    if "char" in v:
        print("  ", k, "=>", v)

shutil.copy("workbook.pretex.bak", "workbook.html")
print("workbook restored to pre-LaTeX state")
