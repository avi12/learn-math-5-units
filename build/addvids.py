# -*- coding: utf-8 -*-
"""Attach the videos the coverage audit found missing.

    python build/addvids.py pages/workbook.base.html pages/workbook.html

Avi's report: block 01 rung 3 exercise 1 opens on ⟦|2x-1|<5⟧ and the block's one video is
about irrational equations. The audit that followed (build/cover/AUDIT.md) found the same
in two more blocks — 02 carried a "סדרה הנדסית" playlist and nothing at all for the
arithmetic sequences a third of its exercises use, and 07 taught the procedure of
investigating a function with no video that states a differentiation rule.

Everything else the audit flagged as "missing video" turned out to be covered by a
playlist already on the block, or to belong to a different block; those are answered by
the tools panel and by cross-references, not by more cards. Three blocks needed a video
that genuinely was not there. These are those seven.

Every id below was found by an agent through YouTube search and then verified three ways
before it got here: oEmbed returned 200 (a video with embedding disabled answers 401/403
and would also refuse to embed on the page), the title and channel are the raw JSON from
that endpoint, and `lengthSeconds` was read off the watch page so nothing here is a
Short. Two candidates were dropped on exactly those checks.

Like figs.py and trinom.py this must be run on BOTH pages — the cards live in the base
HTML, so a run against the built page alone is undone by the next rebuild.
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

# block -> the cards to append, in reading order.
#   (kind, id, kicker, caption)
# The kicker is the same vocabulary the existing cards use: "טכניקה" for how-to-do-it,
# "למה" for the idea behind it.
ADD = {
    "01": [
        ("p", "PLCvkcH5OUmCnT8S2bkqFS6FOQZbGs9jCm", "טכניקה",
         "אי־שוויונות וערך מוחלט, וההבדל בין ⟪או⟫ ל⟪וגם⟫ "
         "בפתרון. זה מה שמדרגה 3 פותחת בו."),
        ("v", "6ZPyglzZyUA", "טכניקה",
         "משוואה עם נעלם במכנה, בסדר שהבלוק דורש: תחום הגדרה קודם, מכנה משותף, ופסילת "
         "פתרון שיצא מחוץ לתחום."),
    ],
    # "02" carried two arithmetic-sequence cards. Removed 17.09.2026: arithmetic sequences
    # are not taught in תשפ"ז (data/tashpaz.json), so neither card is added back.
    "07": [
        ("v", "9uswdDO4ECw", "טכניקה",
         "כללי הגזירה עצמם. שבעת הצעדים בבלוק אומרים ⟪ואז נגזרת⟫ ואף פעם לא איך גוזרים."),
    ],
}


def fetch(kind: str, vid: str) -> dict:
    url = (f"https://www.youtube.com/watch?v={vid}" if kind == "v"
           else f"https://www.youtube.com/playlist?list={vid}")
    q = ("https://www.youtube.com/oembed?url="
         + urllib.parse.quote(url, safe="") + "&format=json")
    d = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=25))
    th = d["thumbnail_url"].replace("hqdefault", "mqdefault")
    b = urllib.request.urlopen(urllib.request.Request(th, headers=UA), timeout=25).read()
    return {"kind": kind, "url": url, "title": d["title"], "author": d["author_name"],
            "b64": base64.b64encode(b).decode()}


def card(meta: dict, kicker: str, caption: str) -> str:
    """The shape the page already uses, so no CSS has to change.

    ⟪…⟫ in a caption is written out as a real quote here rather than as ⟦…⟧ maths: a
    caption is prose under a thumbnail, and a KaTeX box inside it would be the only one
    on the page that is not part of a formula.
    """
    tag = "סרטון" if meta["kind"] == "v" else "פלייליסט"
    t = meta["title"]
    cap = caption.replace("⟪", "&ldquo;").replace("⟫", "&rdquo;")
    return (
        f'<a class="bvid" href="{meta["url"]}" target="_blank" rel="noopener">\n'
        f'        <span class="bthumb"><img src="data:image/jpeg;base64,{meta["b64"]}" '
        f'alt="{t}" loading="lazy"><span class="btag">{tag}</span></span>\n'
        f'        <span class="bm">\n'
        f'          <span class="bw">{kicker} &#183; {meta["author"]}</span>\n'
        f'          <span class="bt">{t}</span>\n'
        f'          <span class="bc">{cap}</span>\n'
        f"        </span>\n"
        f"      </a>"
    )


BLOCK = re.compile(r'<article class="block">([\s\S]*?)</article>')


def main() -> int:
    targets = [ROOT / a for a in sys.argv[1:]] or [ROOT / "pages" / "workbook.html"]

    print("fetching metadata…")
    meta = {}
    for bid, items in ADD.items():
        for kind, vid, _k, _c in items:
            meta[vid] = fetch(kind, vid)
            print(f"  {bid}  {vid:36} {meta[vid]['author'][:24]:24} "
                  f"{meta[vid]['title'][:44]}")

    for page in targets:
        raw = page.read_bytes()
        crlf = b"\r\n" in raw
        s = raw.decode("utf-8").replace("\r\n", "\n")
        added = 0
        # last block first, so earlier offsets stay valid
        for m in reversed(list(BLOCK.finditer(s))):
            body = m.group(1)
            num = re.search(r'class="bnum">(\d\d)</span>', body)
            if not num or num.group(1) not in ADD:
                continue
            bid = num.group(1)
            new = [c for c in ADD[bid] if meta[c[1]]["url"] not in body]
            if not new:
                continue
            # `blockvids` holds only <a> and <span>, so the first </div> after it is its
            # own. Anything cleverer here would be guessing at nesting that is not there.
            open_at = body.find('<div class="blockvids">')
            assert open_at >= 0, f"block {bid}: no blockvids container"
            end = body.find("</div>", open_at)
            assert end > open_at, f"block {bid}: unclosed blockvids"
            cards = "\n      ".join(card(meta[v], k, c) for _t, v, k, c in new)
            seg = body[:end] + "      " + cards + "\n    " + body[end:]
            s = s[:m.start(1)] + seg + s[m.end(1):]
            added += len(new)
            print(f"  {page.name}: block {bid} +{len(new)} card(s)")
        if not added:
            print(f"  {page.name}: nothing to add (already there)")
            continue
        page.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
        print(f"  {page.name}: {len(raw)} -> {page.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
