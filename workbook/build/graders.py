# -*- coding: utf-8 -*-
"""Export the marking criteria to the pad, so both pages ask Claude the same question.

    python build/graders.py

The workbook already carries, per block, what a bagrut marker is actually looking for in
that topic — `grader` in content.py — and wraps it in a prompt the reader copies by hand
(`prompt_text` in rebuild.py). The pad now offers the same check from a button, and the
one thing that must not happen is two versions of that question drifting apart: the
workbook teaching one standard and the pad marking against another.

So content.py stays the only place the criteria are written, rebuild.py stays the only
place the prompt is phrased, and this writes what the pad needs into the pad's repo as
generated data. Re-run it after any change to a `grader` or to the prompt template.

The pad carries the workbook's exercises only. For a day (17.09.2026) it also carried the
ladders written from each real exam question; Avi removed them the same day: "תמחק כל שאלה
שהיא שייכת לשאלון, רק תשאיר שאלות מסונתזות" — a question filed under a paper and a question
number reads as that paper's question, and a sample showed several kept its skeleton.

The ⟦…⟧ markers become $…$: the pad renders the formulas, and in a chat $…$ is the notation
the prompt asks Claude to answer in.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from content import BLOCKS  # noqa: E402
from exercises import RUNG_NAME, blocks as exercise_blocks  # noqa: E402
from exvids import PICKS as EXVIDS, load as exvids_meta, videos as exvids  # noqa: E402
from rebuild import prompt_text  # noqa: E402

# The pad, in the same repo: apps/web reads this file at build time.
PAD = HERE.parent.parent / "apps" / "web" / "src" / "lib" / "graders.json"
BASE = HERE.parent / "pages" / "workbook.base.html"


def titles() -> dict:
    """Block number -> topic name, read from the workbook itself rather than retyped."""
    html = BASE.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'class="bnum">(\d\d)</span>[\s\S]{0,400}?<h3>(.*?)</h3>', html):
        out[m.group(1)] = re.sub(r"<.*?>", "", m.group(2)).strip()
    return out


# The workbook's prompt asks the reader to paste the exercise and the solution as text,
# because that is what someone copying it by hand can do. From the pad both arrive as one
# photograph of the board, so those two lines are replaced. The asserts are the point: if
# the template is ever rephrased, this fails loudly instead of shipping a prompt that
# still tells Claude to look for text that will never come.
PASTE_EXERCISE = "... כאן מדביקים את התרגיל ..."
PASTE_SOLUTION = "... כאן מדביקים את הפתרון, כולל כל שלב שכתבתי על הדף ..."
FROM_BOARD = (
    "מצורפת תמונה של הלוח שכתבתי עליו בכתב יד. היא מכילה את התרגיל ואת הפתרון שלי,\n"
    "כולל כל שלב שכתבתי. קרא אותה משם."
)


# Which exercise, and which section of it. The topic alone was never enough to mark
# against: a topic has nine exercises and the rung-3 ones have lettered sections, so
# "check my work on fractions" left Claude to work out from the handwriting which
# question it was even looking at — and a marking scheme fetched for the wrong question
# is worse than none. The pad fills this slot at the moment of the click.
EXERCISE_SLOT = "{{EXERCISE}}"

# The wording lives here and not in the pad, for the same reason the criteria do: this
# repo phrases what Claude is asked, the pad only chooses which exercise to say it about.
EXERCISE_FORMAT = {
    "line": "התרגיל: {label}{section}.",
    "section": ", סעיף {letter}",
    "sectionAll": ", כל הסעיפים",
    "quote": "נוסח התרגיל, כפי שהוא מוצג לי:\n{text}",
    # Nothing was chosen, or it is not from the workbook. Saying so beats saying nothing:
    # otherwise Claude assumes the board carries a question it can identify.
    "other": "התרגיל אינו מהחוברת — הוא מופיע בתמונה של הלוח, קרא אותו משם.",
}


def for_pad(prompt: str) -> str:
    """The same prompt, addressed to someone who is handed a picture of the board."""
    for needle in (PASTE_EXERCISE, PASTE_SOLUTION):
        if needle not in prompt:
            raise SystemExit(
                "the prompt template changed; graders.py no longer fits it:\n  " + needle)
    head, _, rest = prompt.partition("התרגיל:")
    _, _, tail = rest.partition(PASTE_SOLUTION)
    return head + EXERCISE_SLOT + "\n\nמה מצורף:\n" + FROM_BOARD + tail


def main() -> None:
    names = titles()
    missing = sorted(set(BLOCKS) - set(names))
    if missing:
        raise SystemExit("no title found for block(s): " + ", ".join(missing))

    ex = exercise_blocks()
    # Per block, and derived rather than a flat 9: one exercise per rung comes from
    # `workbook.base.html` and the rest from `content.py`, so the number is whatever those
    # two put there — block 01 carries more than the others. A literal 9 here was a guard
    # against reading the UNBUILT page, and that is still exactly what it has to catch,
    # so the expectation is computed the same way `exercises.py` computes it.
    want = {b: 3 + sum(len(v) for v in BLOCKS[b]["new"].values()) for b in BLOCKS}
    thin = sorted(b for b in BLOCKS if len(ex.get(b, [])) != want[b])
    if thin:
        raise SystemExit(
            "wrong exercise count in block(s): " +
            ", ".join(f"{b} (got {len(ex.get(b, []))}, want {want[b]})" for b in thin) +
            " — is pages/workbook.html the built page?")

    # The videos that explain how to solve each exercise, from build/exvids.py. Avi:
    # "בעבור כל שאלה תוסיף קישורים לסרטונים רלוונטיים שמסבירים איך לפתור", "אבל רק
    # בדסקטופ" — the pad decides where they show, this decides what they are. Titles and
    # channel names are YouTube's own, cached in data/exvids.json.
    vmeta = exvids_meta()
    thin = []
    for num in BLOCKS:
        for e in ex[num]:
            e["short"] = f"תרגיל {e['n']}"
            e["videos"] = exvids(num, f"{e['tier']}.{e['n']}", vmeta)
            if not e["videos"]:
                thin.append(f"{num} {e['tier']}.{e['n']}")
    if thin:
        raise SystemExit(
            "no video for exercise(s): " + ", ".join(thin) +
            " — run python build/exvids.py")

    data = {
        "blocks": [
            {
                "id": num,
                "title": names[num],
                # the same prompt the workbook prints, with the block's own criteria in it;
                # it marks the workbook's exercises and "not from the workbook"
                "prompt": for_pad(
                    re.sub(r"⟦(.*?)⟧", r"\1", prompt_text(names[num], BLOCKS[num]["grader"]))
                ),
                "exercises": ex[num],
            }
            for num in sorted(BLOCKS)
        ],
        # The rungs, in order, so the pad can group its list the way the workbook is
        # laid out instead of flattening it into look-alike rows.
        "rungs": [{"tier": k, "name": RUNG_NAME[k]} for k in sorted(RUNG_NAME)],
        "exerciseSlot": EXERCISE_SLOT,
        "exerciseFormat": EXERCISE_FORMAT,
    }
    PAD.parent.mkdir(parents=True, exist_ok=True)
    PAD.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    n = sum(len(b["exercises"]) for b in data["blocks"])
    per = ", ".join(f'{b["id"]}:{len(b["exercises"])}' for b in data["blocks"])
    print(f"{len(data['blocks'])} chapters, {n} exercises from the workbook "
          f"-> {PAD} ({PAD.stat().st_size // 1024} kb)\n  {per}")


if __name__ == "__main__":
    main()
