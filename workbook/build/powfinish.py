import json, re
raw = open("powpage.raw", encoding="utf-8").read()
rendered = json.load(open("powtexhtml.json", encoding="utf-8"))
katexcss = open("katexcss.txt", encoding="utf-8").read()
out, n = re.subn("\x00TEX(\d+)\x00", lambda m: '<span class="tex">' + rendered[int(m.group(1))] + "</span>", raw)
assert "\x00" not in out
out = out.replace("</style>", "</style>\n<style>" + katexcss + "</style>", 1)
open("powpage.html", "w", encoding="utf-8").write(out)
print("substituted:", n, "| katex:", out.count('class="katex"'), "| kb:", len(out.encode()) // 1024)
