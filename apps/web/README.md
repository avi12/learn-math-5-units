<div dir="rtl">

# לוח מתמטיקה

לוח כתיבה בעט לטאבלט, שמשתקף בזמן אמת למסך המחשב. כותבים פתרון ביד בטאבלט, והמחשב
שולח אותו כתמונה לשיחה עם Claude — יחד עם התרגיל שנבחר ועם הקריטריונים שבוחן בגרות
בודק לפיהם.

הלוח הוא חצי מפרויקט לימוד לבגרות ב‑5 יחידות מתמטיקה. החצי השני — חוברת התרגול, תוסף
הכרום והאינטגרציה עם Claude — נמצא ב‑[learn-math-5-units](https://github.com/avi12/learn-math-5-units).

נכתב על ידי **Avi** ([avi12.com](https://avi12.com)).

## ארבעה חלקים, שני מאגרים

| החלק | איפה | מה הוא עושה |
|---|---|---|
| **אפליקציית הרשת** | כאן, `src/` | Svelte 5 + Firebase. עט עם לחץ, מחק, צורות שנצמדות למשבצות, גלילה ברצועה אין־סופית, סנכרון בין המכשירים, ובחירת תרגיל מהחוברת |
| **אפליקציית האנדרואיד** | כאן, `android/` | עטיפת WebView לטאבלט: כפתור העט של S Pen, דארק מוד של המערכת, שיתוף קבצים ופתיחת קישור QR לתוך החדר |
| **תוסף הכרום** | [`learn-math-5-units/extension`](https://github.com/avi12/learn-math-5-units/tree/main/extension) | לוקח את הלוח והתרגיל מהדף ומדביק אותם בשיחה חדשה ב‑claude.ai |
| **האינטגרציה עם Claude** | [`learn-math-5-units/build`](https://github.com/avi12/learn-math-5-units/tree/main/build) | הבוחן: פרומפט שבודק את **הדרך** מול דרישות שיש להן מקור, ותבנית לסרטון הסבר ב‑Manim עם קריינות ElevenLabs |

## איך זה עובד

1. פותחים את האתר במחשב. מופיע קוד QR.
2. סורקים אותו פעם אחת מהטאבלט, ושני המכשירים נכנסים לאותו חדר. החדר נשמר בשניהם.
3. כותבים בטאבלט. הכתב מופיע במחשב תוך כדי.
4. במחשב: **העתק כתמונה** (או בחלקים, ללוח ארוך), או **שקלוד יבדוק** — שעובר דרך התוסף.

החדר הוא מזהה אקראי בן 32 תווים, ואין התחברות. מי שיודע את המזהה רואה את הלוח, ומי
שלא — לא יכול לנחש אותו ולא לרשום את החדרים (`firestore.rules`).

## הרצה

הקוד לא מצביע על אף פרויקט Firebase. כל התקנה מביאה פרויקט משלה:

1. יוצרים פרויקט ב‑[Firebase](https://console.firebase.google.com), מוסיפים לו **Web app**
   ומסד **Firestore** (מצב production).
2. מעתיקים את ההגדרות:

   ```bash
   cp .env.example .env               # ממלאים מתוך Project settings → Your apps
   cp .firebaserc.example .firebaserc # מזהה הפרויקט
   ```

3. מתקינים ומריצים:

   ```bash
   npm i
   npm run dev
   ```

4. פורסים את האתר ואת חוקי המסד:

   ```bash
   npm run check
   npm run deploy      # בנייה + Firebase Hosting + firestore.rules, דרך gcloud
   ```

   ‏`scripts/deploy.py` לוקח את הפרויקט מ‑`.env` ואת החשבון מ‑`gcloud config get account`
   (או מ‑`GCLOUD_ACCOUNT`).

### אנדרואיד

```bash
echo "padHost=<your-project>.web.app" >> android/local.properties
python scripts/apk.py            # בונה APK לדיבאג
python scripts/apk.py --install  # ומתקין על טאבלט מחובר ב‑USB
```

## בדיקות

הבדיקות הן סקריפטים של Node שמריצים Chrome בלי ממשק דרך DevTools Protocol:

```bash
npx vite preview --port 4173
chrome --headless=new --remote-debugging-port=9431 --user-data-dir=<תיקייה> about:blank
node gridcheck.mjs http://localhost:4173/ 9431
```

כל קובץ `*check.mjs` / `*test.mjs` בודק דבר אחד, והכותרת שלו מסבירה מה ולמה. בדיקות
שזורעות נתונים (`erasecost`, `scrollcost`) כותבות למסד ב‑REST, ולכן נלקח הפרויקט מ‑`.env`.

## ההחלטות

כל החלטה, מדידה ובאג שנתפס בדרך — ב‑[`docs/devlog.md`](docs/devlog.md). זה יומן, ולא
מדריך: הוא נכתב לפי הסדר שבו הדברים קרו.

## רישיון

[GPL-3.0-or-later](LICENSE). © Avi ([avi12.com](https://avi12.com)).

רכיבים של צד שלישי שנארזים עם האפליקציה שומרים על הרישיון שלהם: הגופן Latin Modern Math
(GUST Font License, `src/lib/fonts`) ו‑Temml (MIT).

</div>
