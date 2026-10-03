# -*- coding: utf-8 -*-
"""All the workbook's exercises, with answers, as one Markdown file GitHub can show.

    python build/exercisesmd.py          # writes workbook/EXERCISES.md

The exercises are written in content.py and workbook.base.html, and only the BUILT page
(pages/workbook.html, a build output outside git) has all of them together, rendered. Avi:
"Keep the generated math problems in the repo" — so this writes them out as a readable,
diffable file that is committed, and GitHub renders its maths.

Nothing is retyped: the questions come from exercises.blocks() (the same reader the pad's
export uses), the topic names from graders.titles(), the answers from the page's own
answer panel, and the videos from exvids. Re-run after every workbook rebuild.

Two GitHub-specific details:
  * Formulas are written as $`…`$, not $…$. The backtick form is GitHub's unambiguous
    math syntax — plain $…$ can lose underscores and asterisks to the Markdown parser.
  * `\\mathrel{\\char`≠}` is how the workbook writes ≠ (it is the only spelling that renders
    with the page's embedded KaTeX fonts), but its backtick would end the math span here.
    GitHub's MathJax renders \\neq correctly, so it is swapped back.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from blockre import BLOCK  # noqa: E402
from exercises import BUILT, LETTERS, RUNG_NAME, blocks, plain  # noqa: E402
from exvids import load as exvids_meta, videos as exvids  # noqa: E402
from graders import titles  # noqa: E402

OUT = HERE.parent / "EXERCISES.md"
LRM = "‎"


def gh_math(text: str) -> str:
    """$…$ from exercises.plain() → GitHub's $`…`$."""
    def one(m: re.Match) -> str:
        tex = m.group(1).replace("\\mathrel{\\char`≠}", "\\neq ").strip()
        return f"$`{tex}`$"
    return re.sub(r"\$([^$]+)\$", one, text)


def split_sections(text: str) -> list[str]:
    """One line per lettered section (א. ב. …), the way the workbook prints them."""
    parts = re.split(r"\s(?=[" + LETTERS + r"]\.\s)", text)
    return [p.strip() for p in parts if p.strip()]


def bold_letter(part: str) -> str:
    """`א. …` → `**א.** …`: a section's letter in bold, as the workbook prints it."""
    return re.sub(r"^([" + LETTERS + r"])\.\s", r"**\1.** ", part)


def answers() -> dict[tuple[str, str], list[str]]:
    """(block, 'tier·n') -> its answer lines, from each block's answer panel. A sectioned
    exercise is answered section by section (`3·1 א.`, `3·1 ב.` …), one line each."""
    page = BUILT.read_text(encoding="utf-8")
    out = {}
    for art in BLOCK.finditer(page):
        body = art.group(1)
        num = re.search(r'class="bnum">(\d\d)</span>', body)
        panel = re.search(r'<div class="abody">([\s\S]*?)</div>', body)
        if not num or not panel:
            continue
        pat = r"<p><b>" + LRM + r"?(\d)·(\d+)(?: ([" + LETTERS + r"]))?\.</b>([\s\S]*?)</p>"
        for p in re.finditer(pat, panel.group(1)):
            key = (num.group(1), f"{p.group(1)}·{p.group(2)}")
            text = (f"{p.group(3)}. " if p.group(3) else "") + plain(p.group(4))
            # A later section is sometimes run on inside the same paragraph, labelled the
            # long way (`‎3·1 ד.`) — cut it down to its letter so it gets its own line too.
            text = re.sub(LRM + r"?\d·\d+ ([" + LETTERS + r"])\.", r"\1.", text)
            for part in split_sections(text):
                out.setdefault(key, []).append(bold_letter(part))
    return out


def slug(heading: str) -> str:
    """GitHub's anchor for a heading: punctuation dropped, spaces to hyphens."""
    return re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")


def mins(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def main() -> int:
    names = titles()
    ex = blocks()
    ans = answers()
    vmeta = exvids_meta()

    total = sum(len(v) for v in ex.values())
    missing = [f"{b} {e['tier']}·{e['n']}" for b in ex for e in ex[b]
               if (b, f"{e['tier']}·{e['n']}") not in ans]
    if missing:
        raise SystemExit("no answer found for: " + ", ".join(missing))

    lines = [
        '<div dir="rtl">',
        "",
        "# תרגילי החוברת — 35571",
        "",
        f"כל {total} התרגילים של החוברת, בעשרה נושאים ושלוש מדרגות: חימום, ביניים ורמת בגרות.",
        "כולם מקוריים — נכתבו **בהשראת** שאלוני הבגרות ולא הועתקו מהם — וכל טענה מספרית בהם",
        "נבדקה ב‑sympy (`build/verify9.py`). התשובות מקופלות מתחת לכל תרגיל.",
        "",
        "> הקובץ נוצר אוטומטית מהחוברת הבנויה: `python workbook/build/exercisesmd.py`.",
        "> לא עורכים אותו ביד — התוכן נכתב ב‑`build/content.py` וב‑`pages/workbook.base.html`.",
        "",
        "## תוכן",
        "",
    ]
    for b in sorted(ex):
        lines.append(f"- [{b} · {names[b]}](#{slug(f'{b} · {names[b]}')})")
    lines.append("")

    for b in sorted(ex):
        lines += [f"## {b} · {names[b]}", ""]
        tier = None
        for e in ex[b]:
            if e["tier"] != tier:
                tier = e["tier"]
                lines += [f"### מדרגה {tier} · {RUNG_NAME[tier]}", ""]
            parts = split_sections(gh_math(e["text"]))
            lines.append(f"**תרגיל {e['n']}.** {parts[0]}")
            lines.append("")
            for p in parts[1:]:
                lines += [bold_letter(p), ""]
            vids = exvids(b, f"{e['tier']}.{e['n']}", vmeta)
            if vids:
                links = " · ".join(f"[{v['title']}]({v['url']}) ({mins(v['sec'])})" for v in vids)
                lines += [f"🎬 איך פותרים: {links}", ""]
            lines += [
                "<details><summary>תשובה</summary>",
                "",
                *(x for a in ans[(b, f"{e['tier']}·{e['n']}")] for x in (gh_math(a), "")),
                "</details>",
                "",
            ]
    lines += ["</div>", ""]

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"{total} exercises in {len(ex)} blocks -> {OUT} ({OUT.stat().st_size // 1024} kb)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
