# -*- coding: utf-8 -*-
"""The trinomial-factoring guide, and the single place it is authored.

Avi asked for a guide, with a video, for the technique that turns a quadratic into a
product of brackets — ⟦x²-26x+25⟧ into ⟦(x-25)(x-1)⟧. It goes into the workbook's
first section, "טכניקה אלגברית", ahead of block 01, because that is where the technique
is first *assumed*: block 01's own answers already cancel ⟦(x-3)(x+3)⟧ out of a fraction
without ever saying how the factoring was done.

Why it earns a place at all, checked rather than felt: grepping all eighteen papers in
exams/text for "פירוק", "לגורמים", "פרקו" returns **zero**. The exam never asks you to
factor. It assumes it, inside almost every rational and extremum question — which makes
it exactly the kind of gap that costs points in a topic the student did understand.

The method is written from the block's own video (עובד לב ארי, "פירוק טרינום — לכיתה ט
ולכל מי ששכח"), transcribed with whisper large-v3-turbo, per the rule in CLAUDE.md:
what goes on the page is the teacher's METHOD in our words, never transcript text. What
the transcript gave that a textbook ordering would not:

  * order the trinomial BEFORE naming a, b, c — he opens on ⟦x²+18+9x⟧ and shows the
    student who reads the coefficients off the printed order searching for a pair that
    does not exist;
  * the tip the whole video is built around — **the product locates the pair, the sum
    decides the signs**. Looking for both at once is what makes the step feel like luck;
  * a candidate pair that cannot reach b under ANY sign combination is discarded whole,
    not nudged (6·2 for c=12 against b=-7);
  * he demonstrates the destination first, by EXPANDING (x-2)(x-3) before factoring
    anything — which is also the free check;
  * ⟦a≠1⟧: look for a common factor first; that is what most of these cases really are.

The second video covers the case a common factor does not fix — splitting the middle
term with a·c and grouping.

The page opens with WHY before HOW, per Avi's rule, and he asked for that half by name:
a video for where the rule came from. The Technion's Vieta proof is the honest answer —
nobody guessed the sum-and-product rule, it falls out of writing the same polynomial two
ways and matching coefficients term by term. Its two side points are the ones a textbook
drops: the theorem ASSUMES the roots exist, and the leading coefficient is exactly what
ends up in front of the brackets. The second Technion video is the other road, completing
the square, which is where the quadratic formula itself is derived — so the page can say
the two are not competing methods. Both are Hebrew, which is what Avi preferred; no
Hebrew video explains the sum-and-product rule itself, only these do it from above.

  python build/trinom.py [target.html]

Default target pages/workbook.html. Run it on pages/workbook.base.html too, or the next
rebuild drops the guide — same rule as figs.py. Idempotent: it strips the guide an
earlier run wrote before inserting.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "pages" / "workbook.html"
WORK = ROOT / "build"

LEARN = 20
WHY_VIDS = ["FoAOXFY77rc", "iekKEvKvvIM"]
VIDS = ["SJ6NhfMXCAU", "f1ypXqNA9P8"]
VID_TEXT = {
    "FoAOXFY77rc": ("למה",
                    "ההוכחה עצמה, בהשוואת מקדמים, לפולינום ממעלה כללית. הכלל שאתם "
                    "משתמשים בו הוא המקרה הפרטי של מעלה שתיים."),
    "iekKEvKvvIM": ("הכביש השני",
                    "מה עושים כשאין זוג מספרים נוח: מהנדסים ריבוע שלם. זה גם המקום "
                    "שממנו נוסחת השורשים נגזרת."),
    "SJ6NhfMXCAU": ("טכניקה",
                    "השיטה המלאה למקרה שהמקדם של איקס בריבוע שווה לאחד — המכפלה "
                    "מאתרת את זוג המספרים, והסכום הוא זה שמכריע בסימנים."),
    "f1ypXqNA9P8": ("המשך",
                    "מה עושים כשהמקדם שונה מאחד ואין גורם משותף: פיצול האיבר האמצעי "
                    "והוצאת גורם משותף בזוגות."),
}

# --------------------------------------------------------------------------- text
WHY = (
    "⟦x^{2}-26x+25⟧ ו־⟦(x-25)(x-1)⟧ הם אותו פולינום: אותו ערך בכל ⟦x⟧, אותו גרף, אותה "
    "נגזרת. מה שהתחלף הוא <b>מה קל לקרוא ממנו</b> — מהצורה הפתוחה קל לחשב, לגזור ולאנטגרל, "
    "ומהצורה המפורקת קל לראות שורשים, סימן, ומה מצטמצם מול מכנה. פירוק הוא שינוי ייצוג, "
    "לא שינוי ערך, בדיוק כמו מספר מול פירוקו לגורמים ראשוניים. בשמונה־עשר השאלונים "
    "שבמאגר אין אף שאלה שאומרת &rdquo;פרקו לגורמים&ldquo; — הבדיקה מחזירה אפס — והשאלון "
    "בכל זאת מניח את הפירוק בתוך כמעט כל שאלה רציונלית ובתוך כל שאלת חקירה."
)

# --------------------------------------------------------------- why it works
# Written from the Technion's proof video, which derives Vieta by COMPARING
# COEFFICIENTS between the two ways of writing the same polynomial. That is the honest
# answer to "how did anyone arrive at this": nobody guessed the sum-and-product rule,
# it falls out of expanding a product and matching it term by term. Two points from the
# video that a textbook ordering drops: the theorem ASSUMES the roots exist (not every
# polynomial has them), and the leading coefficient is what ends up in front of the
# brackets — which is exactly the mistake the guide's trap warns about.
WHYHOW = [
    ("שתי כתיבות של אותו פולינום",
     "אם לפולינום יש שורשים, אפשר לכתוב אותו גם כמכפלת גורמים לינאריים: "
     "⟦ax^{2}+bx+c⟧ ו־⟦C\\left(x-x_{1}\\right)\\left(x-x_{2}\\right)⟧ הם אותה פונקצייה "
     "בדיוק. שימו לב להנחה, והיא לא טכנית — <b>לא לכל פולינום יש שורשים</b>, ובלי "
     "שורשים ממשיים אין פירוק ממשי. זה בדיוק מה שדיסקרימיננטה שלילית אומרת."),
    ("המנוע: השוואת מקדמים",
     "שתי כתיבות של אותה פונקצייה מחייבות שהמקדם של כל חזקה יהיה זהה בשתיהן. משם זה "
     "מכני: פותחים את המכפלה ומשווים שורה מול שורה. אף אחד לא ניחש את כלל הסכום "
     "והמכפלה — הוא <b>נופל</b> מההשוואה הזאת."),
    ("המקדם של ⟦x^{2}⟧ — לוקחים ⟦x⟧ משני הסוגריים",
     "זו הדרך היחידה לקבל ⟦x^{2}⟧ מהמכפלה, ולכן ⟦C=a⟧. כלומר המספר שיושב בחזית הפירוק "
     "הוא המקדם המוביל עצמו — וזו הסיבה שהשמטתו אינה שגיאת כתיב אלא שינוי של הביטוי."),
    ("המקדם של ⟦x⟧ — ⟦x⟧ מסוגר אחד, מספר מהשני",
     "יש שתי דרכים לעשות זאת, אחת לכל סוגר, ולכן מתקבל <b>סכום</b>: "
     "⟦a\\left(-x_{1}-x_{2}\\right)=b⟧, כלומר ⟦x_{1}+x_{2}=-\\dfrac{b}{a}⟧."),
    ("המספר החופשי — בלי ⟦x⟧ בכלל",
     "לוקחים את המספר משני הסוגריים: ⟦a\\,x_{1}x_{2}=c⟧, כלומר "
     "⟦x_{1}x_{2}=\\dfrac{c}{a}⟧. עם ⟦a=1⟧ אלה בדיוק הסכום והמכפלה שאתם מחפשים, "
     "ובשפת הסוגריים זו שורה אחת: ⟦(x+m)(x+n)=x^{2}+(m+n)x+mn⟧."),
    ("וכשאין זוג נוח — משלימים לריבוע",
     "מוסיפים לשני האגפים את המספר שהופך את ⟦x^{2}+bx⟧ לריבוע שלם, ומגיעים ל&rdquo;משהו "
     "בריבוע שווה מספר&ldquo; שנפתר בלי שום נוסחה: ⟦x^{2}+10x+9=0⟧ הופך ל־"
     "⟦(x+5)^{2}=16⟧ ומכאן ⟦x+5=\\pm 4⟧. הרצת אותו תהליך על ⟦ax^{2}+bx+c=0⟧ הכללי "
     "היא הגזירה של נוסחת השורשים עצמה — ולכן הפירוק והנוסחה אינם שתי שיטות מתחרות."),
]

HOWTO = [
    ("קודם לסדר, ורק אז לתייג",
     "השאלון לא תמיד יגיש את הטרינום מסודר. ⟦x^{2}+18+9x⟧ הוא בדיוק ⟦x^{2}+9x+18⟧, "
     "אבל מי שקורא את המקדמים לפי סדר ההדפסה יקבל ⟦b=18⟧ ו־⟦c=9⟧ ויחפש זוג מספרים שאינו "
     "קיים. מסדרים תמיד באותו מבנה — ⟦x^{2}⟧, אחריו ⟦x⟧, ואחרון המספר החופשי, זה שאינו "
     "צמוד לאף ⟦x⟧ — ורק אז קוראים את ⟦a⟧, ⟦b⟧ ו־⟦c⟧."),
    ("לוודא שהמקדם של ⟦x^{2}⟧ הוא ⟦1⟧",
     "כל שיטת המכפלה־והסכום מדברת על ⟦x^{2}+bx+c⟧ בלבד. אם המקדם אינו ⟦1⟧, הצעד הראשון הוא "
     "לחפש גורם משותף ולהוציא אותו: ⟦2x^{2}-6x-36=2\\left(x^{2}-3x-18\\right)⟧, "
     "והסוגריים כבר עומדים בתנאי. הגורם שהוצא נשאר בחזית עד סוף התשובה ואינו נעלם."),
    ("המכפלה מאתרת, הסכום מכריע",
     "זה הצעד היחיד שצריך לתרגל, וזה גם מה שהופך אותו מניחוש לשיטה: לא מחפשים את המספרים "
     "ואת הסימנים בבת אחת. קודם שואלים אילו שני מספרים מוכפלים ל־⟦c⟧ <b>בלי להסתכל על "
     "הסימן</b> — זו רשימה קצרה וסופית של זוגות מחלקים. רק אחרי שהזוג בידיים, ⟦b⟧ מחליט "
     "אילו סימנים לתלות עליו."),
    ("זוג שלא מגיע ל־⟦b⟧ נפסל, לא נדחק",
     "ב־⟦x^{2}-7x+12⟧ המכפלה 12 נותנת גם ⟦6\\cdot 2⟧ וגם ⟦4\\cdot 3⟧. שום צירוף סימנים של "
     "⟦6⟧ ו־⟦2⟧ לא מגיע ל־⟦-7⟧, ולכן הזוג הזה נפסל <b>כולו</b> ועוברים לבא בתור. ⟦-4⟧ "
     "ו־⟦-3⟧ נותנים מכפלה ⟦12⟧ וסכום ⟦-7⟧, ומכאן ⟦(x-4)(x-3)⟧."),
    ("רושמים את הסוגריים מיד — והבדיקה בחינם",
     "יש ⟦n_{1}⟧ ו־⟦n_{2}⟧? אז ⟦x^{2}+bx+c=(x+n_{1})(x+n_{2})⟧, עם הסימנים כפי שנמצאו, "
     "וסדר הסוגריים אינו משנה. הבדיקה אינה עולה כלום: פותחים את הסוגריים בחזרה, ואם "
     "האיבר האמצעי חוזר — הפירוק נכון. זו גם הדרך הנכונה להיזכר לאן הולכים, כי "
     "⟦(x-2)(x-3)⟧ שנפתח נותן ⟦x^{2}-5x+6⟧."),
    ("שתי קריאות של אותו כלל",
     "המספרים שבסוגריים אינם השורשים אלא נגדיים להם. ב־⟦x^{2}-26x+25⟧ המספרים הם ⟦-25⟧ "
     "ו־⟦-1⟧, והשורשים ⟦25⟧ ו־⟦1⟧. לכן שני הניסוחים שקולים: מכפלת המספרים היא ⟦c⟧ וסכומם "
     "⟦b⟧, ואילו מכפלת השורשים היא ⟦c⟧ וסכומם ⟦-b⟧. כשצריך לצמצם מול מכנה — כותבים את "
     "הסוגריים, לא את רשימת השורשים."),
    ("אין גורם משותף? מפצלים את האיבר האמצעי",
     "כאן מחפשים שני מספרים שסכומם ⟦b⟧ אבל שמכפלתם ⟦a\\cdot c⟧ ולא ⟦c⟧, מפצלים איתם את "
     "⟦bx⟧ לשני איברים, ומוציאים גורם משותף בזוגות. ב־⟦6x^{2}-x-2⟧ המכפלה היא ⟦-12⟧ "
     "והסכום ⟦-1⟧, כלומר ⟦3⟧ ו־⟦-4⟧, ומכאן "
     "⟦6x^{2}+3x-4x-2=3x(2x+1)-2(2x+1)=(2x+1)(3x-2)⟧."),
    ("הדרך שתמיד עובדת — ומה יש בנוסחאון ומה אין",
     "נוסחת השורשים נותנת את ⟦x_{1}⟧ ו־⟦x_{2}⟧, ואז "
     "⟦ax^{2}+bx+c=a\\left(x-x_{1}\\right)\\left(x-x_{2}\\right)⟧. ב־⟦2x^{2}-7x+3⟧ "
     "השורשים ⟦3⟧ ו־⟦\\tfrac{1}{2}⟧, ולכן ⟦2\\left(x-3\\right)\\left(x-\\tfrac{1}{2}"
     "\\right)=(x-3)(2x-1)⟧. ושימו לב מה הנוסחאון נותן ומה לא: יש בו את נוסחת השורשים "
     "ואת ⟦a^{2}-b^{2}=(a-b)(a+b)⟧, ו<b>אין</b> בו לא את הצורה המפורקת ולא את קשרי הסכום "
     "והמכפלה. את שניהם מביאים מהראש."),
]

TRAP = ("להפעיל מכפלה־וסכום על טרינום שהמקדם של ⟦x^{2}⟧ שלו אינו ⟦1⟧, או להשמיט את ⟦a⟧ "
        "כשכותבים ⟦a\\left(x-x_{1}\\right)\\left(x-x_{2}\\right)⟧. שתי הטעויות משנות את "
        "<b>ערך</b> הביטוי ולא רק את צורתו, ובשאלת חקירה הן מזיזות את הגרף כולו.")

SIGNS = [
    ("⟦c>0⟧", "⟦b>0⟧", "שני המספרים חיוביים",
     "⟦x^{2}+9x+18=(x+3)(x+6)⟧"),
    ("⟦c>0⟧", "⟦b<0⟧", "שני המספרים שליליים",
     "⟦x^{2}-7x+12=(x-3)(x-4)⟧"),
    ("⟦c<0⟧", "⟦b>0⟧", "סימנים מנוגדים, והגדול בערכו המוחלט חיובי",
     "⟦x^{2}+2x-15=(x+5)(x-3)⟧"),
    ("⟦c<0⟧", "⟦b<0⟧", "סימנים מנוגדים, והגדול בערכו המוחלט שלילי",
     "⟦x^{2}-3x-18=(x-6)(x+3)⟧"),
]

CAP_FORMS = ("אותו פולינום, שני ייצוגים. הפירוק אינו משנה ערך — הוא רק מוציא את השורשים "
             "אל פני השטח, ולכן בוחרים ייצוג לפי מה שצריך ממנו עכשיו.")

CAP_PIPE = ("אותה שיטה על השאלה שפתחה את הדיון. הזוג ⟦5⟧ ו־⟦5⟧ מוכפל נכון ל־⟦25⟧ ובכל "
            "זאת נפסל, כי שום צירוף סימנים שלו אינו מגיע ל־⟦-26⟧.")

CAP_MATCH = ("פותחים את הצורה המפורקת ומעמידים אותה מול הצורה שנתונה בשאלה. שתי השורות הן "
             "אותה פונקצייה, ולכן כל עמודה חייבת להסכים — ומההסכמה הזאת נופלים הסכום "
             "והמכפלה. אין כאן תגלית, יש קריאה של שורה אחת לשני הכיוונים.")

CAP_SIGNS = ("הסימנים אינם עניין של ניסוי — הם מוכתבים מ־⟦b⟧ ומ־⟦c⟧. ארבע השורות מכסות כל "
             "טרינום שהמקדם שלו ⟦1⟧, וכולן נובעות משורה אחת: "
             "⟦(x+n_{1})(x+n_{2})=x^{2}+(n_{1}+n_{2})x+n_{1}n_{2}⟧.")

BACK = (
    "אף שאלה בחוברת לא אומרת &rdquo;פרקו&ldquo;, ובכל זאת: בבלוק 01 תחום ההגדרה של "
    "⟦\\dfrac{x^{2}-4}{x^{2}-x-6}⟧ נפתח רק אחרי שהמכנה מפורק ל־⟦(x-3)(x+2)⟧; בבלוק 07 "
    "התשובה ⟦f'(x)=3x^{2}-6x-9=3(x-3)(x+1)⟧ היא בדיוק המסלול של צעד 2 — גורם משותף ⟦3⟧, "
    "ואז טרינום שהמקדם שלו ⟦1⟧; ובבלוק 10, מציאת גבולות האינטגרציה של ⟦f(x)=4-x^{2}⟧ מול "
    "⟦g(x)=x+2⟧ היא פתרון ⟦x^{2}+x-2=0⟧, כלומר ⟦(x+2)(x-1)=0⟧ ולכן ⟦-2⟧ ו־⟦1⟧."
)

# Every factorisation asserted above, as (expanded, factored). sympy checks the pair
# before a single byte is written — the same bar the exercises are held to.
CLAIMS = [
    ("x**2 - 26*x + 25", "(x - 25)*(x - 1)"),
    ("x**2 - 5*x + 6", "(x - 2)*(x - 3)"),
    ("x**2 - 7*x + 12", "(x - 4)*(x - 3)"),
    ("x**2 + 2*x - 15", "(x + 5)*(x - 3)"),
    ("x**2 + 9*x + 18", "(x + 3)*(x + 6)"),
    ("x**2 - 3*x - 18", "(x - 6)*(x + 3)"),
    ("x**2 + 18 + 9*x", "(x + 3)*(x + 6)"),
    ("2*x**2 - 6*x - 36", "2*(x**2 - 3*x - 18)"),
    ("6*x**2 - x - 2", "(2*x + 1)*(3*x - 2)"),
    ("6*x**2 + 3*x - 4*x - 2", "3*x*(2*x + 1) - 2*(2*x + 1)"),
    ("2*x**2 - 7*x + 3", "2*(x - 3)*(x - Rational(1,2))"),
    ("2*x**2 - 7*x + 3", "(x - 3)*(2*x - 1)"),
    ("x**2 - 4", "(x - 2)*(x + 2)"),
    ("x**2 - x - 6", "(x - 3)*(x + 2)"),
    ("3*x**2 - 6*x - 9", "3*(x - 3)*(x + 1)"),
    ("(4 - x**2) - (x + 2)", "-(x + 2)*(x - 1)"),
    # the why section: the identity the whole rule is a backwards reading of, the same
    # thing in root form, and the completing-the-square example from the second video
    ("(x + m)*(x + n)", "x**2 + (m + n)*x + m*n"),
    ("a*(x - p)*(x - q)", "a*x**2 - a*(p + q)*x + a*p*q"),
    ("x**2 + 10*x + 9", "(x + 5)**2 - 16"),
]


def verify() -> None:
    from sympy import Rational, expand, symbols  # noqa: F401  (Rational used by eval)
    # the loop variables must not be named a or b: the claims themselves use `a` as the
    # leading coefficient, and a loop variable of that name shadows the symbol
    x, m, n, a, p, q = symbols("x m n a p q")  # noqa: F841  (used by eval)
    for lhs, rhs in CLAIMS:
        if expand(eval(lhs) - eval(rhs)) != 0:
            raise SystemExit("sympy: %s is not %s" % (lhs, rhs))
    print("sympy: %d factorisations verified" % len(CLAIMS))


# --------------------------------------------------------------------------- svg
FG, MUT, LINE = "var(--on-surface)", "var(--on-surface-var)", "var(--outline)"
ACC, PANEL = "var(--primary)", "var(--sc)"


def lbl(x, y, t, size=15, colour=None, bold=True, ltr=True, extra=""):
    """text-anchor is always middle: start/end swap sides under direction:rtl, and a
    label that swaps sides slides out of the viewBox. Latin and formulas need an
    explicit direction="ltr" or `= (sin x)²` comes out reversed."""
    return ('<text x="%s" y="%s" text-anchor="middle" font-size="%s"%s%s fill="%s"%s>%s</text>'
            % (x, y, size, ' font-weight="700"' if bold else "",
               ' direction="ltr"' if ltr else "", colour or FG, extra, t))


def arrow(mid):
    return ('<marker id="%s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            'markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="%s"/></marker>'
            % (mid, ACC if mid == "trp" else MUT))


def fig_forms():
    """The two representations side by side. In RTL the right-hand panel is read first,
    so the open form sits on the right and the factored form on the left — the arrow
    labelled פירוק therefore points leftwards, which is also forwards."""
    s = ['<svg viewBox="0 0 900 280" role="img" aria-label="שתי הצורות של אותו פולינום: '
         'הצורה הפתוחה מימין, הצורה המפורקת משמאל, וחיצי פירוק ופתיחת סוגריים ביניהן">']
    s.append("<defs>%s%s</defs>" % (arrow("trp"), arrow("trm")))
    for x0 in (540, 40):
        s.append('<rect x="%d" y="36" width="320" height="96" fill="%s" stroke="%s" '
                 'stroke-width="2"/>' % (x0, PANEL, LINE))
    s.append(lbl(700, 64, "הצורה הפתוחה", 13, MUT, bold=False, ltr=False))
    s.append(lbl(700, 106, "x&#178; &#8722; 26x + 25", 21))
    s.append(lbl(200, 64, "הצורה המפורקת", 13, MUT, bold=False, ltr=False))
    s.append(lbl(200, 106, "(x &#8722; 25)(x &#8722; 1)", 21, ACC))
    s.append('<line x1="528" y1="70" x2="374" y2="70" stroke="%s" stroke-width="2.5" '
             'marker-end="url(#trp)"/>' % ACC)
    s.append(lbl(451, 58, "פירוק", 13, ACC, ltr=False))
    s.append('<line x1="372" y1="112" x2="526" y2="112" stroke="%s" stroke-width="2" '
             'marker-end="url(#trm)"/>' % MUT)
    s.append(lbl(451, 132, "פתיחת סוגריים", 12, MUT, bold=False, ltr=False))
    s.append('<line x1="40" y1="162" x2="860" y2="162" stroke="%s" stroke-width="1.5"/>' % LINE)
    s.append('<line x1="450" y1="176" x2="450" y2="270" stroke="%s" stroke-width="1.5"/>' % LINE)
    for cx in (700, 200):
        s.append(lbl(cx, 196, "מה קל לקרוא ממנה", 11.5, MUT, bold=False, ltr=False))
    for i, t in enumerate(("ערך בנקודה", "נגזרת ואינטגרל", "המקדמים עצמם")):
        s.append(lbl(700, 224 + i * 24, t, 14, FG, bold=False, ltr=False))
    for i, t in enumerate(("השורשים: 25 ו&#8209;1", "סימן הביטוי", "מה מצטמצם מול מכנה")):
        s.append(lbl(200, 224 + i * 24, t, 14, FG, bold=False, ltr=False))
    s.append("</svg>")
    return "\n          ".join(s)


def fig_match():
    """Coefficient comparison, drawn on the monic case so no subscripts are needed.

    The roots are called m and n rather than x₁ and x₂ on purpose: a subscript in SVG
    costs a tspan, and neither font stack on this page carries the Unicode subscript
    digits. m and n are also the names the how-to uses for the numbers in the brackets,
    so the picture and the procedure speak about the same two things."""
    s = ['<svg viewBox="0 0 900 274" role="img" aria-label="הצורה המפורקת נפתחת, '
         'ומועמדת עמודה מול עמודה מול הצורה הפתוחה, וכך מתקבלים הסכום והמכפלה">']
    s.append("<defs>%s</defs>" % arrow("trn"))
    s.append(lbl(450, 40, "הצורה המפורקת", 12, MUT, bold=False, ltr=False))
    s.append(lbl(450, 76, "(x + m)(x + n)", 22, ACC))
    s.append('<line x1="450" y1="94" x2="450" y2="124" stroke="%s" stroke-width="2" '
             'marker-end="url(#trn)"/>' % MUT)
    s.append(lbl(576, 116, "פתיחת סוגריים", 12, MUT, bold=False, ltr=False))
    for x in (325, 575):
        s.append('<line x1="%d" y1="136" x2="%d" y2="236" stroke="%s" stroke-width="1.5" '
                 'stroke-dasharray="4 5"/>' % (x, x, LINE))
    cols = (200, 450, 700)
    for cx, t in zip(cols, ("x&#178;", "+ (m + n) x", "+ m &#183; n")):
        s.append(lbl(cx, 164, t, 20))
    s.append(lbl(450, 192, "והצורה שנתונה בשאלה", 12, MUT, bold=False, ltr=False))
    for cx, t in zip(cols, ("x&#178;", "+ b x", "+ c")):
        s.append(lbl(cx, 222, t, 20))
    s.append('<line x1="40" y1="242" x2="860" y2="242" stroke="%s" stroke-width="1.5"/>' % LINE)
    s.append(lbl(200, 266, "זהה בשתי השורות", 13, MUT, bold=False, ltr=False))
    s.append(lbl(450, 266, "m + n = b", 16, ACC))
    s.append(lbl(700, 266, "m &#183; n = c", 16, ACC))
    s.append("</svg>")
    return "\n          ".join(s)


def fig_pipeline():
    """The method itself, on Avi's own example, as three stages read right to left.
    The rejected pair is struck through rather than marked with a glyph: a ✓/✗ pair
    needs colour to read, and in the light palette small coloured text is exactly what
    the skin forbids."""
    s = ['<svg viewBox="0 0 900 250" role="img" aria-label="שלושה שלבים: המכפלה מאתרת את '
         'זוג המספרים, הסכום מכריע בסימנים, ואז נרשמות הסוגריים">']
    s.append("<defs>%s</defs>" % arrow("trq"))
    s.append(lbl(450, 26, "x&#178; &#8722; 26x + 25", 19))
    panels = [(620, "1 &#183; המכפלה מאתרת"), (325, "2 &#183; הסכום מכריע"),
              (30, "3 &#183; רושמים סוגריים")]
    for x0, head in panels:
        s.append('<rect x="%d" y="48" width="250" height="160" fill="%s" stroke="%s" '
                 'stroke-width="2"/>' % (x0, PANEL, LINE))
        s.append(lbl(x0 + 125, 80, head, 12.5, MUT, ltr=False))
    for x1, x2 in ((612, 585), (317, 290)):
        s.append('<line x1="%d" y1="128" x2="%d" y2="128" stroke="%s" stroke-width="2.5" '
                 'marker-end="url(#trq)"/>' % (x1, x2, MUT))
    s.append(lbl(745, 116, "c = 25", 17))
    s.append(lbl(745, 148, "25 = 1 &#183; 25", 15, MUT, bold=False))
    s.append(lbl(745, 176, "25 = 5 &#183; 5", 15, MUT, bold=False))
    s.append(lbl(450, 116, "b = &#8722;26", 17))
    s.append(lbl(450, 148, "(&#8722;25) + (&#8722;1) = &#8722;26", 15))
    s.append(lbl(450, 176, "(&#8722;5) + (&#8722;5) = &#8722;10", 15, MUT, bold=False,
                 extra=' text-decoration="line-through"'))
    s.append(lbl(155, 124, "(x &#8722; 25)(x &#8722; 1)", 18, ACC))
    s.append(lbl(155, 168, "השורשים: 25 ו&#8209;1", 13, MUT, bold=False, ltr=False))
    s.append("</svg>")
    return "\n          ".join(s)


# --------------------------------------------------------------------------- katex
def render(chunks):
    tex = {}
    for c in chunks:
        for f in re.findall(r"⟦(.*?)⟧", c):
            tex[f] = f
    (WORK / "tr_tex.json").write_text(json.dumps(tex, ensure_ascii=False), encoding="utf-8")
    (WORK / "tr_render.mjs").write_text(
        'import katex from "katex";\nimport fs from "fs";\n'
        'const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));\n'
        "const out = {};\nlet bad = 0;\n"
        "for (const [k, t] of Object.entries(map)) {\n"
        '  try { out[k] = katex.renderToString(t, {displayMode:false, throwOnError:true, strict:false}); }\n'
        '  catch (e) { bad++; console.error("KATEX FAIL:", t, "->", e.message); }\n'
        "}\n"
        'fs.writeFileSync(process.argv[3], JSON.stringify(out));\n'
        'console.error("katex: rendered " + Object.keys(out).length + ", failures " + bad);\n',
        encoding="utf-8")
    subprocess.run(["node", str(WORK / "tr_render.mjs"), str(WORK / "tr_tex.json"),
                    str(WORK / "tr_html.json")], cwd=str(ROOT), check=True)
    done = json.loads((WORK / "tr_html.json").read_text(encoding="utf-8"))
    missing = sorted(set(tex) - set(done))
    if missing:
        raise SystemExit("formulas failed to render: " + repr(missing))
    return done


# --------------------------------------------------------------------------- build
def build(math) -> str:
    vids = json.loads((ROOT / "data" / "blockvids.json").read_text(encoding="utf-8"))

    def cards(ids: list) -> str:
        out = []
        for vid in ids:
            v = vids[vid]
            kicker, cap = VID_TEXT[vid]
            out.append(
                '      <a class="bvid" href="%s" target="_blank" rel="noopener">\n'
                '        <span class="bthumb"><img src="data:image/jpeg;base64,%s" alt="%s" '
                'loading="lazy"><span class="btag">סרטון</span></span>\n'
                '        <span class="bm">\n'
                '          <span class="bw">%s &#183; %s</span>\n'
                '          <span class="bt">%s</span>\n'
                '          <span class="bc">%s</span>\n'
                "        </span>\n      </a>"
                % (v["url"], v["b64"], v["title"], kicker, v["author"], v["title"], cap))
        return "\n".join(out)

    def steplist(items) -> str:
        return "\n".join("        <li><b>%s.</b> %s</li>" % (math(t), math(b))
                         for t, b in items)

    steps = steplist(HOWTO)
    rows = "\n".join(
        "        <tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
        % (math(c), math(b), sg, math(ex)) for c, b, sg, ex in SIGNS)

    return f"""  <!--TRINOM-->
  <article class="block guide">
    <div class="bhead">
      <span class="bnum">00</span>
      <div>
        <h3>פירוק טרינום — מהצורה הפתוחה לסוגריים</h3>
        <p class="bwhy">{math(WHY)}</p>
      </div>
    </div>
    <figure class="fig" style="margin-top:18px">
          {fig_forms()}
      <figcaption>{math(CAP_FORMS)}</figcaption>
    </figure>
    <div class="blockvids">
{cards(WHY_VIDS)}
    </div>
    <div class="howto why">
      <span class="hlabel">למה זה עובד &#183; מאיפה הכלל הגיע</span>
      <ol>
{steplist(WHYHOW)}
      </ol>
    </div>
    <figure class="fig" style="margin-top:16px">
          {fig_match()}
      <figcaption>{math(CAP_MATCH)}</figcaption>
    </figure>
    <div class="blockvids">
{cards(VIDS)}
    </div>
    <div class="howto">
      <span class="hlabel">המדריך &#183; כ־{LEARN} דקות ללמוד את השיטה</span>
      <ol>
{steps}
      </ol>
      <p class="trap"><b>המלכודת:</b> {math(TRAP)}</p>
    </div>
    <figure class="fig" style="margin-top:16px">
          {fig_pipeline()}
      <figcaption>{math(CAP_PIPE)}</figcaption>
    </figure>
    <figure style="margin-top:16px">
      <div class="tablewrap">
        <table>
          <thead><tr><th>המכפלה</th><th>הסכום</th><th>הסימנים בסוגריים</th><th>דוגמה</th></tr></thead>
          <tbody>
{rows}
          </tbody>
        </table>
      </div>
      <figcaption>{math(CAP_SIGNS)}</figcaption>
    </figure>
    <div class="callout why" style="margin-top:16px">
      <h3>איפה זה חוזר, בלי להיקרא בשם</h3>
      <p>{math(BACK)}</p>
    </div>
  </article>
  <!--/TRINOM-->
"""


def main() -> None:
    verify()
    pool = ([WHY, TRAP, BACK, CAP_FORMS, CAP_PIPE, CAP_SIGNS, CAP_MATCH]
            + [t + " " + b for t, b in HOWTO + WHYHOW]
            + [c + " " + b + " " + ex for c, b, _s, ex in SIGNS])
    done = render(pool)

    def math(chunk: str) -> str:
        return re.sub(r"⟦(.*?)⟧",
                      lambda m: '<span class="tex">' + done[m.group(1)] + "</span>", chunk)

    s = P.read_text(encoding="utf-8")
    s = re.sub(r"  <!--TRINOM-->[\s\S]*?  <!--/TRINOM-->\n+", "", s)   # idempotent
    anchor = re.search(
        r'<div class="shead"><span class="num">01</span><h2>טכניקה אלגברית</h2></div>'
        r'\s*<p class="sub">[\s\S]*?</p>\n\n', s)
    if not anchor:
        raise SystemExit("section 01 not found in " + str(P))
    s = s[:anchor.end()] + build(math) + "\n" + s[anchor.end():]
    P.write_text(s, encoding="utf-8")
    print("guide written into %s | %d kb" % (P.name, len(s.encode()) // 1024))


if __name__ == "__main__":
    main()
