"""Replace the three tier-3 questions that stayed too close to their source paper.

Audit of all nine tier-3 questions against the cited papers found:
  04 הסתברות     - same story as 35571 2025 moed B Q3 (packing house, two fruits, export)
  06 טריגונומטריה - same figure, labels and 2-alpha notation as 2025 moed A Q5, and it
                    also drew on 35571 summer 2026, which is reserved as a mock exam
  07 נגזרת        - f(x) = (x^2 - a^2)/x is the OPENING OF 2025 moed A Q6 VERBATIM
The other six are genuinely re-imagined and are left alone.

Each replacement keeps the character (same techniques, same rung structure, same
20 minutes) and changes the object: a different scenario, a different figure, a
different function. Answers verified in sympy - see the module docstring numbers.

Run: python build/fixq.py && python build/skin.py workbook.html
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(sys.argv[1]) if len(sys.argv) > 1 else None
NE = "\\mathrel{\\char`≠}"          # \ne is broken in KaTeX 0.18 with inlined fonts

RLABEL = ('<span class="rlabel">מדרגה 3 · רמת בגרות <span class="pips">'
          '<i class="on"></i><i class="on"></i><i class="on"></i></span> 20 דקות</span>')


def src(text, url):
    return ('<div class="srcline"><span style="opacity:.75">%s</span>'
            '<a class="pdf" href="%s">השאלון המקורי ↗</a></div>' % (text, url))


# ---------------------------------------------------------------------------
# 04 - probability. New scenario: a laptop assembly line, two models, extended
# QA check. Same technique chain: p from a with-replacement pair, total
# probability, Bayes, binomial.
# sympy: p=2/5, P(check)=0.42, P(basic|check)=2/7, C(5,2)*.42^2*.58^3=0.3442
Q04 = """      <div class="rung r3">
        {RLABEL}
        <p class="q">מפעל מרכיב שני דגמי מחשבים ניידים בלבד: דגם בסיסי ודגם מתקדם. ההסתברות לבחור באקראי
        שני מחשבים מן הדגם המתקדם (בחירה עם החזרה) היא ⟦0.16⟧.</p>
        <p class="q"><b>א.</b> מצאו את ההסתברות שמחשב אקראי הוא מן הדגם המתקדם.</p>
        <p class="q">נתון עוד כי 75% מן המחשבים המתקדמים עוברים בדיקת איכות מורחבת, ומן הבסיסיים — 20% בלבד.</p>
        <p class="q"><b>ב.</b> מהי ההסתברות שמחשב אקראי עובר בדיקת איכות מורחבת? &nbsp;&nbsp;
        <b>ג.</b> נבחר מחשב והתברר שהוא עבר בדיקה מורחבת. מהי ההסתברות שהוא מן הדגם הבסיסי?</p>
        <p class="q"><b>ד.</b> בוחרים ⟦5⟧ מחשבים באקראי (עם החזרה). מהי ההסתברות שבדיוק שניים מהם
        עברו בדיקת איכות מורחבת?</p>
        {SRC}
      </div>""".replace("{RLABEL}", RLABEL).replace(
    "{SRC}", src("נבנתה בהשראת שאלה 3, שאלון 35571 קיץ 2025 מועד ב&rsquo;",
                 "https://meyda.education.gov.il/sheeloney_bagrut/2025/8/HEB/35571.pdf"))

# ---------------------------------------------------------------------------
# 06 - trigonometry. The isosceles triangle with apex 2alpha was the source's
# own figure, so the figure changes to a rhombus. Same chain: express a
# diagonal, express the area, two solutions for the angle, then a length.
# sympy: BD=2a sin(alpha), area=a^2 sin(2alpha), 2alpha in {30,150},
#        AC = 4*sqrt(6)-4*sqrt(2) = 4.1411, and AC*BD/2 = 32 checks out.
Q06 = """      <div class="rung r3">
        {RLABEL}
        <p class="q">במעוין ⟦ABCD⟧ אורך כל צלע הוא ⟦a⟧, והזווית שבקדקוד ⟦A⟧ היא ⟦\\angle DAB = 2\\alpha⟧.</p>
        <p class="q"><b>א.</b> הראו כי אורך האלכסון ⟦BD⟧ הוא ⟦2a\\sin\\alpha⟧. &nbsp;&nbsp;
        <b>ב.</b> הביעו באמצעות ⟦a⟧ ו־⟦\\alpha⟧ את שטח המעוין.</p>
        <p class="q">נתון ⟦a = 8⟧ ושטח המעוין הוא 32.</p>
        <p class="q"><b>ג.</b> מצאו את שני הערכים האפשריים של ⟦2\\alpha⟧ בתחום ⟦0^{\\circ} < 2\\alpha < 180^{\\circ}⟧.</p>
        <p class="q"><b>ד.</b> עבור הערך <b>הגדול</b> מבין השניים, מצאו את אורך האלכסון ⟦AC⟧.</p>
        {SRC}
      </div>""".replace("{RLABEL}", RLABEL).replace(
    "{SRC}", src("נבנתה בהשראת שאלה 5, שאלון 35571 קיץ 2025 מועד א&rsquo;",
                 "https://meyda.education.gov.il/sheeloney_bagrut/2025/6/HEB/35571.pdf"))

# ---------------------------------------------------------------------------
# 07 - the violation. (x^2-a^2)/x was the source's function verbatim. New
# function, and the structure is inverted: here f HAS extrema and h has none.
# sympy: f'=1-p^2/x^2, extrema (p,2p) min and (-p,-2p) max, h'=-p^2/x^2-1<0,
#        distance 2*sqrt(5)*p = 10 -> p = sqrt(5).
Q07 = """      <div class="rung r3">
        {RLABEL}
        <p class="q">נתונה הפונקצייה ⟦f(x)=x+\\dfrac{p^{2}}{x}⟧, המוגדרת לכל ⟦x NE 0⟧,
        כאשר ⟦p⟧ הוא פרמטר חיובי.</p>
        <p class="q"><b>א.</b> מצאו את משוואת האסימפטוטה האנכית ואת משוואת האסימפטוטה המשופעת של ⟦f(x)⟧.</p>
        <p class="q"><b>ב.</b> מצאו את שיעורי נקודות הקיצון של ⟦f(x)⟧ וקבעו את סוגן. הביעו באמצעות ⟦p⟧.</p>
        <p class="q">נתונה הפונקצייה ⟦h(x) = f(x) - 2x⟧.</p>
        <p class="q"><b>ג.</b> הוכיחו כי ל־⟦h(x)⟧ אין נקודות קיצון כלל, לכל ערך של ⟦p⟧.</p>
        <p class="q"><b>ד.</b> נתון כי המרחק בין שתי נקודות הקיצון של ⟦f(x)⟧ הוא 10. מצאו את ⟦p⟧.</p>
        {SRC}
      </div>""".replace("{RLABEL}", RLABEL).replace("NE", NE).replace(
    "{SRC}", src("נבנתה בהשראת שאלה 6, שאלון 35571 חורף 2026",
                 "https://meyda.education.gov.il/sheeloney_bagrut/2026/1/HEB/35571.pdf"))

# ---------------------------------------------------------------------------
# 09 - extremum. Found by build/qsim.py, not by the citation check: the old
# question mirrored 35571 summer 2026 moed A Q8 sentence for sentence (root
# function + line, domain, two intersections, vertical segment AB, maximise) -
# and that paper is reserved as a mock exam. New object: a tangent to a
# hyperbola and the triangle it cuts off the axes.
# sympy: tangent y = 12(2t-x)/t^2, P=(2t,0), Q=(0,24/t), area = 24 for every t,
#        PQ^2 = 4(t^4+144)/t^2, minimal at t = 2*sqrt(3), PQ = 4*sqrt(6).
Q09 = """      <div class="rung r3">
        {RLABEL}
        <p class="q">נתונה הפונקצייה ⟦f(x)=\dfrac{12}{x}⟧ בתחום ⟦x > 0⟧. בנקודה שעל הגרף ששיעור ה־⟦x⟧ שלה הוא ⟦t⟧
        מעבירים משיק לגרף. המשיק חותך את ציר ה־⟦x⟧ בנקודה ⟦P⟧ ואת ציר ה־⟦y⟧ בנקודה ⟦Q⟧.</p>
        <p class="q"><b>א.</b> מצאו את משוואת המשיק. הביעו באמצעות ⟦t⟧. &nbsp;&nbsp;
        <b>ב.</b> מצאו את שיעורי הנקודות ⟦P⟧ ו־⟦Q⟧.</p>
        <p class="q"><b>ג.</b> הוכיחו כי שטח המשולש ⟦OPQ⟧ אינו תלוי כלל ב־⟦t⟧, ומצאו אותו.</p>
        <p class="q"><b>ד.</b> מצאו את הערך של ⟦t⟧ שעבורו אורך הקטע ⟦PQ⟧ הוא מינימלי, ואת האורך המינימלי.</p>
        {SRC}
      </div>""".replace("{RLABEL}", RLABEL).replace(
    "{SRC}", src("נבנתה בהשראת שאלה 8, שאלון 35571 חורף 2025",
                 "https://meyda.education.gov.il/sheeloney_bagrut/2025/1/HEB/35571.pdf"))
NEW = {"04": Q04, "06": Q06, "07": Q07, "09": Q09}

# --------------------------------------------------------- render the math --
tex = {}
for html in NEW.values():
    for t in re.findall(r"⟦(.*?)⟧", html):
        tex[t] = t
work = SCRATCH or ROOT / "build"
(work / "fixq_tex.json").write_text(json.dumps(tex, ensure_ascii=False), encoding="utf-8")
js = """import katex from "katex";
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
"""
(work / "fixq_render.mjs").write_text(js, encoding="utf-8")
subprocess.run(["node", str(work / "fixq_render.mjs"),
                str(work / "fixq_tex.json"), str(work / "fixq_html.json")],
               cwd=str(work), check=True)
rendered = json.loads((work / "fixq_html.json").read_text(encoding="utf-8"))
assert len(rendered) == len(tex), "some formula failed to render"

# ------------------------------------------------------------ splice it in --
P = ROOT / "pages" / "workbook.html"
s = P.read_text(encoding="utf-8")
idx = [m.start() for m in re.finditer(r'class="block"', s)]
idx.append(s.find('<p class="foot"'))
spans = [(a, b) for a, b in zip(idx, idx[1:])]

done = []
for a, b in reversed(spans):
    seg = s[a:b]
    num = re.search(r'class="bnum">(.*?)<', seg).group(1)
    if num not in NEW:
        continue
    m = re.search(r'      <div class="rung r3">[\s\S]*?\n      </div>', seg)
    assert m, "rung r3 not found in block " + num
    html = re.sub(r"⟦(.*?)⟧", lambda mm: '<span class="tex">' + rendered[mm.group(1)] + "</span>", NEW[num])
    s = s[:a + m.start()] + html + s[a + m.end():]
    done.append(num)

P.write_text(s, encoding="utf-8")
print("rewrote tier-3 in blocks:", ", ".join(sorted(done)))
print("formulas rendered:", len(rendered))
