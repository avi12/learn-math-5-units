# -*- coding: utf-8 -*-
"""Every piece of the curriculum as a separate, checkable item — for the grounding audit.

    python build/groundexport.py        # writes build/ground/elements/<group>.json

Avi (17.09.2026): the curriculum rests only on questions from the 35571/35572 papers, and
only topics those papers actually contain are taught. That is a claim about every element
of every page — a how-to step, a rule in the tools panel, one exercise, one video — so the
audit needs them one at a time, with an id, and not as 14MB of rendered HTML.

Where each kind comes from, and why there:

| kind                     | source                                                        |
|--------------------------|---------------------------------------------------------------|
| howto / trap / grader / tool | `content.BLOCKS` — the one place they are written          |
| title / why / video      | the built workbook — the base page carries them, not content  |
| exercise                 | `exercises.blocks()` — all of them, as LaTeX                  |
| guide / section text     | the built pages, as the hub carries them (`onepage.PARTS`)    |

Math comes back as LaTeX, not glyphs: `qsim.strip` keeps KaTeX's annotation, so an auditor
reads `\\dfrac{x^{2}-9}{x+3}` and not a pile of positioned spans.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import content  # noqa: E402
import exercises  # noqa: E402
from onepage import PARTS, SECTION, H2  # noqa: E402
from qsim import strip  # noqa: E402

OUT = HERE / "ground" / "elements"
CHUNK = re.compile(r"<(h3|h4|p|li|figcaption)\b[^>]*>([\s\S]*?)</\1>")


def chunks(fragment: str, prefix: str) -> list:
    """Block-level text of a fragment, one item per heading / paragraph / list item."""
    out = []
    for m in CHUNK.finditer(fragment):
        t = strip(m.group(2))
        if len(t) >= 3:
            out.append({"id": f"{prefix}.{len(out) + 1}", "kind": "text", "text": t})
    return out


def workbook_groups(page: str) -> dict:
    groups = {}
    ex = exercises.blocks()
    for art in re.finditer(r'<article class="block" id="wb(\d\d)">([\s\S]*?)</article>', page):
        num, body = art.group(1), art.group(2)
        b = content.BLOCKS[num]
        title = strip(re.search(r"<h3[^>]*>([\s\S]*?)</h3>", body).group(1))
        why = re.search(r'<p class="bwhy">([\s\S]*?)</p>', body)
        items = [{"id": f"wb{num}.title", "kind": "title", "text": title}]
        if why:
            items.append({"id": f"wb{num}.why", "kind": "why", "text": strip(why.group(1))})
        for i, (head, text) in enumerate(b["howto"], 1):
            items.append({"id": f"wb{num}.howto{i}", "kind": "howto", "text": f"{head} — {text}"})
        items.append({"id": f"wb{num}.trap", "kind": "trap", "text": b["trap"]})
        items.append({"id": f"wb{num}.grader", "kind": "grader", "text": b["grader"]})
        for i, (name, rule, src) in enumerate(b["tools"], 1):
            items.append({"id": f"wb{num}.tool{i}", "kind": "tool", "text": f"{name} — {rule}",
                          "source": src})
        for e in ex[num]:
            items.append({"id": f"wb{num}.t{e['tier']}.{e['n']}", "kind": "exercise",
                          "text": e["text"], "label": e["label"]})
        for i, v in enumerate(re.finditer(r'<span class="bt">([\s\S]*?)</span>', body), 1):
            items.append({"id": f"wb{num}.video{i}", "kind": "video", "text": strip(v.group(1))})
        groups[f"wb{num}"] = {"group": f"wb{num}", "page": "מדרגות 571", "title": title,
                              "items": items}
    if len(groups) != len(content.BLOCKS):
        raise SystemExit(f"workbook: {len(groups)} blocks found, content has {len(content.BLOCKS)}")

    guide = re.search(r'<article class="block guide">([\s\S]*?)</article>', page)
    if not guide:
        raise SystemExit("workbook: the trinomial guide is missing")
    items = chunks(guide.group(1), "guide")
    items += [{"id": f"guide.video{i}", "kind": "video", "text": strip(v.group(1))}
              for i, v in enumerate(re.finditer(r'<span class="bt">([\s\S]*?)</span>',
                                                guide.group(1)), 1)]
    groups["guide"] = {"group": "guide", "page": "מדרגות 571", "title": "פירוק טרינום",
                       "items": items}
    return groups


def page_groups() -> dict:
    groups = {}
    for pid, name, label, _blurb, keep in PARTS:
        if name == "workbook.html":
            continue  # the workbook is itemised above
        s = (ROOT / "pages" / name).read_text(encoding="utf-8")
        items = []
        for k, sec in enumerate(SECTION.finditer(s), 1):
            h2 = H2.search(sec.group(0))
            head = strip(h2.group(1)) if h2 else ""
            if keep and not any(head.startswith(w) for w in keep):
                continue
            items.append({"id": f"{pid}.s{k}", "kind": "section", "text": head})
            items += chunks(sec.group(0), f"{pid}.s{k}")
            items += [{"id": f"{pid}.s{k}.video{i}", "kind": "video", "text": strip(v.group(1))}
                      for i, v in enumerate(re.finditer(
                          r'<(?:span|div) class="[vb]t"[^>]*>([\s\S]*?)</(?:span|div)>', sec.group(0)), 1)]
        groups[pid] = {"group": pid, "page": label, "title": label, "items": items}
    return groups


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    page = (ROOT / "pages" / "workbook.html").read_text(encoding="utf-8")
    groups = {**workbook_groups(page), **page_groups()}
    total = 0
    for g, data in groups.items():
        (OUT / f"{g}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1),
                                       encoding="utf-8")
        kinds = {}
        for it in data["items"]:
            kinds[it["kind"]] = kinds.get(it["kind"], 0) + 1
        total += len(data["items"])
        print(f"  {g:<10} {len(data['items']):>4} items  {kinds}")
    print(f"{total} items in {len(groups)} groups -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
