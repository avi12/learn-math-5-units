"""Build pages/srcpage.html — where every exercise in the workbook comes from.

Layout comes from data/pagebase.css; colour and shape from data/cyberskin.css
via build/skin.py, which must be run on the output.

The citation table is read from the published workbook so it cannot drift.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = (ROOT / "data" / "pagebase.css").read_text(encoding="utf-8")
WB = (ROOT / "pages" / "workbook.html").read_text(encoding="utf-8")

# ---------------------------------------------------------------- sources ---
idx = [m.start() for m in re.finditer(r'class="block"', WB)]
idx.append(WB.find('<p class="foot"'))
BLOCKS = []
for a, b in zip(idx, idx[1:]):
    seg = WB[a:b]
    num = re.search(r'class="bnum">(.*?)<', seg).group(1)
    topic = re.search(r"<h3>(.*?)</h3>", seg).group(1)
    src = re.search(r'class="srcline">([\s\S]*?)</div>', seg)
    href = re.search(r'href="(https://meyda[^"]+)"', seg)
    cite = ""
    if src:
        cite = " ".join(re.sub(r"<[^>]+>", " ", src.group(1)).split())
        cite = cite.replace("השאלון המקורי ↗", "").replace("נבנתה בהשראת ", "").strip()
    BLOCKS.append((num, topic, cite, href.group(1) if href else ""))

rows = []
for num, topic, cite, href in BLOCKS:
    if cite:
        link = ('<a href="%s" target="_blank" rel="noopener">השאלון ↗</a>' % href) if href else "&mdash;"
        rows.append('<tr><td class="mins">%s</td><td style="font-weight:700">%s</td>'
                    '<td>%s</td><td>%s</td></tr>' % (num, topic, cite, link))
    else:
        rows.append('<tr><td class="mins">%s</td><td style="font-weight:700">%s</td>'
                    '<td>נכתב מאפס &mdash; בלוק היסודות, אין בו שאלת בגרות</td><td>&mdash;</td></tr>'
                    % (num, topic))
ROWS = "\n        ".join(rows)

# -------------------------------------------------------------- the flow ---
STAGES = [
    ("ארכיון שאלוני הבגרות", "18 שאלונים רשמיים, 35571 ו&#8209;35572, משנת 2024 ואילך", True),
    ("חילוץ הטקסט", "pdftotext -layout -enc UTF&#8209;8 &#8594; exams/text/", False),
    ("כתיבה בהשראה, לא העתקה", "אותו מבנה ואותה טכניקה &mdash; נתונים, הקשר וסעיפים אחרים", True),
    ("אימות סימבולי", "כל תשובה נבדקת מחדש לפני פרסום &mdash; בלי יוצא מן הכלל", True),
    ("החוברת", "כל שאלת מדרגה 3 נושאת ציון מקור וקישור ל&#8209;PDF המקורי", True),
]
svg = ['<svg viewBox="0 0 700 412" role="img" aria-label="הצינור שממנו נבנה כל תרגיל בחוברת">']
for i, (title, sub, heb) in enumerate(STAGES):
    y = 20 + i * 80
    svg.append('<rect x="20" y="%d" width="480" height="54" rx="0" fill="var(--sc)" '
               'stroke="var(--outline)" stroke-width="2"/>' % y)
    svg.append('<text x="260" y="%d" text-anchor="middle" font-size="14.5" font-weight="700" '
               'fill="var(--on-surface)">%s</text>' % (y + 24, title))
    d = "" if heb else ' direction="ltr"'
    svg.append('<text x="260" y="%d" text-anchor="middle" font-size="11.5"%s '
               'fill="var(--on-surface-var)">%s</text>' % (y + 42, d, sub))
    if i < len(STAGES) - 1:
        svg.append('<path d="M260 %d V%d" fill="none" stroke="currentColor" stroke-width="2"/>'
                   '<polygon points="260,%d 254,%d 266,%d" fill="currentColor"/>'
                   % (y + 54, y + 74, y + 80, y + 68, y + 68))
# the fenced-off papers: they never enter the pipeline
svg.append('<rect x="520" y="20" width="170" height="88" rx="0" fill="var(--sc)" '
           'stroke="var(--accent-2)" stroke-width="2" stroke-dasharray="7 5"/>')
svg.append('<text x="605" y="46" text-anchor="middle" font-size="13.5" font-weight="700" '
           'fill="var(--accent-2)">2 שאלונים שמורים</text>')
svg.append('<text x="605" y="66" text-anchor="middle" font-size="11.5" '
           'fill="var(--on-surface-var)">35571 קיץ 2026,</text>')
svg.append('<text x="605" y="82" text-anchor="middle" font-size="11.5" '
           'fill="var(--on-surface-var)">מועד א&rsquo; ומועד ב&rsquo;</text>')
svg.append('<text x="605" y="99" text-anchor="middle" font-size="11.5" '
           'fill="var(--on-surface-var)">שמורים למתכונת</text>')
svg.append('<path d="M520 64 H500" fill="none" stroke="var(--accent-2)" stroke-width="2" '
           'stroke-dasharray="6 4"/>')
svg.append('<path d="M504 58 L514 70 M514 58 L504 70" stroke="var(--accent-2)" stroke-width="2.5"/>')
svg.append("</svg>")
SVG = "\n      ".join(svg)

def label(cx, y, txt, size, colour, bold=False):
    w = ' font-weight="700"' if bold else ""
    return ('<text x="%d" y="%d" text-anchor="middle" font-size="%s"%s fill="var(%s)">%s</text>'
            % (cx, y, size, w, colour, txt))


# ------------------------------------------------- the two-sided test ------
CELLS = [
    (270, 60, "ניסוח מחדש", "אותה שאלה במילים אחרות. זה מה שהיה ב&#8209;04, 06, 07 ו&#8209;09.",
     "--sc", "--accent-2", "--on-surface", "&#10007;"),
    (20, 60, "היעד", "שאלה מקורית שמאמנת בדיוק את אותם כלים.",
     "--primary-container", "--primary", "--on-primary-container", "&#10003;"),
    (270, 190, "כמעט לא קורה", "ניסוח קרוב בלי אותה טכניקה — צירוף נדיר.",
     "--sc", "--outline", "--on-surface-var", ""),
    (20, 190, "שאלה אחרת", "מקורית, אבל לא מכינה למה שהיא אמורה להחליף.",
     "--sc", "--outline", "--on-surface-var", "&#9888;"),
]
q = ['<svg viewBox="0 0 700 320" role="img" aria-label="שני התנאים שכל שאלה חדשה צריכה לעמוד בהם">']
q.append(label(385, 34, "ניסוח קרוב למקור", "12.5", "--on-surface-var"))
q.append(label(135, 34, "ניסוח רחוק מהמקור", "12.5", "--on-surface-var"))
q.append(label(595, 118, "אותה טכניקה", "13.5", "--on-surface", True))
q.append(label(595, 248, "טכניקה אחרת", "13.5", "--on-surface", True))
for x, y, title, sub, fill, stroke, on, glyph in CELLS:
    q.append('<rect x="%d" y="%d" width="230" height="110" rx="0" fill="var(%s)" '
             'stroke="var(%s)" stroke-width="2"/>' % (x, y, fill, stroke))
    q.append(label(x + 115, y + 34, (glyph + " " if glyph else "") + title, "15", on, True))
    words = sub.split(" ")
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) > 34:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    for k, ln in enumerate(lines[:3]):
        q.append(label(x + 115, y + 58 + k * 17, ln, "11.5", on))
q.append("</svg>")
SVG2 = ("\n      ").join(q)

# ------------------------------------------------------------- the page ----
PAGE = """<title>מאיפה מגיעים התרגילים</title>
<style>
:root{/* tokens injected by build/skin.py from data/cyberskin.css */}
%s</style>

<div class="page">

<header class="hero">
  <p class="eyebrow">פרובננס · חוברת מדרגות 571</p>
  <h1>מאיפה מגיעים<br><em>התרגילים</em></h1>
  <p class="lede">שאלה הוגנת, ובעיקר שאלה שאפשר לבדוק. כל תרגיל בחוברת נובע משאלון בגרות רשמי אחד,
  ואף אחד מהם אינו העתק שלו &mdash; אחרי ביקורת שמצאה שלושה שכן היו קרובים מדי, ותיקנה אותם.</p>
  <div class="stats">
    <div class="stat"><b>18</b><span>שאלונים רשמיים</span></div>
    <div class="stat"><b>30</b><span>תרגילים בחוברת</span></div>
    <div class="stat"><b>0</b><span>מועתקים כלשונם</span></div>
    <div class="stat"><b>4</b><span>נכתבו מחדש בביקורת</span></div>
    <div class="stat"><b>2</b><span>שאלונים שמורים</span></div>
  </div>
</header>

<section>
  <div class="shead"><span class="num">01</span><h2>הצינור</h2></div>
  <p class="sub">אין כאן אתרי הכנה מסחריים ואין בנקי שאלות. יש מקור אחד &mdash; ארכיון השאלונים של משרד החינוך
  &mdash; ושרשרת שלבים שאפשר להריץ מחדש ולקבל את אותה תוצאה.</p>
  <figure>
    <div class="fig">
      %s
    </div>
    <figcaption>האימות רץ ב&#8209;<code>sympy</code>, והקבצים יושבים במאגר תחת <code>exams/text/</code>, כך שאפשר לפתוח כל שאלון מקורי ולהשוות
    מול התרגיל שנבנה ממנו. שני שאלונים לא נכנסים לצינור בכוונה.</figcaption>
  </figure>
</section>

<section>
  <div class="shead"><span class="num">02</span><h2>שלוש מדרגות, שלושה מקורות</h2></div>
  <p class="sub">רק המדרגה השלישית קשורה לשאלון אמיתי. שתי הראשונות נכתבות במיוחד כדי להוביל אליה.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>מדרגה</th><th>מאיפה היא באה</th><th>למה</th></tr></thead>
      <tbody>
        <tr><td style="font-weight:700">1 · חימום</td><td>נכתבת מאפס</td>
        <td>טכניקה אחת, בלי עיצוב שאלה. נועדה להכניס אותך לנושא תוך דקות.</td></tr>
        <tr><td style="font-weight:700">2 · ביניים</td><td>נכתבת מאפס</td>
        <td>מחברת שני רעיונות שנלמדו בנפרד. עדיין לא באורך של שאלת בגרות.</td></tr>
        <tr><td style="font-weight:700">3 · רמת בגרות</td><td><b>בהשראת שאלה אמיתית</b></td>
        <td>אותו מבנה סעיפים, אותה טכניקה ואותו עומק &mdash; נתונים והקשר אחרים. עם ציון מקור וקישור.</td></tr>
      </tbody>
    </table>
  </div>
  <div class="callout why" style="margin-top:18px">
    <h3>&ldquo;בהשראת&rdquo; זה לא ניסוח מכובס</h3>
    <p>הכלל שקבעת: לא להשתמש בשאלות מהשאלונים כלשונן. הסיבה מעשית ולא משפטית &mdash; שאלה שכבר ראית
    פותרת את עצמה מהזיכרון, ואז המתכונת מודדת זיכרון במקום יכולת. לכן השאלון המקורי נשאר זמין לך בקישור,
    אבל התרגיל עצמו שונה ממנו בנתונים, בהקשר ולעיתים גם בסדר הסעיפים.</p>
  </div>
</section>

<section>
  <div class="shead"><span class="num">03</span><h2>מאיזה שאלון נבנתה כל מדרגה 3</h2></div>
  <p class="sub">הטבלה נקראת ישירות מהחוברת המפורסמת, כך שהיא לא יכולה להיפרד ממנה.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>בלוק</th><th>נושא</th><th>המקור</th><th>קישור</th></tr></thead>
      <tbody>
        %s
      </tbody>
    </table>
  </div>
</section>

<section>
  <div class="shead"><span class="num">04</span><h2>הביקורת: מה נבדק ומה תוקן</h2></div>
  <p class="sub">תשע שאלות מדרגה 3 הושוו שורה מול שורה לשאלה שהן מצטטות, בטקסט המחולץ של השאלון עצמו.
  שש עברו. שלוש לא, ונכתבו מחדש מהיסוד.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>בלוק</th><th>מה נמצא</th><th>מה יש עכשיו</th></tr></thead>
      <tbody>
        <tr><td style="font-weight:700">04 · הסתברות</td>
        <td>אותו סיפור כמו המקור: בית אריזה, שני סוגי פירות, ייצוא. רק הפירות והמספרים הוחלפו.</td>
        <td>פס ייצור של שני דגמי מחשבים ניידים ובדיקת איכות מורחבת. אותה שרשרת טכניקות בדיוק.</td></tr>
        <tr><td style="font-weight:700">06 · טריגונומטרייה</td>
        <td>אותו משולש שווה שוקיים, אותם סימונים ואותה זווית ראש <code>2α</code> כמו במקור. בנוסף נשען על שאלון שמור.</td>
        <td><b>מעוין</b> במקום משולש, והציטוט לשאלון השמור הוסר לגמרי.</td></tr>
        <tr><td style="font-weight:700">09 · בעיות קיצון</td>
        <td>לא נחשדה כלל בסבב הראשון. הבודק האוטומטי מצא שהיא משכפלת משפט־אחר־משפט את שאלה 8
        ב<b>קיץ 2026 מועד א&rsquo;</b> — פונקציית שורש וישר, תחום, שתי נקודות חיתוך, קטע אנכי, מקסימום.
        וזה שאלון שמור.</td>
        <td>משיק להיפרבולה <code>f(x)=12/x</code> והמשולש שהוא חותך מן הצירים: השטח קבוע, האורך <code>PQ</code> מינימלי.</td></tr>
        <tr><td style="font-weight:700">07 · נגזרת</td>
        <td><b>הפונקצייה הועתקה כלשונה.</b> <code>f(x)=(x²−a²)/x</code> היא פתיחת שאלה 6 בקיץ 2025 מועד א&rsquo;, מילה במילה.</td>
        <td>פונקצייה אחרת, <code>f(x)=x+p²/x</code>, והמבנה הפוך: ל&#8209;<code>f</code> יש נקודות קיצון ול&#8209;<code>h</code> אין.</td></tr>
      </tbody>
    </table>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="callout good">
      <h3>השאלונים השמורים נקיים — עכשיו באמת</h3>
      <p>שני המועדים של קיץ 2026 היו נגועים, לא אחד: מועד ב&rsquo; דרך בלוק 06 ומועד א&rsquo; דרך בלוק 09.
      אחרי שני התיקונים אף שאלה בחוברת אינה נשענת עליהם, ושניהם חזרו להיות מתכונות מלאות.
      עמודי השער שלהם נקראו לצורך טבלת משך הבחינה בלבד, וזה לא פוגע בהם.</p>
    </div>
    <div class="callout">
      <h3>מה הביקורת לא יכולה לתפוס</h3>
      <p>ההשוואה נעשית מול השאלון <b>שצוין</b>. שאלה שדומה במקרה לשאלה מתוך שאלון אחר, שלא צוטט, לא תיתפס
      כך &mdash; בדיוק מה שקרה בבלוק 07, שציטט את חורף 2026 אבל העתיק מקיץ 2025.
      לכן מכאן והלאה כל שאלה חדשה מושווית מול <b>כל</b> 18 השאלונים, לא רק מול זה שהיא מצטטת.</p>
    </div>
  </div>
</section>

<section>
  <div class="shead"><span class="num">05</span><h2>איך יודעים ששאלה חדשה שקולה למקור</h2></div>
  <p class="sub">&ldquo;שונה&rdquo; זה חצי מהדרישה. שאלה שונה שמאמנת משהו אחר היא חסרת ערך כתרגול.
  לכן כל שאלה צריכה לעבור <b>שני</b> מבחנים הפוכים בכיוונם: רחוקה מספיק בניסוח, וזהה מספיק בטכניקה.</p>
  <figure>
    <div class="fig">
      %s
    </div>
    <figcaption>רק המשבצת השמאלית העליונה היא שאלה טובה. הטעות הנפוצה היא המשבצת שלידה &mdash;
    להחליף תפוחים בלימונים ולחשוב שנוצרה שאלה חדשה.</figcaption>
  </figure>

  <div class="tablewrap" style="margin-top:20px">
    <table>
      <thead><tr><th>הבדיקה</th><th>מי מריץ</th><th>מה היא מכריעה</th></tr></thead>
      <tbody>
        <tr><td style="font-weight:700">מרחק ניסוח</td><td>מכונה, מול כל 18 השאלונים</td>
        <td><code>build/qsim.py</code>: חמישיות תווים, אחרי שמסננים את מה שחוזר בכל שאלון.
        חוזר על עצמו, לא תלוי בשיפוט.</td></tr>
        <tr><td style="font-weight:700">הטקסט המשותף</td><td>מכונה מציגה, אדם מכריע</td>
        <td>לא רק ציון: הכלי מדפיס את הרצפים החופפים עצמם, וכך רואים אם החפיפה היא תוכן
        או רק &ldquo;מצאו את שיעורי נקודות הקיצון&rdquo;.</td></tr>
        <tr><td style="font-weight:700">התשובה</td><td>מכונה</td>
        <td><code>sympy</code> פותר את השאלה החדשה מאפס. לא בודק שקילות למקור, אבל מוודא
        שהשאלה בכלל פתירה ושהתשובה במבנה הנכון.</td></tr>
        <tr><td style="font-weight:700">זהות הטכניקה</td><td>הצהרה שלי, בת־השוואה</td>
        <td>אילו כלים מן הנוסחאון נדרשים, ובאיזה סדר. כתוב בהערות של <code>build/fixq.py</code>
        לצד כל שאלה, כך שאפשר להשוות מול המקור במקום להאמין לי.</td></tr>
        <tr><td style="font-weight:700">האם ההברקה זהה</td><td>אדם</td>
        <td>שתי שאלות יכולות לדרוש אותם כלים ורק אחת מהן להסתיר טריק. אין לזה בדיקה אוטומטית.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout" style="margin-top:18px">
    <h3>מה הבודק האוטומטי באמת תפס — ומה לא</h3>
    <p>הרצתי אותו על הגרסה שלפני התיקון. התוצאות מפתיעות, ושוות יותר מהתיאוריה:</p>
    <p style="margin-top:10px"><b>בלוק 04</b> (אותו סיפור, פירות אחרים) &mdash; ציון 0.246, <b>נתפס</b>.
    <b>בלוק 09</b> (שכפול מבנה משאלון שמור) &mdash; 0.293, <b>נתפס</b>, ואף אחד לא חשד בו.</p>
    <p style="margin-top:10px"><b>בלוק 07</b>, ההעתקה החמורה מכולן &mdash; הפונקצייה מילה במילה &mdash;
    קיבל <b>0.057</b>. בלתי נראה. <b>בלוק 06</b>, אותה צורה גאומטרית ואותם סימונים &mdash; 0.099. בלתי נראה.</p>
    <p style="margin-top:10px">המסקנה חדה: <b>בדיקה לקסיקלית תופסת סיפור מועתק, לא מתמטיקה מועתקת.</b>
    נוסחה היא קצרה מדי מכדי להזיז ציון, וצורה גאומטרית זהה לא מותירה עקבות במילים בכלל.
    לשני אלה אין תחליף לקריאה &mdash; ולכן הבדיקה היא שתי שכבות ולא אחת.</p>
  </div>
</section>

<section>
  <div class="shead"><span class="num">06</span><h2>מה לא משמש מקור</h2></div>
  <div class="callout">
    <h3>שלושה דברים שלא נכנסים לחוברת</h3>
    <p><b>אתרי הכנה מסחריים.</b> הם שימשו רק כדי לגלות טענות שצריך לאמת, אף פעם לא כמקור לשאלה או לעובדה.
    שלוש טענות שהגיעו משם התבררו כשגויות ותוקנו.</p>
    <p style="margin-top:10px"><b>שאלות שנוצרו בלי אימות.</b> תרגיל ש&#8209;<code>sympy</code> לא אישר את התשובה שלו לא מתפרסם.
    אם משהו נראה לך שגוי, זו טעות בניסוח ולא במספרים &mdash; ושווה לומר.</p>
    <p style="margin-top:10px"><b>זיכרון.</b> כל מספר שמופיע בדפים האלה נשען על מסמך שאפשר לפתוח: השאלון עצמו,
    דף משרד החינוך, או דף הרישום של האוניברסיטה. מה שלא אומת מסומן ככזה.</p>
  </div>
</section>

<p class="foot">השאלונים נשלפו מארכיון משרד החינוך בכתובת
<code>meyda.education.gov.il/sheeloney_bagrut/&lt;שנה&gt;/&lt;מועד&gt;/HEB/&lt;שאלון&gt;.pdf</code>,
כאשר מועד 1 הוא חורף, 6 הוא קיץ א&rsquo; ו&#8209;8 הוא קיץ ב&rsquo;. הטקסט חולץ ב&#8209;<code>pdftotext -layout -enc UTF-8</code>.
טבלת המקורות בפרק 03 נקראת אוטומטית מתוך החוברת המפורסמת בכל בנייה, ולכן היא משקפת את מה שבאמת כתוב בה.</p>

</div>
"""

out = PAGE % (BASE, SVG, ROWS, SVG2)
(ROOT / "pages" / "srcpage.html").write_text(out, encoding="utf-8")
print("pages/srcpage.html:", len(out.encode()) // 1024, "kb |", len(BLOCKS), "blocks read from the workbook")
