import json, re, html
th = json.load(open("plthumbs.json", encoding="utf-8"))
cards = [
    ("PLIhyVMxlQ9lJWbbd9vKGFIkJ4kZyozchp", "קורס מלא · כיתה י",
     "כל הבסיס של 571: טכניקה אלגברית, קדם אנליזה, גאומטריה מישורית וטריגונומטריה. המקור לבלוקים 1, 5 ו‑6."),
    ("PLIhyVMxlQ9lLdsUCY30ceB051O4oNZVhX", "קורס מלא · כיתה יא",
     "המשך 571: סדרות, אינדוקציה, הסתברות וחשבון דיפרנציאלי ואינטגרלי. המקור לבלוקים 2, 3, 4 ו‑7 עד 10."),
    ("PLejElsCmvhTDb4h2_HAzQxWatSwqz0zsn", "פתרונות וידאו · קיץ 2026",
     "פתרון מלא בווידאו לשאלון שאתה שומר כמתכונת. פתח רק אחרי שכתבת מתכונת מלאה בתנאי אמת."),
    ("PLIhyVMxlQ9lLJRoWMSkVuSSPA-te0B691", "מאוחר יותר · שאלון 572",
     "הקורס לשאלון השני — הנדסה אנליטית, וקטורים, מרוכבים, מעריכיות ולוגריתמיות. רלוונטי מקיץ 2027."),
]
out = []
for pid, topic, cap in cards:
    d = th[pid]
    out.append(
        f'    <a class="vid" href="https://www.youtube.com/playlist?list={pid}" target="_blank" rel="noopener">\n'
        f'      <span class="thumb"><img src="data:image/jpeg;base64,{d["b64"]}" alt="פלייליסט: {html.escape(d["title"])}" loading="lazy">'
        f'<span class="play">פלייליסט</span></span>\n'
        f'      <span class="meta">\n'
        f'        <span class="who">{topic} &#183; {html.escape(d["author"])}</span>\n'
        f'        <span class="vt">{html.escape(d["title"])}</span>\n'
        f'        <span class="cap">{cap}</span>\n'
        f'      </span>\n'
        f'    </a>')
s = open("workbook.html", encoding="utf-8").read()
assert "<!--SOURCE_CARDS-->" in s
s = s.replace("<!--SOURCE_CARDS-->", "\n".join(out))
open("workbook.html", "w", encoding="utf-8").write(s)
print("cards:", len(out), "| kb:", len(s.encode()) // 1024)
