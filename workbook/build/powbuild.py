import json

TEX = []


def T(latex):
    TEX.append(latex)
    return "\x00TEX%d\x00" % (len(TEX) - 1)


STYLE = open("eqpage.raw", encoding="utf-8").read()
STYLE = STYLE[STYLE.index("<style>"):STYLE.index("</style>") + len("</style>")]

EXTRA = """<style>
.fig svg{display:block;width:100%;min-width:660px;max-width:100%;height:auto;color:var(--on-surface);}
.fig{overflow-x:auto;}
.fig figcaption{min-width:660px;}
td.bad{color:var(--tertiary);font-weight:700;}
td.mono code{white-space:nowrap;}
.big{font-size:19px;}
.pair{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:14px;}
.pcard{background:var(--sc-high);border-radius:var(--r-m);padding:16px 18px;}
.pcard b{display:block;font-size:13px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--tertiary);margin-bottom:8px;}
.pcard p{font-size:14px;color:var(--on-surface-var);margin-top:8px;line-height:1.5;}
</style>"""

BODY = f"""
<div class="page" dir="rtl" lang="he">

<header class="hero">
  <p class="eyebrow">קריאת מתמטיקה למהנדסי תוכנה &#183; חלק ב</p>
  <h1>על מה ה<em>חזקה</em> חלה</h1>
  <p class="lede">{T(r"x^{2}")} ברור כי הבסיס הוא מספר. {T(r"\sin^{2}x")} מבלבל כי הבסיס נראה כמו שם של פונקצייה — והמעריך לפעמים חל על הפונקצייה ולפעמים על מה שהיא מחזירה. זו לא אי־הבנה שלך; זו חריגה אמיתית בסימון.</p>
</header>

<section>
  <div class="shead"><span class="num">01</span><h2>שני כללים, לא אחד</h2></div>
  <p class="sub">מעריך תמיד אומר &ldquo;חזור על הפעולה n פעמים&rdquo;. השאלה היחידה היא <b>איזו פעולה</b> — וזה תלוי במה שעומד מתחת למעריך.</p>
  <div class="pair">
    <div class="pcard">
      <b>הבסיס הוא מספר</b>
      <p class="big">{T(r"x^{3}=x\cdot x\cdot x")}</p>
      <p>הפעולה החוזרת היא <b>כפל</b>. ההופכי תחת כפל הוא ההופכי המוכר: {T(r"x^{-1}=\dfrac{1}{x}")}.</p>
    </div>
    <div class="pcard">
      <b>הבסיס הוא פונקצייה</b>
      <p class="big">{T(r"f^{3}=f\circ f\circ f")}</p>
      <p>הפעולה החוזרת היא <b>הרכבה</b>. ההופכי תחת הרכבה הוא הפונקצייה ההופכית: {T(r"f^{-1}")}, זו שמבטלת את <i>f</i> — ולא {T(r"\dfrac{1}{f}")}.</p>
    </div>
  </div>
  <div class="callout" style="margin-top:16px">
    <h3>וכאן טריגונומטריה שוברת את הכלל</h3>
    <p>{T(r"\sin^{2}x")} <b>אינו</b> {T(r"\sin(\sin x)")}. הוא {T(r"(\sin x)^{2}")} — כלומר כאן המעריך החיובי מתנהג לפי כלל המספרים, למרות שהוא כתוב על שם של פונקצייה. אבל {T(r"\sin^{-1}x")} דווקא כן מתנהג לפי כלל הפונקציות והוא {T(r"\arcsin x")}. אותו מיקום בדיוק, שתי משמעויות סותרות, לפי הסימן של המעריך. אילו זה היה קוד, זה לא היה עובר code review.</p>
  </div>
</section>

<section>
  <div class="shead"><span class="num">02</span><h2>איפה בדיוק יושבת החריגה</h2></div>
  <p class="sub">שני הביטויים נראים זהים במבנה. ההבדל היחיד הוא הסימן של המעריך — וזה מזיז את הטווח שעליו הוא חל.</p>
  <figure class="fig">
    <svg viewBox="0 0 900 330" role="img" aria-label="השוואה: בסינוס בריבוע המעריך חל על הערך המוחזר, ובסינוס בחזקת מינוס אחת הוא חל על הפונקצייה עצמה">
      <defs>
        <marker id="pa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/>
        </marker>
      </defs>

      <rect x="470" y="24" width="410" height="286" rx="22" fill="var(--sc-high)"/>
      <text x="675" y="60" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--on-surface-var)">מעריך חיובי &#183; כלל המספרים</text>
      <text x="675" y="120" text-anchor="middle" direction="ltr" font-size="38" fill="currentColor" font-style="italic">sin<tspan font-size="22" dy="-16">2</tspan><tspan dy="16" font-size="38"> x</tspan></text>
      <path d="M628 136 L628 152 L722 152 L722 136" fill="none" stroke="var(--primary)" stroke-width="2.5"/>
      <path d="M675 152 L675 174" fill="none" stroke="var(--primary)" stroke-width="2.5" marker-end="url(#pa)" color="var(--primary)"/>
      <text x="675" y="196" text-anchor="middle" font-size="13" font-weight="700" fill="var(--primary)">חל על הערך שהפונקצייה מחזירה</text>
      <text x="675" y="234" text-anchor="middle" direction="ltr" font-size="20" fill="currentColor" font-style="italic">= (sin x)<tspan font-size="13" dy="-9">2</tspan></text>
      <text x="675" y="276" text-anchor="middle" direction="ltr" font-size="14" font-family="monospace" fill="var(--on-surface-var)">Math.sin(x) ** 2</text>

      <rect x="20" y="24" width="410" height="286" rx="22" fill="var(--tertiary-container)"/>
      <text x="225" y="60" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--on-tertiary-container)">מעריך 1&#8722; &#183; כלל הפונקציות</text>
      <text x="225" y="120" text-anchor="middle" direction="ltr" font-size="38" fill="var(--on-tertiary-container)" font-style="italic">sin<tspan font-size="22" dy="-16">&#8722;1</tspan><tspan dy="16" font-size="38"> x</tspan></text>
      <path d="M177 136 L177 152 L233 152 L233 136" fill="none" stroke="var(--on-tertiary-container)" stroke-width="2.5"/>
      <path d="M205 152 L205 174" fill="none" stroke="var(--on-tertiary-container)" stroke-width="2.5" marker-end="url(#pa)" color="var(--on-tertiary-container)"/>
      <text x="225" y="196" text-anchor="middle" font-size="13" font-weight="700" fill="var(--on-tertiary-container)">חל על הפונקצייה עצמה, לא על הערך</text>
      <text x="225" y="234" text-anchor="middle" direction="ltr" font-size="20" fill="var(--on-tertiary-container)" font-style="italic">= arcsin x</text>
      <text x="225" y="276" text-anchor="middle" direction="ltr" font-size="14" font-family="monospace" fill="var(--on-tertiary-container)">Math.asin(x)</text>
    </svg>
    <figcaption>הסוגריים המצוירים הם טווח החלות של המעריך. משמאל הוא עוטף רק את <i>sin</i>, מימין הוא עוטף את <i>sin x</i> כולו — ושום דבר בכתיב עצמו לא מסגיר את ההבדל. זו הסיבה שבמקום לזכור כלל, עדיף לתרגם בראש לקוד: {T(r"\sin^{2}x")} הוא <code>sin(x)**2</code>, ו־{T(r"\sin^{-1}x")} הוא <code>asin(x)</code>.</figcaption>
  </figure>
</section>

<section>
  <div class="shead"><span class="num">03</span><h2>טבלת התרגום</h2></div>
  <p class="sub">כל מה שתפגוש בשאלון, ומה זה בקוד. השורה האדומה היא היחידה שבה הסימון באמת מטעה.</p>
  <div class="tablewrap">
    <table>
      <thead><tr><th>הסימון</th><th>מה זה אומר</th><th>בקוד</th></tr></thead>
      <tbody>
        <tr><td class="big">{T(r"x^{2}")}</td><td>{T(r"x\cdot x")}</td><td class="mono"><code>x*x</code></td></tr>
        <tr><td class="big">{T(r"x^{-1}")}</td><td>{T(r"\dfrac{1}{x}")} — הבסיס מספר, ולכן הופכי בכפל</td><td class="mono"><code>1/x</code></td></tr>
        <tr><td class="big">{T(r"x^{1/2}")}</td><td>{T(r"\sqrt{x}")} — מעריך שברי הוא שורש</td><td class="mono"><code>Math.sqrt(x)</code></td></tr>
        <tr><td class="big">{T(r"\sin^{2}x")}</td><td>{T(r"(\sin x)^{2}")} — מחשבים סינוס, ואז מעלים בריבוע</td><td class="mono"><code>Math.sin(x)**2</code></td></tr>
        <tr><td class="big">{T(r"\sin x^{2}")}</td><td>{T(r"\sin(x^{2})")} — מעלים בריבוע קודם! המעריך על <i>x</i>, לא על הסינוס</td><td class="mono"><code>Math.sin(x*x)</code></td></tr>
        <tr><td class="big">{T(r"\sin 2x")}</td><td>{T(r"\sin(2x)")} — לא קשור לחזקות בכלל, וגם לא שווה {T(r"2\sin x")}</td><td class="mono"><code>Math.sin(2*x)</code></td></tr>
        <tr><td class="big bad">{T(r"\sin^{-1}x")}</td><td class="bad">{T(r"\arcsin x")} — הפונקצייה ההופכית. <b>לא</b> {T(r"\dfrac{1}{\sin x}")}</td><td class="mono"><code>Math.asin(x)</code></td></tr>
        <tr><td class="big">{T(r"(\sin x)^{-1}")}</td><td>{T(r"\dfrac{1}{\sin x}")} — הסוגריים מכריחים את כלל המספרים</td><td class="mono"><code>1/Math.sin(x)</code></td></tr>
        <tr><td class="big">{T(r"f^{-1}(x)")}</td><td>הפונקצייה ההופכית — זו שמחזירה את הקלט המקורי</td><td class="mono"><code>fInverse(x)</code></td></tr>
        <tr><td class="big">{T(r"f'(x)")}</td><td>נגזרת. {T(r"f''(x)")} היא נגזרת שנייה — גרש, לא מעריך</td><td class="mono"><code>derivative(f)(x)</code></td></tr>
        <tr><td class="big">{T(r"e^{x}")}</td><td>המעריך הוא המשתנה. שונה לגמרי מ־{T(r"x^{e}")}</td><td class="mono"><code>Math.exp(x)</code></td></tr>
      </tbody>
    </table>
  </div>
</section>

<section>
  <div class="shead"><span class="num">04</span><h2>למה בכלל המציאו את זה</h2></div>
  <div class="grid g2">
    <div class="callout why">
      <h3>קיצור שנולד מזהויות</h3>
      <p>הזהות המרכזית בטריגונומטריה נכתבת {T(r"\sin^{2}x+\cos^{2}x=1")}. בלי הקיצור היא הייתה {T(r"(\sin x)^{2}+(\cos x)^{2}=1")}, וזהויות שלמות היו מתמלאות בסוגריים מקוננים. הקיצור הזה חוסך המון רעש בפרק הזהויות — וזו הסיבה שהוא שרד למרות חוסר העקביות.</p>
    </div>
    <div class="callout good">
      <h3>כלל הכתיבה שלך בבחינה</h3>
      <p>כשאתה <b>קורא</b> — פענח לפי הטבלה. כשאתה <b>כותב</b> — אתה לא חייב לחקות את הקיצור. {T(r"(\sin x)^{2}")} עם סוגריים תמיד נכון, אף בודק לא יוריד עליו נקודה, והוא מונע ממך לטעות בעצמך באמצע חישוב ארוך. הסוגריים עולים שתי שניות וחוסכים שגיאות סימן.</p>
    </div>
  </div>
</section>

<section>
  <div class="shead"><span class="num">05</span><h2>מה מזה באמת בשאלון 35571</h2></div>
  <div class="tablewrap">
    <table>
      <thead><tr><th>סימון</th><th>מופיע?</th><th>איפה</th></tr></thead>
      <tbody>
        <tr><td class="big">{T(r"\sin^{2}x")}</td><td class="role">הרבה</td><td>זהויות טריגונומטריות ופונקציות טריגונומטריות — בלוקים 6 ו‑8 בחוברת</td></tr>
        <tr><td class="big">{T(r"f'(x)")} , {T(r"f''(x)")}</td><td class="role">הרבה</td><td>כל פרק החדו&quot;א. נגזרת שנייה משמשת לקביעת סוג נקודת קיצון ולנקודות פיתול</td></tr>
        <tr><td class="big">{T(r"f^{-1}(x)")}</td><td class="role">לפעמים</td><td>סעיף הופכית בשאלת חקירה. שים לב שזה הופכית ולא {T(r"\dfrac{1}{f(x)}")}</td></tr>
        <tr><td class="big">{T(r"x^{1/2}")}</td><td class="role">לפעמים</td><td>גזירת פונקציות שורש — לרוב כותבים {T(r"\sqrt{x}")}, אבל בגזירה נוח להמיר למעריך</td></tr>
        <tr><td class="big">{T(r"\sin^{-1}x")}</td><td class="role">כמעט לא</td><td>בעברית כותבים arcsin, או פשוט פותרים על מעגל היחידה. זה בעיקר כפתור במחשבון</td></tr>
      </tbody>
    </table>
  </div>
</section>

<p class="foot">זהו החלק השני בסדרת הסימון. הראשון — <a href="https://claude.ai/code/artifact/8f4f4421-fe0b-4c83-9a10-f06aa46fed1b">סימן השוויון</a>, על ההבדל בין הגדרה, אילוץ וזהות. שניהם נספחים ל<a href="https://claude.ai/code/artifact/474015de-e74f-459d-b11c-6f5ec4294762">חוברת מדרגות 571</a>.</p>

</div>
"""

html = "<title>על מה החזקה חלה</title>\n" + STYLE + EXTRA + BODY
json.dump(TEX, open("powtex.json", "w", encoding="utf-8"), ensure_ascii=False)
open("powpage.raw", "w", encoding="utf-8").write(html)
print("placeholders:", len(TEX))
