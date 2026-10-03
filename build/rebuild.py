"""Rebuild the workbook's blocks around the new practice strategy.

  python build/rebuild.py && python build/skin.py workbook.html

What changes in every one of the ten blocks:

  1. A `howto` panel between the video and the exercises: the procedure, step by step,
     with the reason each step exists. The block already had a `bwhy` — the intuition —
     but nothing that said how the thing is actually solved.
  2. Three exercises at each rung instead of one. The exercise that was already there
     stays as number 1: it is sympy-verified and has been through the originality audit.
     Two new ones from build/content.py join it.
  3. A prompt, per block, that the reader pastes into Claude together with their own
     solution. It does not ask "is this right" — it asks whether the METHOD is the one a
     bagrut marker expects for this specific topic, and it tells Claude to go and read
     the official papers rather than invent a marking scheme.

The minutes move off the exercises. Avi's point: the number should say how long the
topic takes to learn, not how long a question takes to answer, and the old per-rung
"3 דקות / 7 דקות / 20 דקות" said the second thing.

Idempotent by construction — it refuses to run twice on the same file.
"""
import html
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blockre import BLOCK_OPEN  # noqa: E402
from shared import LRM  # noqa: E402
from content import BLOCKS, HEAD, SHEET  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "pages" / "workbook.html"
WORK = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build"

# The adapted answer rules and points for the sittings Avi sits (data/tashpaz.json). The
# grade line of the prompt reads them, so a changed rule is one edit in one file.
TASHPAZ = json.loads((ROOT / "data" / "tashpaz.json").read_text(encoding="utf-8"))

RUNG_NAME = {"1": "חימום", "2": "ביניים", "3": "רמת בגרות"}
PIPS = {"1": '<i class="on"></i><i></i><i></i>',
        "2": '<i class="on"></i><i class="on"></i><i></i>',
        "3": '<i class="on"></i><i class="on"></i><i class="on"></i>'}


# --------------------------------------------------------------- the prompt --
def prompt_text(title: str, grader: str, paper: str = "35571") -> str:
    """One template, filled per block. The topic-specific part is `grader`.

    The web-search instruction is not decoration: without it the model happily invents a
    marking scheme, and an invented one is worse than none. The URL pattern is the real
    archive layout (moed 1 = winter, 6 = summer A, 8 = summer B), so it can actually
    fetch a paper instead of guessing at one.

    The gate in the middle — "do not demand anything you have not checked" — is Avi's,
    and it closes the hole the search instruction left open. Telling a model to go and
    read the papers stops it inventing a marking scheme; it does not stop it inventing a
    REQUIREMENT. "you should have justified this step", "you should have named the
    theorem", "you should have written the condition" all cost nothing to say and sound
    authoritative, and a reader who takes them at face value trains himself to write
    things nobody asked for — with the exam clock running.

    So every demand now has to arrive with its source, and a demand without one is
    downgraded to a recommendation and refunded. The hierarchy of sources is measured,
    not asserted: "נמקו" appears 71 times across the 18 papers, which is the exam saying
    in its own words where a justification is part of the question; and the cover page of
    every one of those 18 papers carries the general detail rule, quoted here verbatim.
    That rule is listed LAST on purpose — it is the broadest and therefore the easiest
    thing to hide a made-up demand behind.

    The LaTeX rule near the end is Avi's, and it is not cosmetic. The answer comes back
    inside Hebrew prose, i.e. inside an RTL paragraph, and bare math there reorders on
    screen — the same trap this repo has already been burned by twice in its own pages
    ("אינו 1," rendering as "אינו ,1"; `|q|<1` rendering as `|1>|q`). $…$ gives every
    expression its own LTR box, so it says what it means. Hence "every expression, even
    the shortest": the ones that flip are precisely the short ones.

    The video paragraph is Avi's too: a gap the check finds gets a video, YouTube first,
    and a Manim animation the model builds itself when no video explains that exact
    thing, on a white background (Avi's ask) — so every mobject must be set dark, since
    Manim's default colour is white and would vanish. Hebrew captions go through Manim's Text, not Tex — LaTeX has no Hebrew, the
    same trap as KaTeX's \\text{} in this repo's own pages.
    The voiceover lines are the pipeline that built final_video.mp4 at the repo root
    (see README.md): the ElevenLabs connector lives on Avi's claude.ai account, so the
    chat this prompt lands in can call it. Captions are timed by renderer.time because
    Manim gives a long Text a 2s Write — summing waits by hand was off by 12s.
    The direction lines are Avi's fix to the first video the chat produced: Write draws a
    Text's glyphs in their stored, left-to-right order, so Hebrew appeared end-first.
    Sorting each line by -x was checked in a render; one Text per line keeps the lines
    top to bottom, which a single multi-line Text sorted by x would not.
    The status-poll line exists because one test chat generated all five clips and then
    stopped: it read the tool's "not finished yet" note as a reason not to poll, and so
    never saw the media URLs. The run that did poll finished with sound.
    """
    plain = re.sub(r"⟦(.*?)⟧", r"\1", grader)
    rules = TASHPAZ["answer_rules"][paper]["adapted"]
    points = TASHPAZ["answer_rules"][paper]["adapted_points"]
    rules_url = TASHPAZ["sources"]["answer_rules"]
    return f"""אני נבחן ב‑5 יחידות מתמטיקה, שאלון {paper}. פתרתי תרגיל בנושא "{title}".

התרגיל:
... כאן מדביקים את התרגיל ...

הפתרון שלי:
... כאן מדביקים את הפתרון, כולל כל שלב שכתבתי על הדף ...

בדוק אותי בשלושה מישורים, בסדר הזה:

1. נכונות. האם התוצאה נכונה. אם לא — אמור לי באיזה שלב בדיוק נשברה השרשרת,
   ואל תפתור במקומי. אני רוצה לתקן בעצמי.

2. דרך. האם דרך הפתרון היא זו שבוחן בגרות מצפה לה דווקא בנושא הזה. בנושא הזה
   הבוחן מחפש:
   {plain}
   עבור על הרשימה הזאת סעיף־סעיף ואמור מה קיים בפתרון שלי ומה חסר.

3. כתיבה. האם כתבתי כמו נבחן ולא כמו מתמטיקאי — כלומר מפורט יותר ממה
   שמתמטיקאי היה כותב.

כלל הדרישות. הוא חל על שלושת המישורים, והוא החשוב מביניהם:

בכל פעם שאתה עומד לדרוש ממני משהו שלא כתבתי — "היה עליך לנמק את המעבר",
"חסר תנאי", "היה צריך לציין את שם המשפט", "היה צריך לכתוב את תחום ההגדרה" —
עצור לפני שאתה כותב את זה, וחפש ברשת. ורק אחר כך מסור לי אותו כך:

 - מה בדיוק היה צריך להיכתב על הדף. הניסוח עצמו, לא הרעיון.
 - המקור שמחייב את זה, עם ציטוט ממנו.
 - כמה נקודות זה שווה, אם המקור אומר.
 - לא מצאת מקור? כתוב "המלצה, לא חובה" ואל תוריד על זה נקודות.

מה נחשב מקור לדרישה נקודתית, מהחזק לחלש:

 - נוסח הסעיף עצמו. כתוב בו "נמקו" או "הסבירו" או "הוכיחו"? הנימוק הוא חלק
   מהשאלה והוא נבדק. לא כתוב שם? אז הוא אינו מובן מאליו, וצריך מקור אחר.
 - מחוון רשמי לשאלה דומה, אם מצאת כזה.
 - המיקוד העדכני לשנת הבחינה.
 - עמוד השער של השאלון. מודפס שם, בכל אחד מהשאלונים (בנוסח הזה או בלשון
   ציווי): "יש לרשום במחברת את
   שלבי הפתרון, גם כאשר החישובים מתבצעים בעזרת מחשבון", וגם "יש להסביר את
   כל הפעולות, כולל חישובים, בפירוט ובצורה ברורה ומסודרת. חוסר פירוט עלול
   לגרום לפגיעה בציון או לפסילת הבחינה". זו דרישת פירוט כללית, ולא רשימה
   של נימוקים. אל תשתמש בה כדי להכשיר דרישה נקודתית שאין לה מקור משלה.

זמן בבחינה הוא משאב. "מומלץ, אבל לא מצאתי שזה חובה" עוזר לי יותר מלהתרגל
לכתוב דברים שאף אחד לא ביקש.

לפני שאתה עונה, חפש ברשת ואמור לי מה מצאת:
 - שאלוני {paper} מארכיון משרד החינוך. תבנית הקישור:
   https://meyda.education.gov.il/sheeloney_bagrut/YYYY/M/HEB/{paper}.pdf
   כאשר YYYY היא השנה ו־M הוא המועד: 1 = חורף, 2 = חורף נבצרים, 6 = קיץ א', 8 = קיץ ב'.
   קיים משנת 2022 והלאה. עמוד השער של כל שאלון נושא את ההוראות לנבחן.
 - המיקוד העדכני לשנת הבחינה, מאתר משרד החינוך.
 - מחוון רשמי לשאלה דומה, אם קיים כזה.

אם לא מצאת מקור רשמי — אמור זאת במפורש ואל תמציא מחוון. עדיף "לא מצאתי" על
פני ניחוש שנשמע סמכותי.

סרטון לכל פער. בכל מקום שבו הפתרון שלי מראה שלא הבנתי משהו — שלב שנשבר,
כלל שלא הכרתי — צרף הסבר מצולם לנושא הזה בדיוק:
 - קודם חפש ביוטיוב, עדיף בעברית. תן קישור לסרטון שבאמת מצאת ופתחת, ואמור
   מה בו עונה על הפער. אל תמציא קישור, ואל תקשר לסרטון שפותר שאלון בגרות אמיתי.
 - לא מצאת סרטון שמסביר בדיוק את זה? צור אנימציה מתמטית בעצמך ב‑‎Manim‎
   ‏(‎Community Edition‎): סצנה קצרה שבונה את הרעיון צעד־צעד, ולכל צעד כיתוב
   הסבר על המסך. הכיתובים העבריים ב‑‎Text‎ ולא ב‑‎Tex‎ (‏‎LaTeX‎ לא מרנדר
   עברית), והנוסחאות ב‑‎MathTex‎. רקע לבן ‏(‎config.background_color = WHITE‎),
   ולכן כל טקסט, נוסחה וקו בצבע כהה — ברירת המחדל לבנה ותיעלם.
   כיוון הכתיבה: ‎Write‎ מצייר את האותיות לפי הסדר שלהן בתוך ‎Text‎, כלומר משמאל
   לימין — מסוף המשפט העברי לתחילתו. לכן כל שורת כיתוב היא ‎Text‎ נפרד,
   השורות ב‑‎VGroup(...).arrange(DOWN, aligned_edge=RIGHT)‎, ולפני ה‑‎Write‎
   ממיינים כל שורה מימין לשמאל: ‎line.sort(lambda p: -p[0])‎.
   קריינות: אם ‎ElevenLabs‎ מחובר אליך, הקרא כל כיתוב בקול — קובץ אחד לכל
   כיתוב, מודל ‎eleven_v3‎, קול ‎6WRlPmU1fqPwYbSxeP16‎. בטקסט של הקריינות כתוב
   מספרים ומשתנים במילים ("מינוס אחת", "איקס פחות שלוש"). הכלי חוזר מיד ובלי
   הקובץ: קרא אחריו ל‑‎creative_get_flow_run_status‎ עם ה‑‎flow_id‎ וה‑‎session_ids‎
   שחזרו, שוב ושוב עד ‎all_completed‎, קח את הקישור מ‑‎media[].url‎ והורד אותו
   ב‑‎curl‎. מדוד את אורך כל
   קובץ, והאט את הסצנה כך שכל כיתוב נשאר על המסך לפחות כאורך הקריינות שלו.
   את רגע ההופעה של כל כיתוב קרא מ‑‎self.renderer.time‎ ואל תסכם ביד —
   ‎Write‎ של טקסט ארוך נמשך 2 שניות ולא 1. מקם כל קובץ ברגע של הכיתוב שלו
   ‏(‎ffmpeg adelay + amix‎) ומזג עם הווידאו לקובץ ‎mp4‎ אחד.
   הרץ ותן לי את הסרטון. אין לך איפה להריץ, או שחסרים ‎LaTeX‎ או ‎ffmpeg‎? תן
   את הקוד המלא, את פקודות ההרצה והמיזוג, ואת קובצי הקריינות אם יצרת.

איך לכתוב מתמטיקה בתשובה: כל ביטוי מתמטי, גם הקצר ביותר, ב‑LaTeX בתוך
‎$…$‎ (או ‎$$…$$‎ בשורה נפרדת). לא תווי יוניקוד ולא טקסט רגיל — ‎$x^{{2}}$‎
ולא ‎x²‎, ‎$\\dfrac{{a}}{{b}}$‎ ולא ‎a/b‎, ‎$\\sqrt{{x+3}}$‎ ולא ‎√(x+3)‎,
‎$x\\le 5$‎ ולא ‎x<=5‎. גם שם של פונקצייה, מספר בודד או אינדקס בתוך משפט
עברי — ‎$f(x)$‎, ‎$a_{{n}}$‎. אני קורא את זה בעברית מימין לשמאל, וביטוי
שאינו בתוך LaTeX מתהפך ויוצא לא נכון.

הבחינה שלי היא בחינה מותאמת. חוקי המענה שלה בתשפ"ז: {rules}
מקור: {rules_url}

בסוף: ציון מ‑0 עד {points} כמו בבחינה המותאמת, ופירוט של כל נקודה שהורדת. ליד כל הורדה —
המקור שמחייב אותה. הורדה בלי מקור אינה הורדה: החזר לי את הנקודות, ורשום
אותה בנפרד תחת "המלצות"."""


# ------------------------------------------------------------ build the html --
def tools_html(b: dict, math) -> str:
    """The rules the block assumes, stated once.

    The how-to is a procedure, and a procedure calls rules by name — "ואז נגזרת",
    "עוברים לקדומה", "לפי משפט הסינוסים". An audit of all 90 exercises found the rules
    themselves were almost never written down: 56 of them lean on something the block
    never states. This panel is that layer, and it is deliberately NOT more how-to steps
    — a rule is something you look up, not a step you walk.

    Every entry carries where it comes from. A special angle's sine and the product rule
    are both needed constantly; one is on the official נוסחאון and one is not, and the
    exam does not tell you which. That is what the third column is for.
    """
    rows = "\n".join(
        f'        <div class="trow"><span class="tn">{math(name)}</span>'
        f'<span class="tf">{math(rule)}</span>'
        f'<span class="tg {"sheet" if src == SHEET else "head"}">{src}</span></div>'
        for name, rule, src in b["tools"])
    return (f'    <div class="howto tools">\n'
            f'      <span class="hlabel">הכלים שהבלוק מניח · {len(b["tools"])} כללים</span>\n'
            f'      <div class="tgrid">\n{rows}\n      </div>\n'
            f'      <p class="tnote">מה שמסומן <b>{HEAD}</b> אינו בנוסחאון הרשמי — '
            f'צריך להביא אותו מהראש.</p>\n'
            f"    </div>")


def howto_html(b: dict, math) -> str:
    """`math` renders the ⟦…⟧ markers. The how-to text carries them just like the
    exercises do — the step that explains cancelling a fraction has to show the
    fraction — so it has to go through the same renderer, not straight into the page."""
    steps = "\n".join(
        f"        <li><b>{math(t)}.</b> {math(body)}</li>" for t, body in b["howto"])
    return (f'    <div class="howto">\n'
            f'      <span class="hlabel">איך פותרים · כ־{b["learn"]} דקות ללמוד את הנושא</span>\n'
            f"      <ol>\n{steps}\n      </ol>\n"
            f'      <p class="trap"><b>המלכודת:</b> {math(b["trap"])}</p>\n'
            f"    </div>")


def prompt_html(num: str, title: str, b: dict) -> str:
    """Plain semantic HTML: a disclosure holding preformatted text, and nothing else.

    There is no copy button and no script. A <pre> inside a <details> is already the
    right element for "a block of text meant to be taken away", it works with the page
    served from anywhere, and it cannot break - the clipboard API, by contrast, refuses
    to run outside a secure context and needs a focused document."""
    body = html.escape(prompt_text(title, b["grader"]))
    return (f'    <details class="cprompt">\n'
            f"      <summary>פרומפט לקלוד — שיבדוק את הפתרון שלך</summary>\n"
            f'      <div class="cbody">\n'
            f'        <p class="note">פותרים על דף, מצלמים או מקלידים, ומדביקים לקלוד יחד '
            f"עם התרגיל. סמנו את הטקסט שלמטה והעתיקו. הפרומפט מבקש מקלוד לבדוק את "
            f"<b>הדרך</b> ולא רק את התוצאה, ולחפש את השאלון והמיקוד הרשמיים במקום להמציא "
            f"מחוון.</p>\n"
            f'        <pre class="prompt" id="p{num}">{body}</pre>\n'
            f"      </div>\n"
            f"    </details>")


def main() -> None:
    s = PAGE.read_text(encoding="utf-8")
    # The guard looks for the label this script writes, not for `.howto` as such: the
    # trinomial guide carries a how-to panel of its own and lives in the base, so the
    # class alone is no longer evidence that a rebuild has already run.
    if "<span class=\"hlabel\">איך פותרים" in s:
        raise SystemExit("workbook.html already rebuilt - restore it from the base first")

    # ---- render every formula that appears in the new material ------------
    tex: dict[str, str] = {}
    for b in BLOCKS.values():
        pool = [b["trap"]] + [t + " " + body for t, body in b["howto"]]
        pool += [n + " " + r for n, r, _src in b["tools"]]
        for lvl in b["new"].values():
            for q, a in lvl:
                pool += [q, a]
        for q, a, *_src in b.get("first", {}).values():
            pool += [q, a]
        for chunk in pool:
            for f in re.findall(r"⟦(.*?)⟧", chunk):
                tex[f] = f

    (WORK / "rb_tex.json").write_text(json.dumps(tex, ensure_ascii=False), encoding="utf-8")
    (WORK / "rb_render.mjs").write_text(
        'import katex from "katex";\nimport fs from "fs";\n'
        'const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));\n'
        "const out = {};\nlet bad = 0;\n"
        "for (const [k, t] of Object.entries(map)) {\n"
        '  try { out[k] = katex.renderToString(t, {displayMode:false, throwOnError:true, strict:false}); }\n'
        '  catch (e) { bad++; console.error("KATEX FAIL:", t, "->", e.message); }\n'
        "}\n"
        "fs.writeFileSync(process.argv[3], JSON.stringify(out));\n"
        'console.error("rendered " + Object.keys(out).length + ", failures " + bad);\n',
        encoding="utf-8")
    subprocess.run(["node", str(WORK / "rb_render.mjs"),
                    str(WORK / "rb_tex.json"), str(WORK / "rb_html.json")],
                   cwd=str(ROOT), check=True)   # katex resolves from the repo root
    rendered = json.loads((WORK / "rb_html.json").read_text(encoding="utf-8"))
    missing = sorted(set(tex) - set(rendered))
    if missing:
        raise SystemExit("formulas failed to render: " + repr(missing[:5]))

    def math(chunk: str) -> str:
        return re.sub(r"⟦(.*?)⟧",
                      lambda m: '<span class="tex">' + rendered[m.group(1)] + "</span>",
                      chunk)

    # ---- rewrite each block, last first so offsets stay valid --------------
    # The section also holds articles that are not one of the ten blocks - the trinomial
    # guide is <article class="block guide"> - so an end tag is paired with the start it
    # actually closes. Counting `</article>` on its own put the guide's closing tag in
    # the list and shifted every pair after it.
    starts = [m.start() for m in BLOCK_OPEN.finditer(s)]
    ends = [re.compile(r"  </article>").search(s, a).end() for a in starts]
    assert len(starts) == 10, len(starts)

    for a, z in reversed(list(zip(starts, ends))):
        seg = s[a:z]
        num = re.search(r'class="bnum">(.*?)<', seg).group(1)
        title = re.sub(r"<.*?>", "", re.search(r"<h3>(.*?)</h3>", seg, re.S).group(1)).strip()
        b = BLOCKS[num]

        # -- the rungs: keep exercise 1, add two --------------------------
        # `first` replaces exercise 1 of a rung. The base page carries it pre-rendered, and
        # the grounding audit of 17.09.2026 had to change some of them (arithmetic sequences
        # are out in תשפ"ז, two induction exercises were copies of real questions). Editing
        # rendered KaTeX by hand is how a formula and its annotation drift apart, so the
        # replacement is written here in ⟦…⟧ like every other exercise, and the base stays
        # untouched. Value: (question, answer) or (question, answer, source line).
        first = b.get("first", {})

        def rung_repl(m: re.Match) -> str:
            lvl = m.group(1)
            inner = m.group(2)
            inner = re.sub(r'\s*<span class="rlabel">.*?</span>\s*\n', "\n", inner, count=1, flags=re.S)
            if lvl in first:
                q, _a, *src = first[lvl]
                inner = f'          <p class="q">{math(q)}</p>'
                if src:
                    inner += f'\n          <div class="srcline"><span style="opacity:.75">{src[0]}</span></div>'
            label = (f'      <span class="rlabel">מדרגה {lvl} · {RUNG_NAME[lvl]} '
                     f'<span class="pips">{PIPS[lvl]}</span></span>')
            parts = [f'        <div class="qx"><span class="qn">תרגיל 1</span>\n{inner.rstrip()}\n        </div>']
            for i, (q, _a) in enumerate(b["new"][lvl], start=2):
                parts.append(f'        <div class="qx"><span class="qn">תרגיל {i}</span>\n'
                             f'          <p class="q">{math(q)}</p>\n        </div>')
            body = "\n".join(parts)
            return f'      <div class="rung r{lvl}">\n{label}\n{body}\n      </div>'

        seg, nr = re.subn(
            r'      <div class="rung r(\d)">\n([\s\S]*?)\n      </div>(?=\n\s*<div class="rung|\n\s*</div>)',
            rung_repl, seg)
        assert nr == 3, f"block {num}: rewrote {nr} rungs, expected 3"

        # -- the how-to panel, right before the exercises ------------------
        seg = seg.replace('    <div class="rungs">',
                          tools_html(b, math) + "\n" + howto_html(b, math)
                          + '\n    <div class="rungs">', 1)

        # -- answers: relabel the old ones, append the new -----------------
        def ans_label(m: re.Match) -> str:
            return f"<b>{LRM}{m.group(1)}·1{(' ' + m.group(2)) if m.group(2) else ''}.</b>"

        # only block 01 puts a newline after the opening tag; the other nine do not
        abody = re.search(r'<div class="abody">\s*([\s\S]*?)\s*</div>', seg)
        assert abody, f"block {num}: no answers body"
        # The answers come out in reading order — rung 1 exercises 1..3, then rung 2, then 3 —
        # whichever of base page or `first` exercise 1 came from. A paragraph with no label
        # continues the one before it (block 03's rung-3 answer runs over three paragraphs).
        # A paragraph that carries labels of two rungs could not be placed, so it is refused.
        old = abody.group(1)
        by_rung = {lvl: [] for lvl in "123"}
        rung = None
        for p in re.findall(r"<p>[\s\S]*?</p>", old):
            tiers = set(re.findall(r"<b>(\d)[א-ת]*\.</b>", p))
            assert len(tiers) <= 1, f"block {num}: an answer paragraph mixes rungs {tiers}"
            if tiers:
                rung = tiers.pop()
            assert rung, f"block {num}: an answer paragraph before any rung label"
            by_rung[rung].append(re.sub(r"<b>(\d)([א-ת]*)\.</b>", ans_label, p))
        answers = []
        for lvl in "123":
            if lvl in first:
                answers.append(f"        <p><b>{LRM}{lvl}·1.</b> {math(first[lvl][1])}</p>")
            else:
                answers.extend(by_rung[lvl])
            for i, (_q, ansr) in enumerate(b["new"][lvl], start=2):
                answers.append(f"        <p><b>{LRM}{lvl}·{i}.</b> {math(ansr)}</p>")
        seg = seg[:abody.start(1)] + "\n".join(answers) + seg[abody.end(1):]

        # -- the prompt, after the exercises -------------------------------
        seg = seg.replace('    <details class="ans">',
                          prompt_html(num, title, b) + '\n    <details class="ans">', 1)

        s = s[:a] + seg + s[z:]

    PAGE.write_text(s, encoding="utf-8")
    print(f"rebuilt 10 blocks | formulas rendered: {len(rendered)} | "
          f"new exercises: {sum(len(v) for b in BLOCKS.values() for v in b['new'].values())} | "
          f"page {len(s.encode()) // 1024} kb")


if __name__ == "__main__":
    main()
