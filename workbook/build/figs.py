"""Draw the figure for every tier-3 question that needs one.

A bagrut geometry question always ships with a סרטוט. The workbook had none:
the equations were rendered in KaTeX but the shapes existed only in prose, which
makes the question harder than the real thing and in a way the exam never tests.

The figures are drawn here from the question's OWN data — never traced from the
paper — and use only design tokens, so they inverse with the theme. RTL rules
from CLAUDE.md apply: text-anchor is always "middle" (start/end swap meaning
under direction:rtl) and Latin labels carry an explicit direction="ltr".

Which blocks get one is not a matter of taste — it is what the paper does. Scanning
the fourth chapter of all nine 35571 papers: an investigation question never ships a
sketch, it *asks* for one ("סרטטו סקיצה", 22 times against 6 printed); it is printed only when
the question is about a graph that is handed to you — which in this chapter is the
area question. So 10 gets a figure and 07 does not.

Run: python build/figs.py [target.html] && python build/skin.py workbook.html
The target defaults to pages/workbook.html; pass pages/workbook.base.html to keep the
rebuild base in step, or the next rebuild resurrects the figure-less version.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "pages" / "workbook.html"

FG, MUT, LINE = "var(--on-surface)", "var(--on-surface-var)", "var(--outline)"
ACC = "var(--primary)"


def lbl(x, y, t, size=15, colour=None, bold=True, ltr=True):
    return ('<text x="%s" y="%s" text-anchor="middle" font-size="%s"%s%s fill="%s">%s</text>'
            % (x, y, size, ' font-weight="700"' if bold else "",
               ' direction="ltr"' if ltr else "", colour or FG, t))


# ---------------------------------------------------------------------------
# 05 - circle on diameter AB, C on the circle, CD perpendicular to AB.
# Drawn to the question's own numbers: AD=4, DB=9, so AB=13, r=6.5 and CD=6.
# 20 px per unit; O=(350,160), r=130; C=(300,40) really does sit on the circle.
def fig05():
    s = ['<svg viewBox="0 0 700 300" role="img" aria-label="מעגל שקוטרו AB, הנקודה C על המעגל והאנך CD">']
    s.append('<circle cx="350" cy="160" r="130" fill="none" stroke="%s" stroke-width="2"/>' % LINE)
    s.append('<line x1="220" y1="160" x2="480" y2="160" stroke="%s" stroke-width="2.5"/>' % FG)
    s.append('<line x1="220" y1="160" x2="300" y2="40" stroke="%s" stroke-width="2.5"/>' % FG)
    s.append('<line x1="300" y1="40" x2="480" y2="160" stroke="%s" stroke-width="2.5"/>' % FG)
    s.append('<line x1="300" y1="40" x2="300" y2="160" stroke="%s" stroke-width="2.5"/>' % ACC)
    s.append('<path d="M300 142 H318 V160" fill="none" stroke="%s" stroke-width="2"/>' % MUT)
    for x, y in ((350, 160), (220, 160), (480, 160), (300, 160), (300, 40)):
        s.append('<circle cx="%d" cy="%d" r="4" fill="%s"/>' % (x, y, FG))
    s.append(lbl(206, 186, "A")); s.append(lbl(494, 186, "B"))
    s.append(lbl(350, 186, "O", colour=MUT)); s.append(lbl(297, 186, "D"))
    s.append(lbl(300, 26, "C"))
    s.append(lbl(255, 155, "4", 13, MUT)); s.append(lbl(392, 155, "9", 13, MUT))
    s.append("</svg>")
    return "\n          ".join(s)


# ---------------------------------------------------------------------------
# 06 - rhombus ABCD, side a, apex angle 2*alpha at A. Schematic, as the exam
# draws it: the numbers arrive later in the question, so it is not to scale.
def fig06():
    A, B, C, D = (170, 160), (350, 60), (530, 160), (350, 260)
    s = ['<svg viewBox="0 0 700 320" role="img" aria-label="מעוין ABCD עם הזווית 2 אלפא בקדקוד A">']
    s.append('<polygon points="%d,%d %d,%d %d,%d %d,%d" fill="none" stroke="%s" stroke-width="2.5"/>'
             % (A + B + C + D + (FG,)))
    s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2.5" stroke-dasharray="7 5"/>'
             % (B + D + (ACC,)))
    s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2" stroke-dasharray="7 5"/>'
             % (A + C + (LINE,)))
    s.append('<path d="M214 135 A 50 50 0 0 1 214 185" fill="none" stroke="%s" stroke-width="2"/>' % ACC)
    for x, y in (A, B, C, D):
        s.append('<circle cx="%d" cy="%d" r="4" fill="%s"/>' % (x, y, FG))
    s.append(lbl(154, 166, "A")); s.append(lbl(350, 44, "B"))
    s.append(lbl(546, 166, "C")); s.append(lbl(350, 282, "D"))
    s.append(lbl(248, 100, "a", 14, MUT)); s.append(lbl(452, 100, "a", 14, MUT))
    s.append(lbl(248, 228, "a", 14, MUT)); s.append(lbl(452, 228, "a", 14, MUT))
    s.append('<text x="252" y="148" text-anchor="middle" font-size="14" font-weight="700" fill="%s">2&#945;</text>' % ACC)
    s.append("</svg>")
    return "\n          ".join(s)


# ---------------------------------------------------------------------------
# 09 - the hyperbola f(x)=12/x with the tangent at x=t and the triangle it cuts
# off the axes. Drawn at t=3, so P=(6,0) and Q=(0,8) - the same relations the
# question asks about, at one concrete value.
def fig09():
    ox, oy, sx, sy = 100, 320, 60, 30          # origin and px per unit

    def px(x, y):
        return ox + x * sx, oy - y * sy

    pts = []
    x = 1.55
    while x <= 8.4:
        pts.append("%.1f,%.1f" % px(x, 12 / x))
        x += 0.25
    s = ['<svg viewBox="0 0 700 380" role="img" '
         'aria-label="גרף הפונקצייה 12 חלקי x, המשיק בנקודה t והמשולש OPQ">']
    qx, qy = px(0, 8)
    ppx, ppy = px(6, 0)
    s.append('<polygon points="%d,%d %.1f,%.1f %.1f,%.1f" fill="var(--accent-tint)"/>'
             % (ox, oy, qx, qy, ppx, ppy))
    s.append('<line x1="%d" y1="%d" x2="640" y2="%d" stroke="%s" stroke-width="2"/>' % (ox, oy, oy, LINE))
    s.append('<line x1="%d" y1="%d" x2="%d" y2="40" stroke="%s" stroke-width="2"/>' % (ox, oy, ox, LINE))
    s.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="2.5"/>' % (" ".join(pts), FG))
    s.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2.5"/>'
             % (qx, qy, ppx, ppy, ACC))
    tx, ty = px(3, 4)
    s.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%d" stroke="%s" stroke-width="1.5" stroke-dasharray="5 4"/>'
             % (tx, ty, tx, oy, MUT))
    for cx, cy in ((qx, qy), (ppx, ppy), (tx, ty), (ox, oy)):
        s.append('<circle cx="%.1f" cy="%.1f" r="4.5" fill="%s"/>' % (cx, cy, FG))
    s.append(lbl(qx - 20, qy + 5, "Q")); s.append(lbl(ppx, ppy + 26, "P"))
    s.append(lbl(ox - 20, oy + 22, "O", colour=MUT))
    s.append(lbl(tx, ty - 14, "t", 14, ACC))
    s.append(lbl(632, oy + 24, "x", 14, MUT)); s.append(lbl(ox - 18, 44, "y", 14, MUT))
    s.append(lbl(520, 120, "f(x) = 12 / x", 14, MUT, bold=False))
    s.append("</svg>")
    return "\n          ".join(s)


# ---------------------------------------------------------------------------
# 10 - the parabola f(x)=4-x^2 and the line g(x)=x+2 of the tier-3 question.
# This is the one calculus figure the paper really does print: question 8 hands
# you the graphs and asks for the area. Deliberately without a grid, numbers or
# point coordinates - the whole trap of this block is that the intersections
# must be solved for and never read off the drawing.
def fig10():
    ox, oy, sx, sy = 350, 265, 80, 45          # origin and px per unit

    def px(x, y):
        return ox + x * sx, oy - y * sy

    par = []
    x = -2.4
    while x <= 2.401:
        par.append("%.1f,%.1f" % px(x, 4 - x * x))
        x += 0.15
    s = ['<svg viewBox="0 0 700 380" role="img" '
         'aria-label="הפרבולה 4 פחות x בריבוע והישר x ועוד 2, ושתי נקודות החיתוך שלהם">']
    s.append('<line x1="78" y1="%d" x2="638" y2="%d" stroke="%s" stroke-width="2"/>' % (oy, oy, LINE))
    s.append('<line x1="%d" y1="40" x2="%d" y2="365" stroke="%s" stroke-width="2"/>' % (ox, ox, LINE))
    s.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="2.5"/>' % (" ".join(par), FG))
    s.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2.5"/>'
             % (px(-3.3, -1.3) + px(2.9, 4.9) + (ACC,)))
    for cx, cy in (px(1, 3), px(-2, 0)):
        s.append('<circle cx="%.1f" cy="%.1f" r="4.5" fill="%s"/>' % (cx, cy, FG))
    s.append(lbl(600, 332, "f(x) = 4 &#8722; x&#178;", 14, MUT, bold=False))
    s.append(lbl(470, 46, "g(x) = x + 2", 14, ACC, bold=False))
    s.append(lbl(632, oy + 24, "x", 14, MUT)); s.append(lbl(ox - 18, 44, "y", 14, MUT))
    s.append("</svg>")
    return "\n          ".join(s)


FIGS = {"05": fig05(), "06": fig06(), "09": fig09(), "10": fig10()}

s = P.read_text(encoding="utf-8")
idx = [m.start() for m in re.finditer(r'class="block"', s)]
idx.append(s.find('<p class="foot"'))
done = []
for a, b in reversed(list(zip(idx, idx[1:]))):
    seg = s[a:b]
    num = re.search(r'class="bnum">(.*?)<', seg).group(1)
    if num not in FIGS:
        continue
    m = re.search(r'<div class="rung r3">[\s\S]*?(?=<div class="srcline">)', seg)
    assert m, "no tier-3 rung in block " + num
    block = '        <div class="qfig">\n          %s\n        </div>\n        ' % FIGS[num]
    # idempotent: drop a figure written by an earlier run before inserting
    body = re.sub(r'        <div class="qfig">[\s\S]*?</div>\n        ', "", m.group(0))
    s = s[:a + m.start()] + body + block + s[a + m.end():]
    done.append(num)

P.write_text(s, encoding="utf-8")
print("figures drawn into blocks:", ", ".join(sorted(done)))
