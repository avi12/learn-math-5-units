import json, re

raw = open("eqpage.raw", encoding="utf-8").read()
rendered = json.load(open("eqtexhtml.json", encoding="utf-8"))
katexcss = open("katexcss.txt", encoding="utf-8").read()


def sub(m):
    i = int(m.group(1))
    return '<span class="tex">' + rendered[i] + "</span>"


out, n = re.subn("\x00TEX(\\d+)\x00", sub, raw)
assert "\x00" not in out, "placeholder left behind"

# splice the KaTeX stylesheet in after the page's own styles
out = out.replace("</style>", "</style>\n<style>" + katexcss + "</style>", 1)
open("eqpage.html", "w", encoding="utf-8").write(out)
print("substituted:", n, "| katex spans:", out.count('class="katex"'),
      "| size kb:", len(out.encode()) // 1024)
