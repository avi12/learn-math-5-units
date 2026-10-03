"""Attach a verified video to each section of the equals-sign page (per Avi's rule:
video next to its topic, never bundled in one place)."""
s = open("eqbuild.py", encoding="utf-8").read()

# ---------- 1. CSS ----------
CSS = """.blockvids{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(292px,1fr));margin-top:18px;}
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
.foot{margin-top:60px;"""
assert ".foot{margin-top:60px;" in s
s = s.replace(".foot{margin-top:60px;", CSS, 1)

# ---------- 2. helper + data, injected before BODY ----------
HELPER = '''
import json as _json
_V = _json.load(open("eqvids.json", encoding="utf-8"))


def vid(key, role, cap):
    d = _V[key]
    t = d["title"].replace("&", "&amp;").replace("<", "&lt;")
    a = d["author"].replace("&", "&amp;").replace("<", "&lt;")
    return (
        f'    <a class="bvid" href="https://www.youtube.com/watch?v={key}" target="_blank" rel="noopener">\\n'
        f'      <span class="bthumb"><img src="data:image/jpeg;base64,{d["b64"]}" alt="{t}" loading="lazy">'
        f'<span class="btag">סרטון</span></span>\\n'
        f'      <span class="bm">\\n'
        f'        <span class="bw">{role} &#183; {a}</span>\\n'
        f'        <span class="bt">{t}</span>\\n'
        f'        <span class="bc">{cap}</span>\\n'
        f'      </span>\\n'
        f'    </a>'
    )


def vids(*cards):
    return '  <div class="blockvids">\\n' + "\\n".join(cards) + "\\n  </div>"


BODY = f"""'''
assert 'BODY = f"""' in s
s = s.replace('BODY = f"""', HELPER, 1)

# ---------- 3. insert the groups at their sections ----------
A2 = ("רק ההקשר מבדיל — ולכן בשאלון תמיד יש מילת מפתח: <b>נתונה</b> / <b>נסמן</b> להגדרה, "
      "<b>פתרו</b> / <b>מצאו</b> לאילוץ, <b>הוכיחו</b> / <b>הראו כי</b> לזהות.</p>")
assert A2 in s
s = s.replace(A2, A2 + "\n" + '{vids(' + '\n'.join([
    'vid("IHmnSYj1gPA", "הגדרה מול אילוץ מול זהות",',
    '    "שש דקות מצוירות שמפרידות בין ביטוי, משוואה, נוסחה וזהות — בדיוק ההבחנה של הטבלה שלמעלה, בלי מתמטיקה כבדה."),',
    'vid("M89lTUQBtTo", "המקרה הגבולי",',
    '    "ממוקד בשאלה אחת: מתי {T(r\\"=\\")} הוא טענה שנכונה רק לערכים מסוימים, ומתי לכל ערך. קצר ותכליתי.")',
]) + ')}', 1)

A3 = "</figcaption>\n  </figure>\n\n  <div class=\"callout\" style=\"margin-top:16px\">\n    <h3>הכלל שמחליף את כל הכללים</h3>"
assert A3 in s
s = s.replace(A3, "</figcaption>\n  </figure>\n\n" + '{vids(' + '\n'.join([
    'vid("m4eiYHL3PP8", "השרשרת הימנית",',
    '    "פתרונות מזויפים במשוואות עם שורש: למה העלאה בריבוע יוצרת אותם, ולמה הבדיקה בסוף אינה אופציונלית."),',
    'vid("BRRolKTlF6Q", "השרשרת השמאלית",',
    '    "למה חילוק באפס אסור — וזו בדיוק הסיבה שחילוק בביטוי עם נעלם מוחק פתרונות בשקט.")',
]) + ')}\n\n  <div class="callout" style="margin-top:16px">\n    <h3>הכלל שמחליף את כל הכללים</h3>', 1)

A4 = "<td>לבדוק כל פתרון</td></tr>\n      </tbody>\n    </table>\n  </div>\n</section>"
assert A4 in s
s = s.replace(A4, "<td>לבדוק כל פתרון</td></tr>\n      </tbody>\n    </table>\n  </div>\n" + '{vids(' + '\n'.join([
    'vid("ea9kgUY0FSw", "תרגול הבדיקה",',
    '    "עשרה תרגילים שבהם הבדיקה בסוף היא העיקר. טוב לראות כמה מהר זה הופך לרפלקס."),',
    'vid("dsBOW0sqJvE", "בעברית",',
    '    "משוואות אי־רציונליות בעברית, כולל הסיבה שחייבים לבדוק — אותו סרטון שצמוד לבלוק הראשון בחוברת.")',
]) + ')}\n</section>', 1)

open("eqbuild.py", "w", encoding="utf-8").write(s)
print("css + helper + 3 video groups inserted")
