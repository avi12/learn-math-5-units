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
