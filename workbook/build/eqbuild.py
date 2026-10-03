import json, re

TEX = []


def T(latex):
    """queue a LaTeX snippet, return a placeholder"""
    TEX.append(latex)
    return "\x00TEX%d\x00" % (len(TEX) - 1)


HEAD = """<title>סימן השוויון</title>
<style>
:root{
  --primary:#454CB3; --on-primary:#FFFFFF;
  --primary-container:#E1E0FF; --on-primary-container:#050B69;
  --secondary:#5B5D72; --secondary-container:#E1E0F9; --on-secondary-container:#181A2C;
  --tertiary:#7C5265; --tertiary-container:#FFD8E6; --on-tertiary-container:#301021;
  --success:#2C6A47; --success-container:#B3F1C8; --on-success-container:#00210F;
  --warn:#7A5900; --warn-container:#FFE08C; --on-warn-container:#261A00;
  --surface:#FBF8FF;
  --sc-lowest:#FFFFFF; --sc-low:#F5F2FC; --sc:#EFEDF6; --sc-high:#E9E6F1; --sc-highest:#E3E0EC;
  --on-surface:#1A1B21; --on-surface-var:#454657;
  --outline:#767688; --outline-variant:#C6C5D6; --grid:#D8D6E6;
  --r-xl:28px; --r-l:20px; --r-m:14px; --r-full:999px;
  --ease:cubic-bezier(0.2,0,0,1);
  --font-display:"Segoe UI Variable Display","Segoe UI","Assistant","Heebo","Rubik",system-ui,sans-serif;
  --font-body:"Segoe UI Variable Text","Segoe UI","Assistant","Heebo",system-ui,sans-serif;
  --font-mono:"Cascadia Mono",Consolas,ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --primary:#BFC2FF; --on-primary:#111A8A;
    --primary-container:#2C33A0; --on-primary-container:#E1E0FF;
    --secondary:#C4C5DD; --secondary-container:#434659; --on-secondary-container:#E1E0F9;
    --tertiary:#EEB8CE; --tertiary-container:#61394D; --on-tertiary-container:#FFD8E6;
    --success:#98D5AC; --success-container:#0E5131; --on-success-container:#B3F1C8;
    --warn:#EBC26B; --warn-container:#5C4300; --on-warn-container:#FFE08C;
    --surface:#121318;
    --sc-lowest:#0B0C11; --sc-low:#1A1B21; --sc:#1E1F25; --sc-high:#292A30; --sc-highest:#34343C;
    --on-surface:#E4E1EC; --on-surface-var:#C6C5D6;
    --outline:#90909F; --outline-variant:#454657; --grid:#2A2B33;
  }
}
:root[data-theme="dark"]{
  --primary:#BFC2FF; --on-primary:#111A8A;
  --primary-container:#2C33A0; --on-primary-container:#E1E0FF;
  --secondary:#C4C5DD; --secondary-container:#434659; --on-secondary-container:#E1E0F9;
  --tertiary:#EEB8CE; --tertiary-container:#61394D; --on-tertiary-container:#FFD8E6;
  --success:#98D5AC; --success-container:#0E5131; --on-success-container:#B3F1C8;
  --warn:#EBC26B; --warn-container:#5C4300; --on-warn-container:#FFE08C;
  --surface:#121318;
  --sc-lowest:#0B0C11; --sc-low:#1A1B21; --sc:#1E1F25; --sc-high:#292A30; --sc-highest:#34343C;
  --on-surface:#E4E1EC; --on-surface-var:#C6C5D6;
  --outline:#90909F; --outline-variant:#454657; --grid:#2A2B33;
}
body{background:var(--surface);color:var(--on-surface);}
.page{direction:rtl;background:var(--surface);color:var(--on-surface);font-family:var(--font-body);
  font-size:16px;line-height:1.6;max-width:1000px;margin:0 auto;padding:0 20px 96px;-webkit-font-smoothing:antialiased;}
.page *{box-sizing:border-box;}
.page p{margin:0;}
.page h1,.page h2,.page h3,.page h4{margin:0;text-wrap:balance;font-family:var(--font-display);}
.page a{color:var(--primary);text-decoration-thickness:1px;text-underline-offset:3px;}
.page a:focus-visible{outline:3px solid var(--primary);outline-offset:3px;border-radius:8px;}
code{font-family:var(--font-mono);font-size:.88em;direction:ltr;unicode-bidi:isolate;
  background:var(--sc-highest);border-radius:6px;padding:1px 7px;}
.katex{direction:ltr;unicode-bidi:isolate;font-size:1.06em;}
.tex{display:inline-block;max-width:100%;overflow-x:auto;overflow-y:hidden;vertical-align:middle;padding-block:2px;}

.hero{position:relative;overflow:hidden;margin-top:28px;border-radius:var(--r-xl);padding:52px 40px 44px;
  background:repeating-linear-gradient(to right,var(--grid) 0 1px,transparent 1px 32px),
             repeating-linear-gradient(to bottom,var(--grid) 0 1px,transparent 1px 32px),var(--sc-low);}
.hero::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(125% 95% at 88% 0%,transparent 0%,var(--sc-low) 80%);}
.hero > *{position:relative;z-index:1;}
.eyebrow{font-size:12.5px;font-weight:700;letter-spacing:.12em;color:var(--tertiary);text-transform:uppercase;}
.hero h1{font-size:clamp(36px,6vw,58px);font-weight:800;line-height:1.05;letter-spacing:-.02em;margin-top:14px;}
.hero h1 em{font-style:normal;color:var(--primary);}
.lede{margin-top:20px;font-size:19px;line-height:1.55;color:var(--on-surface-var);max-width:56ch;}

section{margin-top:68px;}
.shead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:8px;}
.shead h2{font-size:clamp(24px,3.2vw,32px);font-weight:750;letter-spacing:-.015em;}
.shead .num{font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--on-surface-var);
  background:var(--sc-high);border-radius:var(--r-full);padding:3px 11px;}
.sub{color:var(--on-surface-var);font-size:16.5px;max-width:70ch;margin-bottom:24px;}

.callout{border-radius:var(--r-xl);padding:26px 30px;background:var(--warn-container);color:var(--on-warn-container);}
.callout h3{font-size:20px;font-weight:750;margin-bottom:10px;}
.callout.why{background:var(--tertiary-container);color:var(--on-tertiary-container);}
.callout.good{background:var(--success-container);color:var(--on-success-container);}
.grid{display:grid;gap:16px;}
.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));}

figure{margin:0;}
.fig{background:var(--sc-low);border-radius:var(--r-xl);padding:26px 24px 20px;}
figcaption{margin-top:16px;font-size:14.5px;line-height:1.55;color:var(--on-surface-var);}

.chains{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));}
.chain h4{font-size:15px;font-weight:750;margin-bottom:4px;}
.chain .ch-note{font-size:13px;color:var(--on-surface-var);margin-bottom:14px;}
.step{display:flex;justify-content:space-between;align-items:center;gap:14px;
  background:var(--sc-high);border-radius:var(--r-m);padding:11px 16px;}
.step.final{background:var(--success-container);color:var(--on-success-container);}
.step .sset{font-size:12.5px;white-space:nowrap;opacity:.8;font-variant-numeric:tabular-nums;}
.lnk{display:flex;align-items:center;justify-content:center;position:relative;height:42px;}
.lnk::before{content:"";position:absolute;top:0;bottom:0;width:2px;background:var(--outline-variant);}
.lnk span{position:relative;background:var(--sc-low);border-radius:var(--r-full);padding:3px 12px;
  font-size:12px;color:var(--on-surface-var);}
.lnk.oneway::before{background:var(--tertiary);width:3px;}
.lnk.oneway span{background:var(--tertiary-container);color:var(--on-tertiary-container);font-weight:700;}

.tablewrap{overflow-x:auto;border-radius:var(--r-xl);background:var(--sc-low);}
table{border-collapse:collapse;width:100%;min-width:640px;font-size:14.5px;}
th,td{text-align:right;padding:14px 18px;vertical-align:top;}
thead th{font-size:12.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--on-surface-var);
  font-weight:700;background:var(--sc);}
tbody tr + tr td{border-top:1px solid var(--outline-variant);}
td.role{font-weight:700;white-space:nowrap;}
td.arrow{font-size:19px;font-weight:700;text-align:center;white-space:nowrap;}
td.arrow.safe{color:var(--success);}
td.arrow.risk{color:var(--tertiary);}
.blockvids{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(292px,1fr));margin-top:18px;}
.bvid{display:grid;grid-template-columns:128px 1fr;gap:14px;align-items:stretch;background:var(--sc);
  border-radius:var(--r-m);overflow:hidden;text-decoration:none;color:inherit;transition:background .3s var(--ease);}
.bvid:hover{background:var(--sc-high);}
.bvid .bthumb{position:relative;background:var(--sc-highest);}
.bvid img{width:100%;height:100%;object-fit:cover;display:block;}
.bvid .btag{position:absolute;inset-block-end:6px;inset-inline-start:6px;background:var(--primary);
  color:var(--on-primary);font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:var(--r-full);}
.bvid .bm{padding:12px 0 12px 14px;display:flex;flex-direction:column;gap:4px;justify-content:center;}
.bvid .bw{font-size:10.5px;font-weight:700;letter-spacing:.05em;color:var(--tertiary);text-transform:uppercase;}
.bvid .bt{font-size:13.5px;font-weight:700;line-height:1.3;}
.bvid .bc{font-size:12px;color:var(--on-surface-var);line-height:1.42;}
@media(prefers-reduced-motion:reduce){.bvid{transition:none;}}
.foot{margin-top:60px;padding-top:24px;border-top:1px solid var(--outline-variant);
  font-size:13.5px;color:var(--on-surface-var);line-height:1.65;}
</style>
"""


def step(formula, sset, cls=""):
    return (f'      <div class="step {cls}"><span>{formula}</span>'
            f'<span class="sset">{sset}</span></div>')


def lnk(label, oneway=False):
    return f'      <div class="lnk{" oneway" if oneway else ""}"><span>{label}</span></div>'



import json as _json
_V = _json.load(open("eqvids.json", encoding="utf-8"))


def vid(key, role, cap):
    d = _V[key]
    t = d["title"].replace("&", "&amp;").replace("<", "&lt;")
    a = d["author"].replace("&", "&amp;").replace("<", "&lt;")
    return (
        f'    <a class="bvid" href="https://www.youtube.com/watch?v={key}" target="_blank" rel="noopener">\n'
        f'      <span class="bthumb"><img src="data:image/jpeg;base64,{d["b64"]}" alt="{t}" loading="lazy">'
        f'<span class="btag">סרטון</span></span>\n'
        f'      <span class="bm">\n'
        f'        <span class="bw">{role} &#183; {a}</span>\n'
        f'        <span class="bt">{t}</span>\n'
        f'        <span class="bc">{cap}</span>\n'
        f'      </span>\n'
        f'    </a>'
    )


def vids(*cards):
    return '  <div class="blockvids">\n' + "\n".join(cards) + "\n  </div>"


BODY = f"""
<div class="page" dir="rtl" lang="he">

<header class="hero">
  <p class="eyebrow">קריאת מתמטיקה למהנדסי תוכנה</p>
  <h1>סימן ה<em>שוויון</em></h1>
  <p class="lede">הבלבול מוצדק: בתכנות יש שני סימנים לשני דברים, ובמתמטיקה יש סימן אחד לארבעה. אבל אף אחד מהארבעה אינו השמה — וברגע שזה מתיישב, &ldquo;לבדוק את הפתרונות&rdquo; מפסיק להיות טקס ומתחיל להיות הכרח.</p>
</header>

<section>
  <div class="shead"><span class="num">01</span><h2>אין השמה במתמטיקה. בכלל.</h2></div>
  <p class="sub">זו הנקודה שפותרת את רוב הבלבול. במתמטיקה אין זיכרון שמשתנה לאורך זמן, ולכן אין פעולה שכותבת ערך לתוך משתנה. <code>=</code> תמיד <b>טוען טענה</b> ששני הצדדים הם אותו ערך — לעולם לא מבצע פעולה.</p>
  <div class="grid g2">
    <div class="callout why">
      <h3>המשפט שממחיש הכל</h3>
      <p style="font-size:17px;margin-bottom:10px"><code>x = x + 1</code></p>
      <p>בקוד: שורה שימושית לגמרי, מגדילה מונה. במתמטיקה: {T(r"x = x+1")} היא משוואה חסרת פתרון — אין מספר ששווה לעצמו ועוד אחד. אותם תווים בדיוק, שני עולמות.</p>
    </div>
    <div class="callout good">
      <h3>המודל הנכון בראש</h3>
      <p>מתמטיקה קרובה הרבה יותר לשפה פונקציונלית טהורה מאשר לשפה אימפרטיבית. אין <code>let mut</code>. יש <code>const</code>, יש טענות, ויש דרישות שצריך לספק. כשאתה פותר משוואה, <b>x לא משתנה תוך כדי</b> — הוא ערך קבוע ולא ידוע, ואתה מצמצם את קבוצת המועמדים לו.</p>
    </div>
  </div>
</section>

<section>
  <div class="shead"><span class="num">02</span><h2>ארבעת התפקידים של אותו סימן</h2></div>
  <p class="sub">בתכנות כל אחד מאלה מקבל תחביר משלו. במתמטיקה כולם נכתבים <code>=</code>, וההבחנה נופלת על מילות הפתיחה של השאלה.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>מה כתוב</th><th>התפקיד</th><th>המקבילה בקוד</th><th>מה זה אומר</th></tr></thead>
      <tbody>
        <tr><td>{T(r"f(x)=x^{2}-3x")}<br><span style="font-size:12.5px;opacity:.7">אחרי &ldquo;נתונה הפונקצייה&rdquo;</span></td>
            <td class="role">הגדרה</td><td><code>const f = x =&gt; x*x - 3*x</code></td>
            <td>קשירת שם. מעכשיו <i>f</i> הוא כינוי לביטוי הזה. אין מה לפתור.</td></tr>
        <tr><td>{T(r"x^{2}=4")}<br><span style="font-size:12.5px;opacity:.7">אחרי &ldquo;פתרו&rdquo; או &ldquo;מצאו את x&rdquo;</span></td>
            <td class="role">אילוץ</td><td><code>solve(x =&gt; x*x === 4)</code></td>
            <td>שאלה: אילו ערכים מספקים את התנאי? התשובה היא <b>קבוצה</b>, לפעמים ריקה.</td></tr>
        <tr><td>{T(r"\sin^{2}x+\cos^{2}x=1")}<br><span style="font-size:12.5px;opacity:.7">אחרי &ldquo;הוכיחו כי&rdquo;</span></td>
            <td class="role">זהות</td><td>property test, <code>∀x</code></td>
            <td>טענה שנכונה לכל ערך בתחום. אין כאן נעלם — יש טענה כללית.</td></tr>
        <tr><td>{T(r"2x+6=2(x+3)")}<br><span style="font-size:12.5px;opacity:.7">בתוך שורות הפתרון שלך</span></td>
            <td class="role">שכתוב</td><td>refactor שמשמר ערך</td>
            <td>אותו ערך, כתוב אחרת. זה ה־<code>==</code> שתמיד מחזיר true.</td></tr>
      </tbody>
    </table>
  </div>
  <p class="sub" style="margin-top:18px">שים לב ש{T(r"f(x)=x^{2}-3x")} ו־{T(r"f(x)=0")} נראים זהים לחלוטין מבחינה תחבירית, ובכל זאת הראשון הוא הגדרה והשני שאלה. רק ההקשר מבדיל — ולכן בשאלון תמיד יש מילת מפתח: <b>נתונה</b> / <b>נסמן</b> להגדרה, <b>פתרו</b> / <b>מצאו</b> לאילוץ, <b>הוכיחו</b> / <b>הראו כי</b> לזהות.</p>
{vids(vid("IHmnSYj1gPA", "הגדרה מול אילוץ מול זהות",
    "שש דקות מצוירות שמפרידות בין ביטוי, משוואה, נוסחה וזהות — בדיוק ההבחנה של הטבלה שלמעלה, בלי מתמטיקה כבדה."),
vid("M89lTUQBtTo", "המקרה הגבולי",
    "ממוקד בשאלה אחת: מתי סימן השוויון טוען משהו שנכון רק לערכים מסוימים, ומתי הוא טוען משהו שנכון לכל ערך."))}
</section>

<section>
  <div class="shead"><span class="num">03</span><h2>מה באמת קורה כשפותרים משוואה</h2></div>
  <p class="sub">כל שורה בפתרון היא <b>טענה נפרדת</b>, וביניהן יש חץ לוגי. רוב החצים דו־כיווניים, ושניים מהם לא — ובדיוק שם נכנסות ויוצאות טעויות.</p>

  <figure class="fig">
    <div class="chains">

      <div class="chain">
        <h4>המשוואה מרוויחה פתרון מזויף</h4>
        <p class="ch-note">העלאה בריבוע אינה הפיכה — כמו hash, היא ממפה שני קלטים שונים לאותו פלט.</p>
{step(T(r"\sqrt{2x+7}=x+2"), "S = {1}")}
{lnk('העלאה בריבוע &nbsp;·&nbsp; הכיוון <span style="direction:ltr;unicode-bidi:isolate;font-weight:700">⟹</span> בלבד', True)}
{step(T(r"2x+7=x^{2}+4x+4"), "S = {1, −3}")}
{lnk('<span style="direction:ltr;unicode-bidi:isolate">⟺</span>')}
{step(T(r"x^{2}+2x-3=0"), "S = {1, −3}")}
{lnk('<span style="direction:ltr;unicode-bidi:isolate">⟺</span>')}
{step(T(r"x=1 \;,\; x=-3"), "S = {1, −3}")}
{lnk("סינון מול השורה הראשונה")}
{step(T(r"x=1"), "S = {1}", "final")}
      </div>

      <div class="chain">
        <h4>המשוואה מאבדת פתרון אמיתי</h4>
        <p class="ch-note">חילוק בביטוי שיש בו נעלם מניח בשקט שהוא אינו אפס.</p>
{step(T(r"x^{2}=3x"), "S = {0, 3}")}
{lnk('חילוק ב־x &nbsp;·&nbsp; הכיוון <span style="direction:ltr;unicode-bidi:isolate;font-weight:700">⟸</span> בלבד', True)}
{step(T(r"x=3"), "S = {3}")}
{lnk("החזרת המקרה שנשלל")}
{step(T(r"x=0 \;,\; x=3"), "S = {0, 3}", "final")}
        <p class="ch-note" style="margin-top:14px">הדרך הבטוחה: להעביר אגף ולפרק — {T(r"x(x-3)=0")} — ואז שני הפתרונות נשארים.</p>
      </div>

    </div>
    <figcaption>עמודת <b>S</b> היא כל הסיפור: היא מראה בדיוק באיזה מעבר קבוצת הפתרונות משתנה. בצד ימין היא גדלה, ולכן חייבים לסנן בסוף; בצד שמאל היא מתכווצת, ולכן חייבים להחזיר את המקרה שנשלל. שאר המעברים דו־כיווניים ולכן אינם דורשים דבר.</figcaption>
  </figure>

{vids(vid("m4eiYHL3PP8", "השרשרת הימנית",
    "פתרונות מזויפים במשוואות עם שורש: למה העלאה בריבוע יוצרת אותם, ולמה הבדיקה בסוף אינה אופציונלית."),
vid("BRRolKTlF6Q", "השרשרת השמאלית",
    "למה חילוק באפס אסור — וזו בדיוק הסיבה שחילוק בביטוי עם נעלם מוחק פתרונות בשקט."))}

  <div class="callout" style="margin-top:16px">
    <h3>הכלל שמחליף את כל הכללים</h3>
    <p>אחרי כל שורה בפתרון, שאל שאלה אחת: <b>האם אפשר לחזור אחורה?</b> אם כן — הכל בסדר, אין מה לבדוק. אם לא — סימן שאיבדת מידע, ואתה חייב פעולת תיקון: לסנן פתרונות מזויפים, או להחזיר מקרה שנשלל. זה בדיוק אותו רפלקס של &ldquo;האם הטרנספורמציה הזו הפיכה?&rdquo;</p>
  </div>
</section>

<section>
  <div class="shead"><span class="num">04</span><h2>טבלת הפעולות</h2></div>
  <p class="sub">להדפיס ולתלות. העמודה האמצעית היא היחידה שצריך לזכור.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>הפעולה</th><th>הכיוון</th><th>מה קורה לקבוצת הפתרונות</th><th>מה חייבים לעשות</th></tr></thead>
      <tbody>
        <tr><td>חיבור או חיסור של אותו ביטוי בשני האגפים</td><td class="arrow safe">⟺</td><td>לא משתנה</td><td>כלום</td></tr>
        <tr><td>כפל או חילוק במספר קבוע ששונה מאפס</td><td class="arrow safe">⟺</td><td>לא משתנה</td><td>כלום</td></tr>
        <tr><td>העלאה בריבוע (או בכל חזקה זוגית)</td><td class="arrow risk">⟹</td><td>עלולה <b>לגדול</b></td><td>להציב כל פתרון בחזרה במשוואה המקורית</td></tr>
        <tr><td>כפל באגף שיש בו נעלם (סילוק מכנה)</td><td class="arrow risk">⟹</td><td>עלולה <b>לגדול</b></td><td>לפסול פתרון שמאפס מכנה מקורי</td></tr>
        <tr><td>חילוק בביטוי שיש בו נעלם</td><td class="arrow risk">⟸</td><td>עלולה <b>להתכווץ</b></td><td>לבדוק בנפרד מה קורה כשהביטוי מתאפס</td></tr>
        <tr><td>הפעלת פונקצייה חד־חד־ערכית ({T(r"\ln")}, חזקה אי־זוגית)</td><td class="arrow safe">⟺</td><td>לא משתנה</td><td>רק לוודא תחום הגדרה</td></tr>
        <tr><td>הפעלת פונקצייה שאינה חח&quot;ע ({T(r"\sin")}, ריבוע)</td><td class="arrow risk">⟹</td><td>עלולה <b>לגדול</b></td><td>לבדוק כל פתרון</td></tr>
      </tbody>
    </table>
  </div>
{vids(vid("ea9kgUY0FSw", "תרגול הבדיקה",
    "עשרה תרגילים שבהם הבדיקה בסוף היא העיקר. טוב לראות כמה מהר זה הופך לרפלקס."),
vid("dsBOW0sqJvE", "בעברית",
    "משוואות אי־רציונליות בעברית, כולל הסיבה שחייבים לבדוק — אותו סרטון שצמוד לבלוק הראשון בחוברת."))}
</section>

<section>
  <div class="shead"><span class="num">05</span><h2>ההרגל שגונב נקודות</h2></div>
  <div class="grid g2">
    <div class="callout">
      <h3>שרשור שגוי של סימני שוויון</h3>
      <p style="margin-bottom:10px">כתיבה כזאת נפוצה מאוד ופסולה לגמרי:</p>
      <p style="margin-bottom:10px">{T(r"x^{2}=4=x=\pm 2")}</p>
      <p>היא טוענת ש־{T(r"4")} שווה ל־{T(r"x")}, וזה שקר. סימן שוויון מחבר <b>ערכים</b>, לא שלבים בפתרון. בין שורות משתמשים בירידת שורה או בחץ לוגי — לא ב־<code>=</code>. בקוד לא היית כותב <code>a == b == c</code> ומתכוון לשלושה דברים שונים.</p>
    </div>
    <div class="callout good">
      <h3>איך זה נראה נכון</h3>
      <p>שורה לכל טענה, מלמעלה למטה:</p>
      <p style="margin-top:10px">{T(r"x^{2}=4")}</p>
      <p style="margin-top:6px">{T(r"x^{2}-4=0")}</p>
      <p style="margin-top:6px">{T(r"(x-2)(x+2)=0")}</p>
      <p style="margin-top:6px">{T(r"x=2 \;,\; x=-2")}</p>
      <p style="margin-top:12px">כל שורה נכונה בפני עצמה, וכל מעבר כאן הפיך — ולכן אין מה לבדוק בסוף.</p>
    </div>
  </div>
</section>

<p class="foot">הדף הזה הוא נספח ל<a href="https://claude.ai/code/artifact/474015de-e74f-459d-b11c-6f5ec4294762">חוברת מדרגות 571</a> — מדרגה 2 בבלוק הראשון שם היא בדיוק המקרה של העלאה בריבוע, ומדרגה 3 היא תחום הגדרה עם מכנה. החלק השני בסדרה — <a href="https://claude.ai/code/artifact/fcd226f6-4c6e-4816-b6d2-32b6b0656761">על מה החזקה חלה</a>, על sin²x מול sin⁻¹x. סימוני <span style="white-space:nowrap">⟹ / ⟸ / ⟺</span> אינם נדרשים בכתיבה בבחינה; בשאלון מספיק לכתוב שורה לכל טענה ולהוסיף את הבדיקה במפורש. מה שכן נדרש הוא התוצאה: פתרון מזויף שלא נפסל, או פתרון אמיתי שאבד, עולים נקודות.</p>

</div>
"""

html = HEAD + BODY
json.dump(TEX, open("eqtex.json", "w", encoding="utf-8"), ensure_ascii=False)
open("eqpage.raw", "w", encoding="utf-8").write(html)
print("placeholders:", len(TEX))
