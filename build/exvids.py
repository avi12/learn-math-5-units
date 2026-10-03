# -*- coding: utf-8 -*-
"""A video per exercise, for the pad's question card.

    python build/exvids.py              # verify, fetching only what the cache is missing
    python build/exvids.py --refresh    # re-fetch every id from YouTube

Avi: "בעבור כל שאלה תוסיף קישורים לסרטונים רלוונטיים שמסבירים איך לפתור", and then
"אבל רק בדסקטופ". The workbook already carries a video per BLOCK — the topic's idea and
its procedure — which is the right grain for learning a topic and the wrong grain for a
question in front of you: block 05 links one geometry playlist while its nine exercises
want the inscribed-angle theorem, then Thales, then the chord proportion. So each
exercise names its own one or two videos here, and the pad shows them next to the
question it is showing. Desktop only, like the finish button: the tablet is for writing,
and its card is already folded down to 17svh.

**The map is the knowledge; `data/exvids.json` is only a cache of what YouTube said.**
PICKS below is the single home of "which video for which exercise" — the ids came from
the topic playlists of the two channels the repo already uses (`data/playlists.json`),
enumerated with `yt-dlp --flat-playlist`, and were chosen by reading each exercise
against the lesson titles. The JSON next to it holds title, channel and length, which are
YouTube's to state and ours only to display.

Four things are checked, and each one is a mistake this repo has already made once:

  * **Coverage is derived, never a literal.** The expectation is whatever
    `pages/workbook.html` carries — block 01 has thirteen exercises, the others nine —
    for the same reason `exercises.py` computes its own count.
  * **Every row carries a real title and a real channel.** They come from oEmbed while
    it answers and otherwise from the channel's own playlist listing — never from a
    guess, and ⚠️ never through WebFetch, which mangles Hebrew channel names
    ("עובד לב ארי" came back as "עובד לב אריד"). Unlike `addvids.py`, a 401 from oEmbed
    is NOT a rejection here; see `oembed` for why.
  * **A length on every row**, so nothing here is a Short.
  * **No video that solves a real exam question.** The whole workbook is synthesised
    precisely so that no exercise is anchored to a paper; a link that walks through
    35571 קיץ 2026 would hand back what the synthesis was protecting, and two of the
    papers are kept as mock exams.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent
CACHE = ROOT / "data" / "exvids.json"
UA = {"User-Agent": "Mozilla/5.0"}

# Anything under this is a Short, not a lesson.
MIN_SECONDS = 90

# Seconds between requests. Not politeness theatre: a hundred and thirty watch pages
# back to back earned 429 for a good while, and every row here had to be re-read from a
# playlist listing because of it.
THROTTLE = 0.8

# A lesson that solves a specific paper, by its title. The mock-exam papers are the
# sharp end of this, but the rule is the general one: we teach the technique, not a
# question someone was once asked.
SOLVES_A_PAPER = re.compile(r"פתרון בגרות|פתרון לשאלון|בגרות \d{3} |קיץ 2026|חורף 2026")

# exercise -> the videos that explain how to solve it, most useful first.
# `tier.n` is the key the pad already uses for an exercise (`exKey` in App.svelte), so a
# renumbered list moves a link to the wrong question instead of losing it silently.
PICKS: dict[str, dict[str, tuple[str, ...]]] = {
    # 01 שברים, שורשים ותחום הגדרה
    "01": {
        "1.1": ("6ZPyglzZyUA", "kjIK2lNlMdQ"),
        "1.2": ("_KUNq-XCqYE", "6ZPyglzZyUA"),
        "1.3": ("WGxPf8cuuos", "PnGSbF5p0T0"),
        "2.1": ("dsBOW0sqJvE", "ndJ-fFO1glI"),
        "2.2": ("Sm6cB3pudaQ", "NM5hl8jPUGg"),
        "2.3": ("fOvoi2ZTrZ0", "6ZPyglzZyUA"),
        "3.1": ("0MsaeFleXeo", "g1pL6Aj3umI"),
        "3.2": ("ABcl6GWNloc", "OBMhVJj72t0"),
        "3.3": ("GU4hqYJEc4c", "4iNjoOvcUXA"),
        "3.4": ("jXZcPRIGiEY", "ZlbUhMld_Mc"),
        "3.5": ("0MYtsX-uo9c", "ABcl6GWNloc"),
        "3.6": ("dsBOW0sqJvE", "0MsaeFleXeo"),
        "3.7": ("M_pI34QtbGg", "dsBOW0sqJvE"),
    },
    # 02 סדרות — כולן הנדסיות, כי סדרה חשבונית אינה נלמדת בתשפ"ז
    "02": {
        "1.1": ("n372JvLMe3o", "guEjpor-X_M"),
        "1.2": ("obi5rsDH9Ko", "oUJW8K9WwnY"),
        "1.3": ("4saO_FQl9QE", "v_B9tCrGl5o"),
        "2.1": ("1J5Im9GhXj0", "v_B9tCrGl5o"),
        "2.2": ("n372JvLMe3o", "kVpds-6SGTA"),
        "2.3": ("1J5Im9GhXj0", "qAHZPpBtFEU"),
        "3.1": ("Qt5Zqn39wyc", "Kh4yxKniqXc"),
        "3.2": ("et73OKgW9W0", "Qt5Zqn39wyc"),
        "3.3": ("kVpds-6SGTA", "Qt5Zqn39wyc"),
    },
    # 03 אינדוקציה מתמטית
    "03": {
        "1.1": ("--qgOEyzmMc", "S3sDukILQxo"),
        "1.2": ("S3sDukILQxo", "be_uyugetCQ"),
        "1.3": ("be_uyugetCQ", "fpH9PGeVPg0"),
        "2.1": ("u1WJcPdCALM", "inJ9Ovh1s10"),
        "2.2": ("4odv1UiXKSw", "u1WJcPdCALM"),
        "2.3": ("inJ9Ovh1s10", "6U7-ioroexE"),
        "3.1": ("Cu9_J02GvaE", "zx5YMpM5Qbs"),
        "3.2": ("--qgOEyzmMc", "6U7-ioroexE"),
        "3.3": ("9HKlAnx50BQ", "AGh4i0eeDQk"),
    },
    # 04 הסתברות
    "04": {
        "1.1": ("cuYfCSnzNDs", "2DuGDcyFTGk"),
        "1.2": ("s70nqCTb30A", "MJUrDKgFLuU"),
        "1.3": ("eUmgNdb05CA", "jiCv-dDZp2g"),
        "2.1": ("oY4YT91qSqc", "cuYfCSnzNDs"),
        "2.2": ("2DuGDcyFTGk", "cuYfCSnzNDs"),
        "2.3": ("oY4YT91qSqc", "ppnOyN9uJUQ"),
        "3.1": ("5-ow_-EQudA", "3PJ3LVqQRjU"),
        "3.2": ("sSvuKeIXgNE", "G6x582yyO94"),
        "3.3": ("oY4YT91qSqc", "sSvuKeIXgNE"),
    },
    # 05 גאומטריה במישור — משפט לכל שאלה, מתוך פלייליסט משפטי המעגל
    "05": {
        "1.1": ("6A0qmWAmybs", "msfnmjbu7kg"),
        "1.2": ("_eUVEtW2Rc8", "ZzD68g0Zz8Q"),
        "1.3": ("tWkCwpx4MMM", "6A0qmWAmybs"),
        "2.1": ("ZmTRVLD01CQ", "3YWlJzVgTKY"),
        "2.2": ("5Gh3hnJ3EZI", "msfnmjbu7kg"),
        "2.3": ("R4Ietc3gXjo", "ZzD68g0Zz8Q"),
        "3.1": ("btVLd47EEn8", "6A0qmWAmybs"),
        "3.2": ("_v0aZJTAd5c", "btVLd47EEn8"),
        "3.3": ("WhP7Wj9sxvY", "R4Ietc3gXjo"),
    },
    # 06 טריגונומטריה במישור
    "06": {
        "1.1": ("rmMBiUEM-4I", "eOq4hlrThvs"),
        "1.2": ("oncl1H4uXHM", "SUj9sr-95nk"),
        "1.3": ("ZNLdYK5A_5I", "rmMBiUEM-4I"),
        "2.1": ("9yOYt4GaAwM", "SSh_dWpjp24"),
        "2.2": ("9yOYt4GaAwM", "YpYSLr6ZwHg"),
        "2.3": ("rmMBiUEM-4I", "HQxR3DkY5kc"),
        "3.1": ("Tc2wppJ8Nsg", "ZNLdYK5A_5I"),
        "3.2": ("ZNLdYK5A_5I", "BTw5Yf1I8YU"),
        "3.3": ("N-yaqPtNh7w", "rmMBiUEM-4I"),
    },
    # 07 נגזרת וחקירת פונקציות
    "07": {
        "1.1": ("UF8SwwJ3U-A", "9uswdDO4ECw"),
        "1.2": ("9uswdDO4ECw", "4llYhXiK3_c"),
        "1.3": ("UF8SwwJ3U-A", "NRLJoegjOzc"),
        "2.1": ("o5kpkZiWeas", "UF8SwwJ3U-A"),
        "2.2": ("UF8SwwJ3U-A", "PeDeiDZ-Ex0"),
        "2.3": ("dvE3bNvUH8I", "26tOPnMd73o"),
        "3.1": ("iGPFP-QrbQ8", "PHF16JUOwJs"),
        "3.2": ("bnlL9YJsKXU", "5-cbKIajxcc"),
        "3.3": ("XW7U3P7Y7ho", "mGtrQoX04V4"),
    },
    # 08 פונקציות טריגונומטריות
    "08": {
        "1.1": ("Mgyi2IF0lds", "46yKPOMlrB4"),
        "1.2": ("46yKPOMlrB4", "Mgyi2IF0lds"),
        "1.3": ("44Ief299cHU", "46yKPOMlrB4"),
        "2.1": ("KcsFM8gNM40", "KXnj4PpsdWg"),
        "2.2": ("rVCfup6otAw", "bmBmgXp1Alw"),
        "2.3": ("ZhGu9-dUCfc", "i6i6AJArVpA"),
        "3.1": ("epTbjKkl8Bs", "jJsExhMiEGo"),
        "3.2": ("rVCfup6otAw", "KXnj4PpsdWg"),
        "3.3": ("Mgyi2IF0lds", "KXnj4PpsdWg"),
    },
    # 09 בעיות קיצון
    "09": {
        "1.1": ("3F_z_0lAK6Y", "JwtgFciRkxE"),
        "1.2": ("BNA5wbuyO_s", "V0QmsnwUezs"),
        "1.3": ("gbDrVIqLZ3M", "JwtgFciRkxE"),
        "2.1": ("nvr1MXhbP78", "UdillqIOlI4"),
        "2.2": ("bP_OwgFdGnE", "3F_z_0lAK6Y"),
        "2.3": ("Z8hhYJdhshk", "EHK5oOmWWGI"),
        "3.1": ("nvr1MXhbP78", "kof9S-OlN7k"),
        "3.2": ("V0QmsnwUezs", "aiP6giGZHkQ"),
        "3.3": ("aiP6giGZHkQ", "gAJ8Ch1F--Y"),
    },
    # 10 אינטגרל ושטחים
    "10": {
        "1.1": ("WnoeIbJ8sw4", "Sq0N28I0MA4"),
        "1.2": ("BSgOBbKzj5o", "WnoeIbJ8sw4"),
        "1.3": ("VBVHG6_MBOM", "BSgOBbKzj5o"),
        "2.1": ("dmZgNHOPWOs", "rK04oI8M2_I"),
        "2.2": ("l-8iqddx0VM", "5kYlGDFYyUM"),
        "2.3": ("ecwoAJ0bQ9Y", "RsXp45fPJMU"),
        "3.1": ("dmZgNHOPWOs", "ZDwIOgxMd5M"),
        "3.2": ("ZDwIOgxMd5M", "V2k8qE7cXG4"),
        "3.3": ("rv5R_BDcOYE", "ecwoAJ0bQ9Y"),
    },
}


def watch(vid: str) -> str:
    return f"https://www.youtube.com/watch?v={vid}"


def oembed(vid: str) -> dict | None:
    """Title and channel as YouTube states them, or None when it refuses.

    This is where a displayed title comes from — never from a guess and never through
    WebFetch, which mangles Hebrew channel names ("עובד לב ארי" came back as
    "עובד לב אריד"). A refusal is 401/403 and means embedding is off for that video,
    which `addvids.py` treats as disqualifying because it builds a thumbnail card inside
    the workbook page. **Here it is not disqualifying**: the pad opens a tab, and such a
    video plays perfectly well in one. Thirteen of the picks are exactly that, all from
    one channel, and refusing them would have dropped the best-titled match in eight
    blocks for a reason that does not apply. For those the stored title and channel —
    read off the channel's own playlist listing with `yt-dlp` — stand.
    """
    q = ("https://www.youtube.com/oembed?url="
         + urllib.parse.quote(watch(vid), safe="") + "&format=json")
    try:
        d = json.load(
            urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=25))
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None
    # stripped: one channel's name carries a trailing space, and the same channel then
    # read as two in the report.
    return {"title": d["title"].strip(), "author": d["author_name"].strip()}


def seconds(vid: str) -> int | None:
    """`lengthSeconds` off the watch page — what keeps a Short out of the list.

    ⚠️ **The watch page rate-limits.** A hundred and thirty of these back to back earns
    429 for a while, and it is the reason requests here are spaced out and the reason a
    stored length is kept rather than re-fetched: a number that was true yesterday is a
    better answer than a zero from a refusal.
    """
    try:
        page = urllib.request.urlopen(
            urllib.request.Request(watch(vid), headers=UA), timeout=25).read().decode(
                "utf-8", "replace")
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None
    m = re.search(r'"lengthSeconds":"(\d+)"', page)
    return int(m.group(1)) if m else None


def fetch(vid: str, stored: dict | None = None) -> dict:
    """One video's row: oEmbed over what is stored, and a length from either."""
    stored = stored or {}
    row = {"url": watch(vid), **{k: stored[k] for k in
                                 ("title", "author", "sec", "playlist") if k in stored}}
    live = oembed(vid)
    time.sleep(THROTTLE)
    if live:
        row.update(live)
    if not row.get("sec"):
        sec = seconds(vid)
        time.sleep(THROTTLE)
        if sec:
            row["sec"] = sec
    if not row.get("title") or not row.get("author"):
        return {"error": "no title or channel — gone, private, or oEmbed refused a "
                         "video that was never seeded"}
    return row


def load() -> dict:
    return json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}


def ids() -> list[str]:
    """Every id in PICKS, once, in reading order."""
    out: list[str] = []
    for block in sorted(PICKS):
        for key in sorted(PICKS[block]):
            for vid in PICKS[block][key]:
                if vid not in out:
                    out.append(vid)
    return out


def meta(refresh: bool = False, quiet: bool = False) -> dict:
    """The cache, with anything missing — or everything, on --refresh — fetched again.

    A refresh keeps the stored row as the floor and lets a live answer overwrite it, so
    a rate-limited run degrades to "unchanged" instead of to "empty".
    """
    known = load()
    need = ids() if refresh else [v for v in ids() if v not in known]
    for i, vid in enumerate(need, 1):
        d = fetch(vid, known.get(vid))
        if "error" in d:
            if not quiet:
                print(f"  {i:>3}/{len(need)}  {vid:12}  ✗ {d['error']}")
            continue
        known[vid] = d
        if not quiet:
            print(f"  {i:>3}/{len(need)}  {vid:12} {d['sec']//60:>3}:{d['sec']%60:02d}  "
                  f"{d['author'][:22]:22} {d['title'][:52]}")
    if need:
        CACHE.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")
    # ids that left PICKS stay in the file rather than being pruned: re-fetching a video
    # that comes back tomorrow costs a request, and losing the only record of what it
    # was costs the reason it was ever chosen.
    return known


def videos(block: str, key: str, known: dict | None = None) -> list[dict]:
    """What the pad shows for one exercise: id, url, title, channel, length."""
    known = known if known is not None else load()
    out = []
    for vid in PICKS.get(block, {}).get(key, ()):
        d = known.get(vid)
        if d:
            out.append({"id": vid, **d})
    return out


def check(known: dict) -> list[str]:
    from exercises import blocks  # imported here so a bare --refresh needs no built page

    bad: list[str] = []
    ex = blocks()
    for block in sorted(ex):
        want = {f"{e['tier']}.{e['n']}" for e in ex[block]}
        got = set(PICKS.get(block, {}))
        for key in sorted(want - got):
            bad.append(f"{block} {key}: no video")
        for key in sorted(got - want):
            bad.append(f"{block} {key}: not an exercise in the workbook")
    for block in sorted(PICKS):
        for key, picks in sorted(PICKS[block].items()):
            if not picks:
                bad.append(f"{block} {key}: empty")
            if len(set(picks)) != len(picks):
                bad.append(f"{block} {key}: the same video twice")
    for vid in ids():
        d = known.get(vid)
        if not d:
            bad.append(f"{vid}: no metadata")
            continue
        if not d.get("title") or not d.get("author"):
            bad.append(f"{vid}: row without a title or a channel")
        if d.get("sec", 0) < MIN_SECONDS:
            bad.append(f"{vid}: {d.get('sec', 0)}s — a Short, or a length never read")
        if SOLVES_A_PAPER.search(d["title"]):
            bad.append(f"{vid}: solves a real exam question — {d['title'][:60]}")
    return bad


def main() -> int:
    refresh = "--refresh" in sys.argv[1:]
    print("fetching what the cache is missing…" if not refresh else "re-fetching all…")
    known = meta(refresh)
    bad = check(known)
    links = sum(len(v) for b in PICKS.values() for v in b.values())
    per = ", ".join(f"{b}:{sum(len(v) for v in PICKS[b].values())}" for b in sorted(PICKS))
    print(f"\n{len(PICKS)} blocks, {sum(len(b) for b in PICKS.values())} exercises, "
          f"{links} links, {len(ids())} distinct videos\n  {per}")
    if bad:
        print("\n" + "\n".join("  ✗ " + b for b in bad))
        return 1
    print("  all covered, all reachable, none a Short, none a paper's solution")
    return 0


if __name__ == "__main__":
    sys.exit(main())
