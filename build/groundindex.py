# -*- coding: utf-8 -*-
"""The topic inventory, turned into one index of skills — what the papers actually contain.

    python build/groundindex.py mentions    # build/ground/mentions/<area>.json, for the normalisers
    python build/groundindex.py index       # data/topics/index.json, after build/ground/canon/ exists

Step 1 of Avi's rule (17.09.2026) — "only topics that appear in the papers are taught" —
is knowing what appears. data/topics/raw/ has it paper by paper and part by part: 32
readers, each naming skills in its own words. The same skill arrives as "נוסחת השורשים",
"פתרון משוואה ריבועית בנוסחת השורשים" and "נוסחת השורשים למשוואה ריבועית", and an audit
that asks "does any question need X?" cannot answer that across 1,800 spellings.

So: `mentions` groups every distinct spelling by area, with counts and real examples, for
one normaliser agent per area. Each writes build/ground/canon/<area>.json — canonical
skills, each listing the exact spellings it absorbs. `index` then checks that every
spelling landed in exactly one canonical skill (no loss, no double count) and writes the
index: canonical skill -> every (paper, question, part, role) that needs it.

Sealed papers count as evidence that a topic is on the exam, but the index never carries
their `asks` text — only ids.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "topics" / "raw"
MENTIONS = ROOT / "build" / "ground" / "mentions"
CANON = ROOT / "build" / "ground" / "canon"
INDEX = ROOT / "data" / "topics" / "index.json"


def load_raw() -> list:
    papers = [json.loads(f.read_text(encoding="utf-8")) for f in sorted(RAW.glob("*.json"))]
    if len(papers) != 32:
        raise SystemExit(f"{len(papers)} inventory files, expected 32")
    return papers


def occurrences(papers: list):
    for d in papers:
        for q in d["questions"]:
            for p in q["parts"]:
                for s in p["skills"]:
                    yield d, q, p, s


def mentions() -> int:
    MENTIONS.mkdir(parents=True, exist_ok=True)
    by_area = defaultdict(lambda: defaultdict(list))
    for d, q, p, s in occurrences(load_raw()):
        ex = {"paper": d["paper"], "q": q["q"], "part": p["part"], "role": s["role"]}
        if not d.get("sealed"):
            ex["asks"] = p.get("asks", "")
        by_area[s["area"]][s["skill"].strip()].append(ex)
    for area, skills in sorted(by_area.items()):
        rows = [{"skill": k, "count": len(v), "examples": v[:3]}
                for k, v in sorted(skills.items(), key=lambda kv: -len(kv[1]))]
        (MENTIONS / f"{area}.json").write_text(
            json.dumps({"area": area, "skills": rows}, ensure_ascii=False, indent=1),
            encoding="utf-8")
        print(f"  {area:<18} {len(rows):>4} spellings  {sum(r['count'] for r in rows):>5} mentions")
    return 0


def index() -> int:
    papers = load_raw()
    canon = {}
    owner = {}
    for f in sorted(CANON.glob("*.json")):
        c = json.loads(f.read_text(encoding="utf-8"))
        for sk in c["skills"]:
            if sk["id"] in canon:
                raise SystemExit(f"duplicate canonical id {sk['id']}")
            canon[sk["id"]] = {"id": sk["id"], "name": sk["name"], "area": c["area"],
                               "occurrences": []}
            for m in sk["members"]:
                key = (c["area"], m.strip())
                if key in owner:
                    raise SystemExit(f"{key} claimed by {owner[key]} and {sk['id']}")
                owner[key] = sk["id"]
    lost = set()
    for d, q, p, s in occurrences(papers):
        key = (s["area"], s["skill"].strip())
        cid = owner.get(key)
        if not cid:
            lost.add(key)
            continue
        canon[cid]["occurrences"].append(
            {"paper": d["paper"], "q": q["q"], "part": p["part"], "role": s["role"],
             "sealed": bool(d.get("sealed"))})
    if lost:
        raise SystemExit(f"{len(lost)} spellings not in any canonical skill, e.g. {sorted(lost)[:5]}")
    for c in canon.values():
        occ = c["occurrences"]
        c["questions"] = len({(o["paper"], o["q"]) for o in occ})
        c["papers"] = len({o["paper"] for o in occ})
        c["asked"] = sum(o["role"] == "asked" for o in occ)
        c["sealed_only"] = all(o["sealed"] for o in occ)
    out = {"_": "Canonical skills the 32 new-program papers (35571/35572, 2022-2026) ask for "
                "or require, with every occurrence. Built by build/groundindex.py from "
                "data/topics/raw and build/ground/canon.",
           "skills": sorted(canon.values(), key=lambda c: (c["area"], -c["questions"]))}
    INDEX.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(canon)} canonical skills from {len(owner)} spellings -> {INDEX.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"mentions": mentions, "index": index}.get(mode, lambda: print(__doc__) or 2)())
