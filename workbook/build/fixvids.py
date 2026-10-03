# -*- coding: utf-8 -*-
"""Swap the two video cards that were pointing at the wrong playlist.

Both were topical mismatches, not broken links, which is why nothing caught them:

  block 08  פונקציות טריגונומטריות   pointed at "טריגונומטריה עם מעגל 5 יחידות כיתה י"
            — plane trigonometry on the unit circle, i.e. block 06's material. The block
            is about DERIVATIVES of trig functions.
            now: PLejElsCmvhTDnp4715Yeo63GAMODGd5Ty  חקירת פונקציה טריגונומטרית-5 יחידות
  block 10  אינטגרל ושטחים            pointed at block 07's rational-function playlist,
            on the excuse that its last sections happen to compute areas.
            now: PLejElsCmvhTCHvoOUyGzC0DFb-OZ_72wH  אינטגרלים 5 יחידות שאלון ראשון

Both replacements are from the same channel already used everywhere else (עובד לב ארי),
both verified through oEmbed, and both carry a real course sequence for the topic.
Block 08's second card (תרגול זהויות טריגונומטריות) stays: identities are exactly what a
trigonometric equation needs, so that one was never wrong.

The page is patched in place rather than rebuilt, because the video cards live in the
base HTML and not in build/content.py. The same patch is applied to the pre-rebuild base
copy, so the next `rebuild.py` run does not resurrect the old cards.

  python build/fixvids.py <page.html> [<page.html> ...]
"""
import base64
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0"}

# old playlist id -> (new playlist id, kicker, one-line caption)
SWAPS = {
    "PLejElsCmvhTApERQoHTgzn9KURYz-dmd6": (
        "PLejElsCmvhTDnp4715Yeo63GAMODGd5Ty",
        "טכניקה",
        "חקירה מלאה של פונקצייה טריגונומטרית: נגזרת, תחום, קיצון — וכל הפתרונות בתחום.",
    ),
    "PLejElsCmvhTCbLQcjKCkMpWouhn6-Yv1v": (
        "PLejElsCmvhTCHvoOUyGzC0DFb-OZ_72wH",
        "טכניקה",
        "קורס אינטגרלים מסודר: אינטגרל מסוים, שטח בין שתי פונקציות, ושטחים מפוצלים.",
    ),
}

# only the LAST occurrence of this one is wrong - block 07 links it legitimately
LAST_ONLY = {"PLejElsCmvhTCbLQcjKCkMpWouhn6-Yv1v"}


def fetch(pid: str) -> dict:
    url = "https://www.youtube.com/playlist?list=" + pid
    q = ("https://www.youtube.com/oembed?url="
         + urllib.parse.quote(url, safe="") + "&format=json")
    d = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=20))
    th = d["thumbnail_url"].replace("hqdefault", "mqdefault")
    b = urllib.request.urlopen(urllib.request.Request(th, headers=UA), timeout=20).read()
    return {"kind": "p", "url": url, "title": d["title"], "author": d["author_name"],
            "b64": base64.b64encode(b).decode()}


def card(meta: dict, kicker: str, caption: str) -> str:
    """Exactly the shape the page already uses, so nothing in the CSS has to change."""
    t = meta["title"]
    return (
        f'<a class="bvid" href="{meta["url"]}" target="_blank" rel="noopener">\n'
        f'        <span class="bthumb"><img src="data:image/jpeg;base64,{meta["b64"]}" '
        f'alt="{t}" loading="lazy"><span class="btag">פלייליסט</span></span>\n'
        f'        <span class="bm">\n'
        f'          <span class="bw">{kicker} &#183; {meta["author"]}</span>\n'
        f'          <span class="bt">{t}</span>\n'
        f'          <span class="bc">{caption}</span>\n'
        f'        </span>\n'
        f"      </a>"
    )


def main() -> None:
    store_path = ROOT / "data" / "blockvids.json"
    store = json.loads(store_path.read_text(encoding="utf-8"))

    metas = {}
    for old, (new, kicker, caption) in SWAPS.items():
        meta = store.get(new) or fetch(new)
        store[new] = meta
        metas[old] = (meta, kicker, caption)
        print(f"{new}  {meta['author']}  |  {meta['title']}")

    store_path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")

    for arg in sys.argv[1:]:
        p = Path(arg)
        s = p.read_text(encoding="utf-8")
        for old, (meta, kicker, caption) in metas.items():
            # a whole <a class="bvid"> ... </a> whose href carries this playlist id
            pat = re.compile(
                r'<a class="bvid" href="[^"]*list=' + re.escape(old) + r'"[\s\S]*?</a>')
            hits = list(pat.finditer(s))
            if not hits:
                print(f"  {p.name}: {old} not found, skipped")
                continue
            m = hits[-1] if old in LAST_ONLY else hits[0]
            if old not in LAST_ONLY and len(hits) > 1:
                raise SystemExit(f"{old} appears {len(hits)}x - refuse to guess which")
            s = s[:m.start()] + card(meta, kicker, caption) + s[m.end():]
            print(f"  {p.name}: replaced {old} -> {meta['title'][:40]}")
        p.write_text(s, encoding="utf-8")
        print(f"  {p.name}: {len(s.encode()) // 1024} kb")


if __name__ == "__main__":
    main()
