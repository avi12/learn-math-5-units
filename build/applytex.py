import base64, json, os, re

DIST = "node_modules/katex/dist"
P = "workbook.html"

# ---------- 1. inline katex.min.css with base64 woff2 ----------
css = open(os.path.join(DIST, "katex.min.css"), encoding="utf-8").read()
fonts = {}
for f in os.listdir(os.path.join(DIST, "fonts")):
    if f.endswith(".woff2"):
        b = open(os.path.join(DIST, "fonts", f), "rb").read()
        fonts[f[:-6]] = base64.b64encode(b).decode()


def src_repl(m):
    name = m.group(1)
    if name not in fonts:
        return m.group(0)
    return 'src:url(data:font/woff2;base64,%s) format("woff2")' % fonts[name]


# each @font-face has: src:url(fonts/NAME.woff2) format("woff2"),url(...woff)...,url(...ttf)...;
css = re.sub(r'src:url\(fonts/([\w-]+)\.woff2\)[^;]*', src_repl, css)
assert "fonts/" not in css, "some font url survived"

EXTRA = """
.katex{direction:ltr;unicode-bidi:isolate;font-size:1.06em;}
.tex{display:inline-block;max-width:100%;overflow-x:auto;overflow-y:hidden;
     vertical-align:middle;padding-block:2px;}
.rung .tex,.abody .tex{margin-inline:1px;}
"""

# ---------- 2. swap every math span for its KaTeX render ----------
s = open(P, encoding="utf-8").read()
tex = json.load(open("texhtml.json", encoding="utf-8"))

missing = []


def span_repl(m):
    inner = m.group(1)
    if inner not in tex or tex[inner] is None:
        missing.append(inner)
        return m.group(0)          # leave code chips (URL / 35572) untouched
    return '<span class="tex">' + tex[inner] + "</span>"


s, n = re.subn(r'<span class="m">(.*?)</span>', span_repl, s)

# ---------- 3. drop the now-unused chip look, keep it only for code ----------
s = s.replace(
    """.m{font-family:var(--font-mono);direction:ltr;unicode-bidi:isolate;font-size:.95em;
   background:var(--sc-highest);border-radius:6px;padding:1px 7px;white-space:nowrap;}
.rung .m{background:var(--sc-lowest);}""",
    """.m{font-family:var(--font-mono);direction:ltr;unicode-bidi:isolate;font-size:.9em;
   background:var(--sc-highest);border-radius:6px;padding:1px 7px;word-break:break-all;}""")

# ---------- 4. splice the stylesheet in ----------
s = s.replace("</style>", EXTRA + "</style>\n<style>" + css + "</style>", 1)

open(P, "w", encoding="utf-8").write(s)
print("spans replaced:", n - len(missing), "| left as code:", len(set(missing)), set(missing))
print("fonts inlined:", len(fonts), "| final size kb:", len(s.encode()) // 1024)
