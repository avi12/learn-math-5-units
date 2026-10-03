<div dir="rtl">

# סרטון הסבר בעברית: ⁦f(x) = |x-3| + |x+1|⁩

אנימציית Manim עם קריינות בעברית וכתוביות עבריות צרובות. זו הדוגמה שממנה נגזרה פסקת
"סרטון לכל פער" בפרומפט הבדיקה (`prompt_text()` ב‑`build/rebuild.py`): שיחה עם Claude
שמחובר אליה ה‑connector של ElevenLabs יכולה לבנות סרטון כזה בעצמה.

| קובץ | מה הוא |
|---|---|
| `abs_value_captioned.py` | הסצנה (`ThinkingProcessCaptioned`) |
| `line1.mp3` … `line7.mp3` | הקריינות, קובץ לכל כתובית. ElevenLabs, מודל `eleven_v3`. **לא במאגר** — מפיקים מחדש |
| `final_video.mp4` | הסרטון המרונדר עם הקריינות. **לא במאגר** |

## הגדרה ב‑claude.ai — פעם אחת

כדי ששיחת הבדיקה תוכל להפיק סרטון בעצמה, צריך שלושה דברים בחשבון claude.ai:

1. **לחבר את ElevenLabs:** ‏Customize ← Connectors ← ElevenLabs ← Connect.
2. **הרשאות — Always allow, ברמת הקבוצה.** באותו מסך יש לכלים של ה‑connector שתי קבוצות
   (Read-only ו‑Write/delete). מעבירים **את שתיהן** ל‑Always allow. בלי זה כל קריאה מחכה
   ללחיצה על "Allow once", ובלי לחיצה היא נכשלת ב‑"No approval received".
   ⚠️ להגדיר על הקבוצה ולא על כלי בודד: ה‑connector מסדר את הכלים מחדש בין הקבוצות, ושינוי
   כזה מאפס הגדרה של כלי בודד בחזרה ל‑Needs approval. אחרי השמירה — לרענן ולוודא.
3. **לפתוח את הדומיין של קובצי האודיו:** ‏Settings ← Capabilities ← Additional allowed domains
   ← להוסיף `storage.googleapis.com`. שם יושבים קובצי ה‑mp3 ש‑ElevenLabs מחזיר, וסביבת הקוד של
   השיחה חוסמת אותו כברירת מחדל (`403`, ‏`x-deny-reason: host_not_allowed`).
   ⚠️ **השינוי חל רק על שיחה חדשה.** שיחה שכבר פתוחה נשארת עם הרשימה הישנה וממשיכה לקבל 403.

ועוד דבר אחד שכדאי לדעת: בחשבון ElevenLabs חינמי קריאה בודדת נדחית לפעמים ב‑"free access blocked
due to unusual activity". זה חולף — ניסיון חוזר עבר — אבל מנוי בתשלום מונע את זה.

## בנייה

```bash
# 1. רינדור (צריך LaTeX על ה‑PATH, למשל MiKTeX)
manim -qm abs_value_captioned.py ThinkingProcessCaptioned

# 2. אורך כל קטע קריינות
for n in 1 2 3 4 5 6 7; do ffprobe -i line$n.mp3 -show_entries format=duration -v quiet -of csv="p=0"; done

# 3. מיזוג: כל קטע מתחיל כשה‑Write של הכתובית שלו מתחיל (במילישניות)
V=media/videos/abs_value_captioned/720p30/ThinkingProcessCaptioned.mp4
ffmpeg -y -i $V -i line1.mp3 -i line2.mp3 -i line3.mp3 -i line4.mp3 -i line5.mp3 -i line6.mp3 -i line7.mp3 -filter_complex \
"[1]adelay=2400:all=1[a1];[2]adelay=12100:all=1[a2];[3]adelay=20800:all=1[a3];[4]adelay=31700:all=1[a4];[5]adelay=42600:all=1[a5];[6]adelay=53500:all=1[a6];[7]adelay=60500:all=1[a7];[a1][a2][a3][a4][a5][a6][a7]amix=inputs=7:normalize=0,apad[a]" \
-map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest final_video.mp4
```

## תזמון

`Write` של טקסט עברי ארוך לוקח 2 שניות ולא שנייה: Manim נותן לאובייקט ארוך `run_time`
ארוך יותר כברירת מחדל. לכן **לא מסכמים את ההמתנות ביד** — זמני ההתחלה למעלה נקראו בהרצה
יבשה שרושמת את `self.renderer.time` בכל `Write` ו‑`FadeOut` של כתובית:

| קטע | אודיו (ש') | כתובית על המסך (ש') | מתחיל ב‑(ש') |
|---|---|---|---|
| 1 | 4.96 | 5.4 | 2.4 |
| 2 | 6.08 | 6.5 | 12.1 |
| 3 | 6.48 | 9.9 | 20.8 |
| 4 | 6.96 | 9.9 | 31.7 |
| 5 | 3.92 | 9.9 | 42.6 |
| 6 | 3.92 | 6.0 | 53.5 |
| 7 | 4.16 | 8.0 | 60.5 |

שינית המתנה? מריצים שוב את ההרצה היבשה ומעדכנים את ערכי `adelay`.

## כיוון הכתיבה

`Write` מצייר את האותיות של `Text` משמאל לימין, כלומר עברית נכתבת מסוף המשפט. הפתרון:
`Text` נפרד לכל שורה, ‏`arrange(DOWN, aligned_edge=RIGHT)`, ו‑`line.sort(lambda p: -p[0])`
לפני ה‑`Write`.

</div>
