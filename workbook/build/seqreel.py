# -*- coding: utf-8 -*-
"""Build the narrated animation reel that opens block 02 — סדרות.

  python build/seqreel.py [target.html]      # default pages/workbook.html
  python build/seqreel.py pages/workbook.base.html

WHY IT EXISTS. Avi could not follow the playlist that used to lead the block — a technique
course that drills without handing over a frame of mind — so the block opens with six
scenes of our own instead. The first cut of them was still too abstract (*"אני עדיין לא
מצליח להבין את הלך הרוח, מה הרעיון מאחורי ואיך לגשת לתרגילים"*), and this is the rewrite:
one exercise is solved from the first line to the last, and the same skeleton is then
shown under a second story. What a reader takes away is a procedure they have watched run,
not a description of one. The playlist stays underneath as drill, which it is good at.

THE WHOLE IDEA, IN THE ORDER THE SCENES SAY IT:
  1  a geometric sequence IS two numbers — where it starts, and what it multiplies by
  2  every sentence of a question turns into one equation in those two
  3  two equations, one unknown is wiped out, and the quotient falls out
  4  a different-looking question has the same skeleton — only the wipe-out changes
  5  the one condition that costs points when it is not written
  6  the four steps and the four guards, on one card

The six scripts are this file's real content. `data-narrate` is the script for the ear and
the `[[cue]]` markers in it sit right before the words that introduce a part; the matching
`data-cue` elements light up exactly then, so two generic CSS rules choreograph all six
scenes. With the Edge Read Aloud extension installed the page speaks live; run the
`narrate` CLI over the published file and the recording is baked in for everyone else.
Either way every scene is complete at rest — nothing is hidden waiting for a voice, parts
are only dimmed while a card is actually narrating.

WHAT THE SCENES MAY SAY. Geometric only: סדרה חשבונית is on the תשפ"ז not-taught list
(data/tashpaz.json), so it appears exactly once — as the thing a "יורדת" sequence is NOT.
The worked exercise is one object, ⟦a_1=3, q=2⟧, carried from scene one to scene four, and
the second story (⟦a_1=10, S=25⟧) is deliberately NOT one of the block's own exercises —
solving one of those here would spoil it.

RTL rules from CLAUDE.md hold inside the drawings: text-anchor is always "middle" (start
and end swap meaning under direction:rtl), a Latin or mathematical label carries
direction="ltr" and a Hebrew one direction="rtl", and the two are never mixed in one label
— a digit inside Hebrew is exactly what RTL reorders. A scene that needs Hebrew *and*
maths in one line is written as markup rather than as a drawing, and its formulas go in
⟦…⟧ like everywhere else in the repo: KaTeX for the page (dprender.mjs), Temml for the pad
(the `exercise-html` plugin in apps/web/vite.config.ts renders the exported copy).

Runs on BOTH pages, like figs.py and addvids.py: the reel lives in the markup, and a
rebuild that starts from an un-reeled base would drop it. Idempotent — it replaces what it
wrote last time, so it can follow any rebuild.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
TARGET = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "pages" / "workbook.html"
if not TARGET.exists():                      # `workbook/pages/x` from the repo root, or
    TARGET = ROOT / TARGET                   # `pages/x` from workbook/ — both work

CSS_BEG, CSS_END = "/* SEQREEL:CSS:BEGIN */", "/* SEQREEL:CSS:END */"
HTML_BEG, HTML_END = "<!-- SEQREEL:BEGIN -->", "<!-- SEQREEL:END -->"
PASS_BEG = "/* CYBERSKIN:PASS:BEGIN */"
BLOCK = "02"                                 # סדרות, in the workbook and in the pad alike
ANCHOR = '    <div class="blockvids">'       # the first thing inside the block


# --------------------------------------------------------------- svg helpers ---
def chamf(x, y, w, h, c=9):
    """The skin's corner cut as a path — clip-path cannot be used per SVG element."""
    return f"M{x + c} {y} H{x + w} V{y + h - c} L{x + w - c} {y + h} H{x} V{y + c} Z"


def box(x, y, w, h, cls="sv-box", c=9, cue=None):
    return (f'<path class="{cls}" d="{chamf(x, y, w, h, c)}"'
            + (f' data-cue="{cue}"' if cue else "") + "/>")


def txt(x, y, s, cls="", size=16, rtl=False, cue=None, anchor="middle"):
    """One label. Hebrew or Latin — never both, so nothing is left for bidi to reorder."""
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" '
            f'direction="{"rtl" if rtl else "ltr"}"'
            + (f' class="{cls}"' if cls else "")
            + (f' data-cue="{cue}"' if cue else "") + f">{s}</text>")


def arrow(x1, y1, x2, y2, mid, cue=None):
    return (f'<line class="sv-wire" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'marker-end="url(#{mid})"' + (f' data-cue="{cue}"' if cue else "") + "/>")


def defs(mid):
    return (f'<defs><marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path class="sv-head" d="M0 0 L10 5 L0 10 z"/></marker></defs>')


def mtxt(x, y, w, h, tex, size=20, cls="", cue=None):
    """A real formula inside a drawing — Avi: *"מוטב לכתוב את השבר עם LaTeX, גם אם הנוסחה
    בתוך SVG"*.

    SVG text has no fractions, no stacked exponents and no cancel stroke, so a formula
    drawn with it is a transcription of maths rather than maths. A `foreignObject` puts
    the page's own renderer inside the drawing instead — KaTeX on the workbook page,
    Temml in the pad — and because its CSS pixels are SVG user units, the formula scales
    with the viewBox exactly like every label beside it. The ⟦…⟧ is rendered by the same
    pass as the captions, so there is still one renderer per target.

    The box is the formula's own; the content is centred in it (`.fo`), so `w`/`h` only
    have to be roomy — `overflow: visible` keeps a formula that outgrows them readable.
    """
    return (f'<foreignObject x="{x}" y="{y}" width="{w}" height="{h}"'
            + (f' data-cue="{cue}"' if cue else "") + ">"
            f'<div xmlns="http://www.w3.org/1999/xhtml" class="fo {cls}" '
            f'style="font-size:{size}px">⟦{tex}⟧</div></foreignObject>')


def svg(w, h, label, body):
    return (f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{label}">\n        '
            + "\n        ".join(body) + "\n      </svg>")


# ------------------------------------------------------------------- scene 1 ---
# The idea, before any technique: the whole sequence is two numbers, and a formula that
# jumps to any place without walking there.
VALUES = (3, 6, 12, 24, 48)


def scene1():
    s = [defs("s1h")]
    s.append(txt(165, 22, "מאיפה מתחילים", "sv-note", 15, rtl=True, cue="two"))
    s.append(box(60, 32, 210, 58, cue="two"))
    s.append(mtxt(60, 32, 210, 58, "a_{1}=3", 26, cue="two"))
    s.append(txt(435, 22, "בכמה כופלים כל פעם", "sv-note", 15, rtl=True, cue="two"))
    s.append(box(330, 32, 210, 58, cue="two"))
    s.append(mtxt(330, 32, 210, 58, "q=2", 26, cue="two"))
    s.append(arrow(300, 96, 300, 124, "s1h", cue="row"))
    w, gap, top = 86, 24, 132
    xs = [37 + i * (w + gap) for i in range(5)]
    for x, v in zip(xs, VALUES):
        s.append(box(x, top, w, 52, cue="row"))
        s.append(txt(x + w / 2, top + 35, str(v), "sv-v", 23, cue="row"))
    for x in xs[:-1]:
        s.append(arrow(x + w + 3, top + 26, x + w + gap - 5, top + 26, "s1h", cue="row"))
    s.append(txt(580, top + 35, "…", "sv-m", 23, cue="row"))
    s.append(txt(300, 208, "כל חץ הוא כפל במנה — וכך עד אין־סוף", "sv-note", 15,
                 rtl=True, cue="row"))
    s.append(txt(300, 240, "ואפשר גם בלי ללכת צעד־צעד", "sv-note", 15, rtl=True, cue="jump"))
    s.append(box(150, 250, 300, 48, "sv-box-a", cue="jump"))
    s.append(mtxt(150, 250, 300, 48, "a_{n}=3\\cdot 2^{\\,n-1}", 22, cue="jump"))
    return svg(600, 308,
               "שני תאים — האיבר הראשון והמנה — ומתחתם הסדרה כולה נפרשת, ונוסחה שקופצת "
               "לאיבר רחוק בלי לעבור בכל הקודמים", s)


# ------------------------------------------------------------------- scene 2 ---
# Reading a question. Markup, not a drawing: every line is Hebrew *and* maths.
#
# NO ARROW GLYPH HERE. A page in Hebrew runs two directions at once — the prose right to
# left, a chain of formulas left to right, exactly as the exam notebook does — so an arrow
# between a Hebrew phrase and a formula has no honest direction to point in: pointing left
# follows the sentence and contradicts the drawings, pointing right does the reverse. The
# word כלומר carries the step instead, and the reading order carries the direction. Arrows
# are left to where both ends are the same kind: down the page (scene 1) or along a chain
# of formulas (scenes 1 and 3), where the flow is not in doubt.
READS = (
    ("”האיבר השני הוא ⟦6⟧“", "⟦a_{2}=6⟧", "⟦a_{1}q=6⟧"),
    ("”האיבר החמישי הוא ⟦48⟧“", "⟦a_{5}=48⟧", "⟦a_{1}q^{4}=48⟧"),
)


def scene2():
    rows = "\n          ".join(
        f'<li data-cue="t{i}"><span class="src">{src}</span>'
        f'<span class="arr">כלומר</span>'
        f'<span class="eq">{named}</span>'
        f'<span class="arr">כלומר</span>'
        f'<span class="eq out">{opened}</span></li>'
        for i, (src, named, opened) in enumerate(READS, start=1))
    return (f'<p class="qsrc" data-cue="q">בסדרה הנדסית, האיבר השני הוא ⟦6⟧ '
            f'והאיבר החמישי הוא ⟦48⟧. מצאו את המנה.</p>\n        '
            f'<ul class="trans">\n          {rows}\n        </ul>\n        '
            f'<p class="tnote" data-cue="count">שני נעלמים — ⟦a_{{1}}⟧ ו־⟦q⟧. שתי משוואות. '
            f'זה בדיוק מה שצריך.</p>')


# ------------------------------------------------------------------- scene 3 ---
# The solve, end to end: divide, read q off, put it back, read a₁ off.
def scene3():
    s = []
    s.append(mtxt(150, 14, 300, 40, "a_{1}q^{4}=48", 22, cue="eqs"))
    s.append(mtxt(150, 54, 300, 40, "a_{1}q=6", 22, cue="eqs"))
    # one formula, not a drawing of one: \cancel strikes a₁ out where it actually stands
    s.append(mtxt(20, 108, 400, 96,
                  r"\dfrac{a_{5}}{a_{2}}=\dfrac{\cancel{a_{1}}\,q^{4}}"
                  r"{\cancel{a_{1}}\,q}=q^{3}=8", 24, cue="divide"))
    s.append(box(436, 130, 140, 52, "sv-box-a", cue="divide"))
    s.append(mtxt(436, 130, 140, 52, "q=2", 24, "fo-a", cue="divide"))
    s.append(mtxt(100, 212, 400, 44, r"a_{1}\cdot 2=6\ \Rightarrow\ a_{1}=3", 22,
                  cue="back"))
    s.append(box(170, 262, 260, 50, "sv-box-a", cue="done"))
    s.append(mtxt(170, 262, 260, 50, r"a_{1}=3\,,\ q=2", 22, "fo-a", cue="done"))
    s.append(txt(300, 342, "ועכשיו אפשר לענות על כל מה שישאלו", "sv-note", 16,
                 rtl=True, cue="done"))
    return svg(600, 356,
               "שתי המשוואות זו מעל זו, חלוקה שמוחקת את האיבר הראשון ומשאירה חזקה של "
               "המנה, ואז הצבה חזרה שמוציאה את האיבר הראשון", s)


# ------------------------------------------------------------------- scene 4 ---
# The same skeleton under a different story — the point of the whole reel.
TWIN = (
    ("סיפור א", "נתון ⟦a_{2}=6⟧ ו־⟦a_{5}=48⟧",
     "⟦a_{1}q=6⟧ &nbsp;·&nbsp; ⟦a_{1}q^{4}=48⟧",
     "מחלקים משוואה במשוואה, ו־⟦a_{1}⟧ נמחק", "⟦q=2⟧"),
    ("סיפור ב", "נתון ⟦a_{1}=10⟧ וסכום אין־סופי ⟦S=25⟧",
     "⟦a_{1}=10⟧ &nbsp;·&nbsp; ⟦\\dfrac{a_{1}}{1-q}=25⟧",
     "מציבים את הראשונה בשנייה, ו־⟦a_{1}⟧ נמחק", "⟦q=\\dfrac{3}{5}⟧"),
)


def scene4():
    cols = "\n          ".join(
        f'<section data-cue="{cue}"><h4>{name}</h4><p class="given">{given}</p>'
        f'<p class="eqs">{eqs}</p><p class="move">{move}</p>'
        f'<p class="out">{out}</p></section>'
        for cue, (name, given, eqs, move, out) in zip(("a", "b"), TWIN))
    return (f'<div class="twin">\n          {cols}\n        </div>\n        '
            f'<p class="tnote" data-cue="same">שני סיפורים שונים, אותו שלד — שני נעלמים, '
            f'שתי משוואות, ואחד מהם נמחק.</p>')


# ------------------------------------------------------------------- scene 5 ---
# The one condition that costs points when it is not written.
def scene5():
    # Geometry note: the limit line sits at `base - 160*unit`, and the formula that names
    # it needs a band of its own ABOVE that line — 160*0.7 = 112 below a base of 170 puts
    # the line at 58, which leaves exactly that band inside the viewBox.
    s = []
    bw, xs = 34, [60 + i * 50 for i in range(6)]
    base, unit = 170, 0.7                    # a₁=80, q=½ — the limit 160 scaled to fit
    top = base - 160 * unit
    s.append(mtxt(300, 4, 256, 48, r"S=\dfrac{a_{1}}{1-q}=160", 19, "fo-ok fo-end",
                  cue="limit"))
    s.append(f'<line class="sv-limit" x1="44" y1="{top}" x2="556" y2="{top}" data-cue="limit"/>')
    s.append(mtxt(44, 64, 150, 34, "|q|<1", 20, "fo-ok fo-start", cue="shrink"))
    run, pts = 0, []
    for i, x in enumerate(xs):
        v = 80 / (2 ** i)
        s.append(f'<rect class="sv-bar" x="{x}" y="{base - v * unit:.1f}" width="{bw}" '
                 f'height="{v * unit:.1f}" data-cue="shrink"/>')
        run += v
        pts.append((x + bw / 2, base - run * unit))
    s.append('<polyline class="sv-curve" points="'
             + " ".join(f"{x},{y:.1f}" for x, y in pts) + '" data-cue="limit"/>')
    for x, y in pts:
        s.append(f'<circle class="sv-dot" cx="{x}" cy="{y:.1f}" r="4" data-cue="limit"/>')
    s.append(f'<line class="sv-axis" x1="44" y1="{base}" x2="556" y2="{base}"/>')
    base2 = 338
    s.append(mtxt(44, 198, 150, 34, "|q|>1", 20, "fo-bad fo-start", cue="grow"))
    for i, x in enumerate(xs[:5]):
        v = min(10 * (2 ** i), 132)
        s.append(f'<rect class="sv-bar-bad" x="{x}" y="{base2 - v}" width="{bw}" '
                 f'height="{v}" data-cue="grow"/>')
    s.append(txt(xs[4] + bw / 2, 216, "⋯", "sv-bad", 24, cue="grow"))
    s.append(box(366, 234, 190, 52, "sv-box-bad", cue="guard"))
    s.append(txt(461, 266, "אין סכום אין־סופי", "sv-bad", 17, rtl=True, cue="guard"))
    s.append(f'<line class="sv-axis" x1="44" y1="{base2}" x2="556" y2="{base2}"/>')
    s.append(mtxt(26, 352, 300, 36, r"-1,\,-2,\,-4,\dots\quad q=2", 17, "fo-m",
                  cue="guard"))
    s.append(txt(430, 375, "סדרה יורדת אינה סדרה מתכנסת", "sv-note", 16, rtl=True, cue="guard"))
    return svg(600, 396,
               "למעלה מנה קטנה מאחת: העמודות מתכווצות והסכום הנצבר נעצר על קו. למטה מנה "
               "גדולה מאחת: העמודות גדלות ואין סכום", s)


# ------------------------------------------------------------------- scene 6 ---
# The card to keep: four steps, four guards. Markup, because it wraps on a phone.
STEPS = (
    ("1", "מה מחפשים", "קוראים עד הסוף ומסמנים מה השאלה מבקשת"),
    ("2", "כל נתון — משוואה", "⟦a_{k}⟧ נכתב מיד כ‑⟦a_{1}q^{\\,k-1}⟧"),
    ("3", "מוחקים נעלם", "חלוקה או הצבה, ונשאר רק ⟦q⟧"),
    ("4", "חוזרים ועונים", "מוצאים ⟦a_{1}⟧, ואז את מה שנשאל"),
)
GUARDS = (
    ("⟦q\\mathrel{\\char`≠}0⟧", "לפני כל חילוק ב‑⟦q⟧"),
    ("⟦q\\mathrel{\\char`≠}1⟧", "בנוסחת הסכום הסופי"),
    ("⟦|q|<1⟧", "בכל סכום אין־סופי"),
    ("⟦n=1,2,3,\\dots⟧", "אי־שוויון מעוגל כלפי מעלה"),
)


def scene6():
    nodes = "\n          ".join(
        f'<div class="pnode" data-cue="s{n}"><b>{n}</b><span>{title}</span>'
        f'<em>{note}</em></div>' for n, title, note in STEPS)
    guards = "\n          ".join(
        f'<li data-cue="guards"><b>{cond}</b><span>{when}</span></li>'
        for cond, when in GUARDS)
    return (f'<div class="pipe">\n          {nodes}\n          '
            f'<span class="pkt" aria-hidden="true"></span>\n        </div>\n        '
            f'<ul class="guards">\n          {guards}\n        </ul>')


# ------------------------------------------------------------------- scene 7 ---
# Act two starts here: where each formula comes from. Avi: *"אני רוצה גם הסבר של מה עומד
# מאחורי, למה הנוסחאות הן ככה וככה, איך הגיעו לכל דבר"* — so nothing below is stated, it
# is derived on screen, and a formula that was derived does not have to be remembered.
def scene7():
    s = [defs("s7h")]
    w, gap, top = 86, 24, 60
    xs = [37 + i * (w + gap) for i in range(5)]
    for i, (x, v) in enumerate(zip(xs, VALUES), start=1):
        s.append(txt(x + w / 2, 44, str(i), "sv-n", 14, cue="places"))
        s.append(box(x, top, w, 52, cue="places"))
        s.append(txt(x + w / 2, top + 35, str(v), "sv-v", 23, cue="places"))
    for i, x in enumerate(xs[:-1], start=1):
        s.append(arrow(x + w + 3, top + 26, x + w + gap - 5, top + 26, "s7h", cue="steps"))
        s.append(txt(x + w + gap / 2, top + 50, str(i), "sv-a", 15, cue="steps"))
    s.append('<path class="sv-span" d="M80 132 V144 H520 V132" data-cue="steps"/>')
    s.append(txt(300, 168, "ארבעה צעדים, לא חמישה", "sv-note", 16, rtl=True, cue="steps"))
    s.append(mtxt(150, 186, 300, 40, r"a_{5}=a_{1}\,q^{4}", 22, cue="steps"))
    s.append(box(140, 238, 320, 52, "sv-box-a", cue="gen"))
    s.append(mtxt(140, 238, 320, 52, r"a_{n}=a_{1}\,q^{\,n-1}", 24, "fo-a", cue="gen"))
    s.append(txt(300, 320, "המעריך סופר צעדים, לא מקומות", "sv-note", 16, rtl=True, cue="gen"))
    return svg(600, 334,
               "מעל כל תא מספר המקום ומתחת לכל חץ מספר הצעד; סוגר מציין שבין המקום הראשון "
               "לחמישי יש ארבעה צעדים, ומכאן המעריך", s)


# ------------------------------------------------------------------- scene 8 ---
# The finite sum, derived by the multiply-and-subtract trick — the reason nobody has to
# remember which way round the formula goes.
ROW = (r"a_{1}", r"a_{1}q", r"a_{1}q^{2}", r"a_{1}q^{3}")
ROW_Q = (r"a_{1}q", r"a_{1}q^{2}", r"a_{1}q^{3}", r"a_{1}q^{4}")


def scene8():
    s, cuts, labels = [defs("s8h")], [], []
    w, h, pitch = 100, 44, 108
    labels.append(mtxt(2, 50, 26, h, "S", 17, "fo-m", cue="rowS"))
    for i, tex in enumerate(ROW):
        x = 30 + i * pitch
        s.append(box(x, 50, w, h, "sv-box-a" if i == 0 else "sv-box", cue="rowS"))
        labels.append(mtxt(x, 50, w, h, tex, 17, cue="rowS"))
    labels.append(mtxt(44, 118, 86, h, r"q\cdot S", 17, "fo-m", cue="rowqS"))
    for i, tex in enumerate(ROW_Q):
        x = 138 + i * pitch
        s.append(box(x, 118, w, h, "sv-box-a" if i == 3 else "sv-box", cue="rowqS"))
        labels.append(mtxt(x, 118, w, h, tex, 17, cue="rowqS"))
    for i in range(3):                       # the three pairs that annihilate
        x = 138 + i * pitch
        for y in (50, 118):
            cuts.append(f'<line class="sv-cut" x1="{x + 14}" y1="{y + 9}" '
                        f'x2="{x + w - 14}" y2="{y + h - 9}" data-cue="cancel"/>')
            cuts.append(f'<line class="sv-cut" x1="{x + 14}" y1="{y + h - 9}" '
                        f'x2="{x + w - 14}" y2="{y + 9}" data-cue="cancel"/>')
    s += cuts + labels
    s.append(arrow(80, 166, 80, 192, "s8h", cue="left"))
    s.append(arrow(512, 166, 512, 192, "s8h", cue="left"))
    s.append(mtxt(100, 200, 400, 40, r"S-qS=a_{1}-a_{1}q^{4}", 21, cue="left"))
    # plain parentheses, not \left( — KaTeX assembles a stretchy delimiter from its Size
    # fonts and those read as square brackets next to a one-line expression
    s.append(mtxt(100, 242, 400, 40, r"S(1-q)=a_{1}(1-q^{4})", 21, cue="result"))
    s.append(box(130, 290, 340, 66, "sv-box-a", cue="result"))
    s.append(mtxt(130, 290, 340, 66, r"S_{4}=\dfrac{a_{1}(1-q^{4})}{1-q}", 22,
                  "fo-a", cue="result"))
    # `\ne` draws an empty box with the fonts KaTeX embeds here — see CLAUDE.md
    s.append(mtxt(120, 372, 120, 34, r"q\mathrel{\char`≠}1", 17, "fo-m", cue="result"))
    s.append(txt(420, 394, "חילקנו, ולכן המנה שונה מאחת", "sv-note", 16, rtl=True,
                 cue="result"))
    return svg(600, 414,
               "שתי שורות של איברים, השנייה מוזזת מקום אחד, שלושה זוגות מתבטלים ונשארים "
               "רק האיבר הראשון והאיבר שאחרי האחרון", s)


# ------------------------------------------------------------------- scene 9 ---
# And the infinite sum is not a new formula at all — it is the finite one with the tail
# erased, which is exactly what |q|<1 buys.
def scene9():
    s = [defs("s9h")]
    s.append(mtxt(140, 10, 320, 66, r"S_{n}=\dfrac{a_{1}(1-q^{n})}{1-q}", 22,
                  cue="start"))
    s.append(mtxt(30, 92, 540, 40,
                  r"q=\tfrac{1}{2}:\quad q^{1}=0.5\quad q^{2}=0.25\quad "
                  r"q^{3}=0.125\quad \dots\quad q^{n}\to 0", 17, "fo-m", cue="tail"))
    s.append(arrow(300, 142, 300, 170, "s9h", cue="tail"))
    s.append(box(120, 180, 360, 66, "sv-box-a", cue="limit"))
    s.append(mtxt(120, 180, 360, 66,
                  r"S=\dfrac{a_{1}(1-0)}{1-q}=\dfrac{a_{1}}{1-q}", 22, "fo-a", cue="limit"))
    s.append(txt(300, 282, "הזנב נמחק רק כשהמנה בערך מוחלט קטנה מאחת", "sv-note", 16,
                 rtl=True, cue="limit"))
    return svg(600, 296,
               "נוסחת הסכום של n איברים, מתחתיה חזקות המנה שמתקרבות לאפס, ומהן הנוסחה "
               "לסכום האין־סופי", s)


# ------------------------------------------------------------------ the scenes ---
# (id, name in the tour panel, drawing or markup, spoken script, caption)
# Short sentences, plain words, every number said out loud rather than printed. Directions
# are "first / next", never "on the left", because the cards restack on a phone.
SCENES = (
    ("sq-idea", "סדרה היא שני מספרים", scene1,
     "נתחיל מהרעיון, לפני כל טכניקה. סדרה הנדסית שלמה היא שני מספרים בלבד. "
     "[[two]] מאיפה מתחילים, ובכמה כופלים בכל צעד. כאן מתחילים בשלוש, וכופלים בשתיים. "
     "[[row]] מהשניים האלה נפרשת כל הסדרה: שלוש, שש, שתים עשרה, עשרים וארבע, ארבעים ושמונה, "
     "וכך הלאה בלי סוף. "
     "[[jump]] ואם רוצים איבר רחוק, לא הולכים אליו צעד־צעד; יש נוסחה שקופצת ישר אליו. "
     "זה כל הסיפור, ולכן כל שאלה בסדרות היא בעצם חיפוש של שני המספרים האלה.",
     "סדרה הנדסית מוגדרת לגמרי על ידי ⟦a_{1}⟧ והמנה ⟦q⟧ — והנוסחה "
     "⟦a_{n}=a_{1}q^{\\,n-1}⟧ היא רק דרך מהירה לאותה הליכה."),
    ("sq-read", "מהשאלה למשוואות", scene2,
     "עכשיו, איך ניגשים לתרגיל. "
     "[[q]] זאת שאלה רגילה: נתון האיבר השני, נתון האיבר החמישי, ומבקשים את המנה. "
     "[[t1]] כל משפט בשאלה הוא משוואה אחת. האיבר השני שווה שש, כלומר האיבר הראשון כפול "
     "המנה שווה שש. "
     "[[t2]] האיבר החמישי שווה ארבעים ושמונה, כלומר האיבר הראשון כפול המנה בחזקת ארבע. "
     "שימו לב מה עשינו: כל איבר נכתב מחדש דרך אותם שני נעלמים. "
     "[[count]] ועכשיו יש שני נעלמים ושתי משוואות — וזה תמיד מספיק.",
     "התרגום הזה הוא כל ”איך לגשת“: אינדקס ⟦k⟧ נפתח מיד ל־⟦a_{1}q^{\\,k-1}⟧, "
     "וכל נתון בשאלה הופך למשוואה בשני הנעלמים."),
    ("sq-solve", "פותרים, שורה שורה", scene3,
     "ועכשיו פותרים, ויש בדיוק שני צעדים. "
     "[[eqs]] אלה שתי המשוואות שקיבלנו. "
     "[[divide]] הצעד הראשון: מחלקים אחת בשנייה. האיבר הראשון מופיע למעלה ולמטה, ולכן "
     "הוא נמחק, ונשאר רק המנה בחזקת שלוש. זה שווה שמונה, ולכן המנה היא שתיים. "
     "[[back]] הצעד השני: מציבים את שתיים בחזרה במשוואה הקצרה, ומקבלים שהאיבר הראשון הוא שלוש. "
     "[[done]] שני המספרים ביד, והשאלה נגמרה — כל מה שישאלו עכשיו הוא הצבה בנוסחה.",
     "⟦\\dfrac{a_{5}}{a_{2}}=\\dfrac{a_{1}q^{4}}{a_{1}q}=q^{3}⟧ — ⟦a_{1}⟧ מצטמצם, "
     "והמעריך הוא המרחק בין המקומות. החילוק מותר כי ⟦q\\mathrel{\\char`≠}0⟧ בסדרה הנדסית, "
     "וזה משפט שנכתב במחברת."),
    ("sq-twin", "אותו שלד, סיפור אחר", scene4,
     "וזה הדבר שכדאי לקחת מכאן. "
     "[[a]] בסיפור הראשון שתי המשוואות הן שני איברים, ואז חלוקה מוחקת את האיבר הראשון. "
     "[[b]] בסיפור השני אחד הנתונים הוא הסכום האין־סופי, ואז פשוט מציבים — ושוב האיבר "
     "הראשון נעלם. "
     "[[same]] הסיפורים נראים שונה לגמרי, אבל השלד זהה: שני נעלמים, שתי משוואות, ומחיקה "
     "של אחד מהם. ברגע שמחפשים את השלד הזה, כל שאלה בסדרות נראית אותו דבר.",
     "השלד אינו ”חלוקה“ אלא ”שני נעלמים ושתי משוואות“ — החלוקה היא רק הדרך המהירה למחוק "
     "את ⟦a_{1}⟧ כששני הנתונים הם איברים."),
    ("sq-infinite", "התנאי שעולה נקודות", scene5,
     "דבר אחד נשאר, והוא שווה נקודות. סכום אין־סופי הוא גבול, לא חיבור של הרבה מספרים. "
     "[[shrink]] כשהמנה בערך מוחלט קטנה מאחת, האיברים מתכווצים מהר. "
     "[[limit]] הסכום הנצבר, הנקודות שמעל העמודות, מתקרב לקו ולא עובר אותו. הקו הזה הוא הסכום. "
     "[[grow]] כשהמנה גדולה מאחת, האיברים רק גדלים, ואין סכום בכלל. "
     "[[guard]] לכן בכל שאלה על סכום אין־סופי כותבים במפורש שהמנה בערך מוחלט קטנה מאחת. "
     "וזה לא אותו דבר כמו סדרה יורדת: מינוס אחת, מינוס שתיים, מינוס ארבע יורדת, והמנה שלה "
     "שתיים.",
     "⟦S=\\dfrac{a_{1}}{1-q}⟧ קיים רק כאשר ⟦|q|<1⟧, מפני שאז ⟦q^{n}\\to 0⟧ והזנב נעלם. "
     "ההיתר הזה נכתב בכל שאלה — גם כשהשאלה אומרת ”יורדת“, שאינו תנאי התכנסות."),
    ("sq-card", "הכרטיס לזכור", scene6,
     "וזה הכל, על כרטיס אחד. "
     "[[s1]] קוראים עד הסוף ומסמנים מה מבקשים. "
     "[[s2]] כל נתון נכתב כמשוואה באיבר הראשון ובמנה. "
     "[[s3]] מוחקים נעלם אחד, בחלוקה או בהצבה, ומוצאים את המנה. "
     "[[s4]] חוזרים, מוצאים את האיבר הראשון, ועונים על מה שנשאל. "
     "[[guards]] ובכל פעם שמחלקים או שמשתמשים בנוסחה, כותבים משפט אחד שמתיר את זה. "
     "זה ההבדל בין תשובה נכונה ובין תשובה שמקבלת את כל הנקודות.",
     "ארבעה צעדים לכל שאלה, וארבעה שומרים שנכתבים בדרך. השומרים הם ניקוד ולא קוסמטיקה: "
     "כל אחד מהם הוא משפט אחד במחברת."),
)

# Act two: where each formula comes from. Nothing here is a fact to accept — the point is
# that a formula you have watched being built is one you can rebuild in the exam instead
# of hunting for it in the נוסחאון and guessing which way round it goes.
WHY = (
    ("sq-exp", "למה המעריך הוא n פחות אחת", scene7,
     "השאלה הראשונה ששווה לשאול על נוסחה היא למה היא נראית ככה. "
     "[[places]] למעלה מספרי המקומות: ראשון, שני, שלישי, וכן הלאה. "
     "[[steps]] ולמטה מספרי הצעדים. וכאן העיקר: מהמקום הראשון למקום החמישי יש ארבעה "
     "חצים, לא חמישה. המעריך סופר את הקפיצות, לא את התאים. "
     "[[gen]] לכן האיבר ה־n הוא האיבר הראשון כפול המנה בחזקת n פחות אחת. ומכאן גם למה "
     "האיבר הראשון יוצא נכון: אפס צעדים, המנה בחזקת אפס, כלומר אחד.",
     r"⟦a_{n}=a_{1}q^{\,n-1}⟧ — המעריך הוא מספר הקפיצות מהמקום הראשון, ולכן ⟦n-1⟧. "
     "זו גם הסיבה שהנוסחה נכונה כבר ב־⟦n=1⟧ — שם ⟦q^{0}=1⟧."),
    ("sq-derive", "מאיפה נוסחת הסכום", scene8,
     "ועכשיו נוסחת הסכום, שנראית שרירותית לגמרי עד שרואים מאיפה היא באה. "
     "[[rowS]] כותבים את הסכום כאיברים, מהראשון עד הרביעי. "
     "[[rowqS]] כופלים את כל השורה במנה. שימו לב מה קרה: כל איבר הפך לשכן שלו, והשורה "
     "כולה זזה מקום אחד ימינה. "
     "[[cancel]] ולכן, כשמחסרים שורה משורה, כל האמצע מתבטל זוג מול זוג. "
     "[[left]] נשארים רק הראשון, והאיבר שבא אחרי האחרון. "
     "[[result]] מוציאים את הסכום גורם משותף, מחלקים באחד פחות המנה, וזאת הנוסחה. "
     "חילקנו, ולכן המנה חייבת להיות שונה מאחת — זה לא תנאי שמישהו הוסיף, זה מה שהגזירה "
     "דרשה.",
     "הטריק הוא שכפל ב־⟦q⟧ מזיז את כל השורה מקום אחד, ולכן החיסור מבטל את כל האמצע. "
     r"בנוסחאון זה כתוב ⟦S_{n}=\dfrac{a_{1}(q^{n}-1)}{q-1}⟧ — אותו דבר בדיוק, אחרי "
     "הכפלה במינוס אחת במונה ובמכנה."),
    ("sq-tail", "מאיפה הסכום האין־סופי", scene9,
     "והסכום האין־סופי הוא בכלל לא נוסחה חדשה. "
     "[[start]] מתחילים מהסכום של n איברים, זה שגזרנו עכשיו. "
     "[[tail]] מסתכלים על החזקה שבתוכו. אם המנה היא חצי, החזקות הן חצי, רבע, שמינית, "
     "וכן הלאה — הן נמחקות. ככל ש־n גדל, המנה בחזקת n מתקרבת לאפס. "
     "[[limit]] מוחקים אותה מהנוסחה, ונשאר האיבר הראשון חלקי אחת פחות המנה. זה הכול. "
     "ועכשיו ברור למה התנאי הוא שהמנה בערך מוחלט קטנה מאחת: רק אז יש זנב שנמחק. אם היא "
     "גדולה מאחת, החזקה רק גדלה, ואין לאן להתכנס.",
     r"⟦S=\dfrac{a_{1}}{1-q}⟧ היא ⟦S_{n}⟧ אחרי ש־⟦q^{n}	o 0⟧ — ולכן היא קיימת בדיוק "
     "כאשר ⟦|q|<1⟧, ולא כאשר הסדרה ”יורדת“."),
)

GROUPS = (
    ("איך ניגשים לתרגיל",
     "הרעיון, תרגיל אחד מההתחלה עד הסוף, ואותו שלד בסיפור שני", SCENES),
    ("מאיפה הנוסחאות",
     "לא לשנן — לגזור. המעריך, נוסחת הסכום, והסכום האין־סופי, כל אחת נבנית על המסך", WHY),
)


# --------------------------------------------------------------------- the css ---
# CSS_CORE is everything the scenes themselves need, and it is shared: the workbook page
# inlines it and the pad imports the exported copy. CSS_PAGE is the workbook's alone.
CSS_CORE = """
/* ---- the narrated sequences reel — generated by workbook/build/seqreel.py ----
   ONE home for these rules: the workbook page inlines this block and the pad imports
   lib/seqreel.css, which is written from the same string. Do not edit either copy. */
.reel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scene {
  padding-block: 18px 15px;
  padding-inline: 18px;
  border: 2px solid var(--border);
  background: var(--surface);
  clip-path:
    polygon(
      var(--chamfer) 0,
      100% 0,
      100% calc(100% - var(--chamfer)),
      calc(100% - var(--chamfer)) 100%,
      0 100%,
      0 var(--chamfer)
    );

  > svg {
    display: block;
    width: 100%;
    height: auto;
  }

  figcaption {
    margin-block-start: 13px;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 13.5px;
    line-height: 1.7;

    b {
      color: var(--fg);
      font-weight: 400;
    }
  }

  /* the drawings' vocabulary — tokens only, so every scene inverts with the theme */
  text {
    fill: var(--fg);
    font-family: var(--font-mono);
  }

  /* a real formula inside a drawing — the page's own renderer in a foreignObject, so the
     fraction is a fraction. Its px are SVG user units, so it scales with the viewBox. */
  foreignObject {
    overflow: visible;
  }

  .fo {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    color: var(--fg);
    line-height: 1.1;
    direction: ltr;

    &.fo-start {
      justify-content: flex-start;
    }

    &.fo-end {
      justify-content: flex-end;
    }

    &.fo-a {
      color: var(--primary);
    }

    &.fo-ok {
      color: var(--ok);
    }

    &.fo-bad {
      color: var(--danger);
    }

    &.fo-m {
      color: var(--fg-muted);
    }

    .tex,
    .katex,
    math {
      color: inherit;
    }
  }
}

.sv-n {
  fill: var(--fg-subtle);
}

.sv-m,
.sv-note {
  fill: var(--fg-muted);
}

.sv-a,
.sv-head {
  fill: var(--primary);
}

.sv-v,
.sv-c {
  fill: var(--fg);
}

.sv-t {
  fill: var(--tertiary);
}

.sv-ok,
.sv-dot {
  fill: var(--ok);
}

.sv-bad {
  fill: var(--danger);
}

.sv-box {
  fill: var(--surface-2);
  stroke: var(--border);
  stroke-width: 2;
}

.sv-box-a,
.sv-bar {
  fill: var(--primary-container);
  stroke: var(--primary);
  stroke-width: 2;
}

.sv-box-bad,
.sv-bar-bad {
  fill: none;
  stroke: var(--danger);
  stroke-width: 2;
}

.sv-slot {
  fill: var(--surface);
  stroke: var(--border);
  stroke-width: 2;
}

.sv-wire {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
}

.sv-rule,
.sv-axis {
  stroke: var(--border);
  stroke-width: 2;
}

.sv-span {
  fill: none;
  stroke: var(--fg-subtle);
  stroke-width: 2;
}

.sv-cut {
  stroke: var(--danger);
  stroke-width: 2.5;
  opacity: 82%;
}

.sv-limit {
  stroke: var(--ok);
  stroke-dasharray: 7 5;
  stroke-width: 2;
}

.sv-curve {
  fill: none;
  stroke: var(--ok);
  stroke-width: 2.5;
}

/* the small chamfer: one polygon for every inner panel below */
.trans li,
.twin section,
.pnode {
  clip-path:
    polygon(
      var(--chamfer-s) 0,
      100% 0,
      100% calc(100% - var(--chamfer-s)),
      calc(100% - var(--chamfer-s)) 100%,
      0 100%,
      0 var(--chamfer-s)
    );
}

/* ---- scene 2: the question, and what each sentence becomes ------------- */
.qsrc {
  padding: 12px 15px;
  border: 2px solid var(--border);
  border-inline-start: 6px solid var(--tertiary);
  background: var(--surface-2);
  color: var(--fg);
  font-size: 15.5px;
  line-height: 1.6;
}

.trans {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-block: 12px 0;
  margin-inline: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 9px 14px;
    border: 2px solid var(--border);
    background: var(--surface-2);
  }

  .src {
    flex: 1 1 190px;
    color: var(--fg-muted);
    font-size: 14.5px;
  }

  .arr {
    color: var(--fg-subtle);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .out :is(.katex, .tex) {
    color: var(--primary);
  }
}

.tnote {
  margin-block-start: 12px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.6;
}

/* ---- scene 4: the two stories, side by side ---------------------------- */
.twin {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(248px, 1fr));
  gap: 12px;

  section {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 13px 15px;
    border: 2px solid var(--border);
    background: var(--surface-2);
  }

  h4 {
    color: var(--tertiary);
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.14em;
  }

  .given {
    color: var(--fg);
    font-size: 14.5px;
  }

  .eqs {
    color: var(--fg-muted);
    font-size: 14px;
  }

  .move {
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .out {
    margin-block-start: auto;
    padding-block-start: 7px;
    border-block-start: 2px solid var(--border);

    :is(.katex, .tex) {
      color: var(--primary);
      font-size: 1.15em;
    }
  }
}

/* ---- scene 6: the card. Markup, so it wraps on a phone ----------------- */
.pipe {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-block-start: 10px;

  &::before {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block-start: -7px;
    height: 2px;
    background: var(--border);
  }

  .pkt {
    position: absolute;
    inset-block-start: -12px;
    inset-inline-start: 0;
    width: 12px;
    height: 12px;
    background: var(--primary);
    box-shadow: var(--cyber-glow-primary);
    animation: sq-pkt 5500ms linear infinite;
  }
}

@keyframes sq-pkt {
  from {
    inset-inline-start: 0;
  }

  to {
    inset-inline-start: 100%;
  }
}

.pnode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 2px solid var(--border);
  background: var(--surface-2);

  b {
    color: var(--primary);
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.14em;
  }

  span {
    color: var(--fg);
    font-size: 14px;
    line-height: 1.4;
  }

  em {
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-style: normal;
    font-size: 11.5px;
    line-height: 1.5;
  }
}

.guards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: 8px;
  margin-block-start: 14px;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 12px;
    border: 2px solid var(--border);
    border-inline-start: 6px solid var(--warn);
    background: var(--surface);
  }

  b {
    font-weight: 400;

    /* KaTeX in the page, Temml in the pad */
    .tex {
      color: var(--warn);
    }
  }

  span {
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.45;
  }
}

/* ---- narration choreography: the voice drives the motion -------------- */
[data-narrating] [data-cue]:not([data-cue-reached]) {
  opacity: 20%;
  transition: opacity var(--dur-long) var(--ease-emph);
}

[data-cue-reached] {
  animation: sq-cue-in 600ms var(--ease-emph) both;
}

@keyframes sq-cue-in {
  from {
    opacity: 0%;
    translate: 0 7px;
  }

  to {
    opacity: 100%;
    translate: 0 0;
  }
}

[data-narrating] .pkt {
  visibility: hidden;
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .pkt {
    visibility: hidden;
    animation: none;
  }

  [data-cue-reached] {
    animation: none;
  }

  [data-narrating] [data-cue]:not([data-cue-reached]) {
    transition: none;
  }
}
"""

CSS_PAGE = """
/* ---- the workbook page's own frame around the reel -------------------- */
.reel {
  margin-block-start: 16px;
}

.reelhead {
  padding: 11px 16px;
  border: 2px solid var(--border);
  background: var(--surface-2);
  color: var(--fg-muted);
  clip-path:
    polygon(
      var(--chamfer-s) 0,
      100% 0,
      100% calc(100% - var(--chamfer-s)),
      calc(100% - var(--chamfer-s)) 100%,
      0 100%,
      0 var(--chamfer-s)
    );
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  letter-spacing: 0.05em;

  b {
    color: var(--primary);
    font-weight: 400;
  }
}

/* on a phone the drawing is what suffers so the card gives back the block's padding */
@media (width <= 620px) {
  .reel {
    margin-inline: -18px;
  }

  .scene {
    padding-block: 13px 11px;
    padding-inline: 9px;

    figcaption {
      font-size: 12.5px;
    }
  }
}
"""

CSS = CSS_CORE + CSS_PAGE


# ------------------------------------------------------------------- rendering ---
def render_tex(formulas: set) -> dict:
    """Every ⟦…⟧ through the repo's own pinned KaTeX, like every other page builder."""
    src, out = HERE / "sr_tex.json", HERE / "sr_html.json"
    src.write_text(json.dumps({f: f for f in formulas}, ensure_ascii=False), encoding="utf-8")
    r = subprocess.run(["node", str(HERE / "dprender.mjs"), str(src), str(out)],
                       cwd=str(ROOT), capture_output=True, text=True)
    sys.stderr.write(r.stderr)
    if r.returncode:
        raise SystemExit("KaTeX rejected a formula — see above")
    done = json.loads(out.read_text(encoding="utf-8"))
    missing = sorted(set(formulas) - set(done))
    if missing:
        raise SystemExit(f"formulas did not render: {missing[:3]}")
    print(f"katex       : {len(done)} formulas")
    return done


def bodies(scenes) -> list:
    """One act's scenes drawn once: (id, title, body markup, script, caption).

    A drawing may carry ⟦…⟧ only inside a foreignObject — SVG text itself has no maths —
    and that is checked here rather than discovered as a stray ⟦ on the published page.
    """
    out = []
    for sid, title, draw, script, caption in scenes:
        if '"' in script or '"' in title:
            raise SystemExit(f"{sid}: a double quote would close the attribute")
        body = draw()
        bare = re.sub(r"<foreignObject[\s\S]*?</foreignObject>", "", body)
        if bare.lstrip().startswith("<svg") and "⟦" in bare:
            raise SystemExit(f"{sid}: ⟦…⟧ outside a foreignObject — SVG text has no maths")
        for cue in re.findall(r"\[\[([\w-]+)\]\]", script):
            if f'data-cue="{cue}"' not in body:
                raise SystemExit(f"{sid}: marker [[{cue}]] has no data-cue element")
        for cue in sorted(set(re.findall(r'data-cue="([\w-]+)"', body))):
            if f"[[{cue}]]" not in script:
                raise SystemExit(f"{sid}: data-cue={cue} has no [[marker]] in the script")
        out.append((sid, title, body, script, caption))
    return out


def acts() -> list:
    """The reel as its two acts: (title, blurb, drawn scenes)."""
    return [(title, blurb, bodies(scenes)) for title, blurb, scenes in GROUPS]


def build() -> str:
    drawn = acts()
    pool = [body + " " + caption
            for _, _, scenes in drawn for _, _, body, _, caption in scenes]
    rendered = render_tex({f for t in pool for f in re.findall(r"⟦(.*?)⟧", t)})

    def math(s: str) -> str:
        return re.sub(r"⟦(.*?)⟧",
                      lambda m: '<span class="tex">' + rendered[m.group(1)] + "</span>", s)

    reels = []
    for title, blurb, scenes in drawn:
        cards = [f'      <figure class="scene" id="{sid}" data-narrate-title="{name}"\n'
                 f'        data-narrate="{script}">\n'
                 f'        {math(body)}\n'
                 f'        <figcaption>{math(caption)}</figcaption>\n'
                 f'      </figure>'
                 for sid, name, body, script, caption in scenes]
        head = (f'<p class="reelhead">סרטון מונפש · <b>{title}</b> — {blurb}. '
                f'כל סצנה מדברת.</p>')
        reels.append(f'    <div class="reel">\n      {head}\n'
                     + "\n".join(cards) + "\n    </div>")
    return f"{HTML_BEG}\n" + "\n".join(reels) + f"\n    {HTML_END}\n"


PAD = REPO / "apps" / "web" / "src" / "lib"


def export_pad() -> None:
    """The same two acts, for the pad's סדרות chapter — the one place Avi studies.

    The pad has no KaTeX: its maths is Temml, rendered at build time by the `exercise-html`
    plugin in apps/web/vite.config.ts, and it fences formulas in `$…$` like every exercise
    in graders.json. So the markup goes out in that fence, and the one KaTeX-only spelling
    — `\\mathrel{\\char`≠}`, which exists because KaTeX's embedded fonts draw `\\ne` as a
    box — becomes a plain `\\ne` that MathML renders correctly.
    """
    def tex(s: str) -> str:
        s = s.replace(r"\mathrel{\char`≠}", r"\ne ")
        return re.sub(r"⟦(.*?)⟧", lambda m: f"${m.group(1)}$", s)

    groups = [{"title": title, "blurb": blurb,
               "scenes": [{"id": sid, "title": name, "script": script,
                           "bodyTex": tex(body), "captionTex": tex(caption)}
                          for sid, name, body, script, caption in scenes]}
              for title, blurb, scenes in acts()]
    (PAD / "seqreel.json").write_text(
        json.dumps({"block": BLOCK, "groups": groups}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8")
    (PAD / "seqreel.css").write_text(
        "/* GENERATED by workbook/build/seqreel.py — do not edit; "
        "the rules live in CSS_CORE there. */\n" + CSS_CORE.lstrip("\n"), encoding="utf-8")
    n = sum(len(g["scenes"]) for g in groups)
    print(f"pad         : lib/seqreel.json + lib/seqreel.css ({len(groups)} acts, {n} scenes)")


def main() -> None:
    s = TARGET.read_text(encoding="utf-8")
    reel = build()
    export_pad()

    # --- the page's own css, right before the component pass -------------
    block = f"{CSS_BEG}{CSS}{CSS_END}\n"
    if CSS_BEG in s:
        s = re.sub(re.escape(CSS_BEG) + r"[\s\S]*?" + re.escape(CSS_END) + r"\n?",
                   lambda _: block, s, count=1)
    else:
        if PASS_BEG not in s:
            raise SystemExit(f"{TARGET.name}: no component-pass marker to sit before")
        s = s.replace(PASS_BEG, block + PASS_BEG, 1)

    # --- the reel itself, at the head of block 02 ------------------------
    if HTML_BEG in s:
        # a plain replacement string would read the KaTeX markup's `\dots` as an escape
        s = re.sub(re.escape(HTML_BEG) + r"[\s\S]*?" + re.escape(HTML_END) + r"\n\s*",
                   lambda _: reel, s, count=1)
    else:
        block_at = s.index(f'<article class="block" id="wb{BLOCK}">')
        at = s.index(ANCHOR, block_at)
        s = s[:at] + reel + s[at:]

    TARGET.write_text(s, encoding="utf-8")
    every = [sc for _, _, scenes in GROUPS for *_, sc, _ in scenes]
    words = sum(len(re.sub(r"\[\[[\w-]+\]\]", "", sc).split()) for sc in every)
    cues = sum(len(re.findall(r"\[\[", sc)) for sc in every)
    print(f"{TARGET.name}: {len(every)} narrated scenes, {cues} cues, {words} spoken "
          f"words (~{words * 60 // 140}s of voice) | page {len(s.encode()) // 1024} kb")


if __name__ == "__main__":
    main()
