# -*- coding: utf-8 -*-
"""What the study pages and the pad have to agree on — written once, here.

    python build/shared.py            report drift, change nothing (exit 1 if any)
    python build/shared.py --write    push the values into every consumer

Two repos ship one look. `learn-math-5-units` builds the Artifact pages, where the CSS
has to be inlined because the Artifact CSP blocks every stylesheet host; `avi-math-study`
is a Vite app that bundles its own. Neither can import from the other at run time, so
whatever they share is shared by being COPIED — and a copy nobody regenerates is a copy
that drifts. This is the regenerator, in the same direction as build/graders.py: the
workbook is where the value is written, the pad receives it.

**The palette is deliberately not here.** It already has a home — the global sheet at
~/.claude/artifact-cyberpunk.css — and both repos vendor it verbatim. Restating it here
would make a fourth copy of the very thing this file exists to prevent, so instead
`verify()` checks that the two vendored copies still match the global token for token.

What IS here is the one piece neither the global sheet nor either repo can own alone:
**the Hebrew pairing.** Chakra Petch and Share Tech Mono have no Hebrew glyphs, so a
Hebrew face has to follow each of them in the stack. That is not the global sheet's
business — it is language-neutral and serves every project — and it is not one repo's
business either, because both repos are Hebrew and RTL and must look the same.

It had drifted into three different answers before this file existed:

    workbook   "Chakra Petch", "Heebo", "Assistant", "Roboto Flex", system-ui, sans-serif
    pad        'Chakra Petch', 'Heebo', 'Assistant', system-ui, sans-serif
    artifacts  "Chakra Petch", "Heebo", "Roboto Flex", system-ui, sans-serif

— three stacks, each missing something another had, and nothing anywhere to say which
was meant. The workbook's is canonical: it is the global's own stack with the Hebrew
faces inserted, so it still falls back the way the global sheet intends.

A NEW ARTIFACT PAGE should import FONT_SANS / FONT_MONO / FONTS_LINK from here rather
than typing the stacks again. That is how the third row above happened.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The pad repo, cloned next to this one (or wherever AVI_MATH_STUDY points).
PAD = Path(os.environ.get("AVI_MATH_STUDY", ROOT.parent / "avi-math-study"))
GLOBAL_SHEET = Path.home() / ".claude" / "artifact-cyberpunk.css"

# ---------------------------------------------------------------- the values

#: The global sheet's stack, with the Hebrew faces inserted ahead of the Latin fallbacks.
FONT_SANS = '"Chakra Petch", "Heebo", "Assistant", "Roboto Flex", system-ui, sans-serif'
FONT_MONO = '"Share Tech Mono", "Miriam Libre", "Cousine", ui-monospace, "SF Mono", monospace'

#: Every face named above that Google Fonts serves. Heebo and Miriam Libre are the two
#: the global sheet does not ask for, and they are exactly the two that carry Hebrew.
FONTS_URL = (
    "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700"
    "&family=Share+Tech+Mono&family=Heebo:wght@400;500;700;800"
    "&family=Miriam+Libre:wght@400;700&display=swap"
)
FONTS_LINK = f'<link rel="stylesheet" href="{FONTS_URL}">'

#: Left-to-right mark, written before a label made of numbers joined by `·` — `2·1.`,
#: `571·572`, `35571 · 2024`. The middle dot is a bidi neutral, and a neutral between two
#: numbers in an RTL paragraph resolves to RTL, so the label reads backwards: `2·1.` shows
#: as `1·2`. The mark in front turns the digits LTR (rule W7) and the dot follows them.
#: Measured in a screenshot; it also works inside <title>, where <bdi> cannot go.
LRM = "‎"

# ------------------------------------------------------------- the consumers

SANS = re.compile(r"(?m)^([ \t]*--font-sans:[ \t]*)([^;\n]+)(;)")
MONO = re.compile(r"(?m)^([ \t]*--font-mono:[ \t]*)([^;\n]+)(;)")
URL = re.compile(r"https://fonts\.googleapis\.com/css2\?family=Chakra[^\"'\s]*")

#: (path, [(what, regex, wanted value)]) — every file that restates a shared value.
#: pages/*.html are NOT here: skin.py generates them, and it reads FONTS_LINK from this
#: module, so they follow automatically on the next build.
CONSUMERS = [
    (
        ROOT / "data" / "cyberskin.css",
        [("--font-sans", SANS, FONT_SANS), ("--font-mono", MONO, FONT_MONO),
         ("fonts url", URL, FONTS_URL)],
    ),
    (
        ROOT / "build" / "videopass_body.html",
        [("fonts url", URL, FONTS_URL)],
    ),
    (
        PAD / "src" / "lib" / "app.css",
        [("--font-sans", SANS, FONT_SANS), ("--font-mono", MONO, FONT_MONO)],
    ),
    (
        PAD / "index.html",
        [("fonts url", URL, FONTS_URL)],
    ),
]


def _apply(text: str, rule, want: str) -> tuple[str, list[str]]:
    """Replace every occurrence, returning the new text and what was actually wrong."""
    found = []

    def sub(m):
        # SANS/MONO capture (prefix, value, ';'); URL captures the whole match
        if m.re.groups == 3:
            if m.group(2).strip() != want:
                found.append(m.group(2).strip())
            return m.group(1) + want + m.group(3)
        if m.group(0) != want:
            found.append(m.group(0))
        return want

    return rule.sub(sub, text), found


def sync(write: bool) -> int:
    drift = 0
    for path, rules in CONSUMERS:
        if not path.exists():
            print(f"MISSING  {path}")
            drift += 1
            continue
        before = path.read_text(encoding="utf-8")
        text = before
        for what, rule, want in rules:
            text, wrong = _apply(text, rule, want)
            for was in wrong:
                drift += 1
                print(f"DRIFT    {path.name}  {what}")
                print(f"           was  {was}")
                print(f"           want {want}")
            if not rule.search(before):
                drift += 1
                print(f"MISSING  {path.name} has no {what} to keep in step")
        if write and text != before:
            path.write_text(text, encoding="utf-8", newline="")
            print(f"written  {path}")
    return drift


def _tokens(path: Path) -> dict:
    """{selector: {token: value}} for the blocks that define the palette."""
    text = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    out, stack, buf = {}, [], ""
    for c in text:
        if c == "{":
            stack.append(buf.strip())
            buf = ""
        elif c == "}":
            name = " ".join(s for s in stack if s)
            for tok, val in re.findall(r"(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)", buf):
                out.setdefault(name, {})[tok] = " ".join(val.split())
            buf = ""
            if stack:
                stack.pop()
        else:
            buf += c
    return out


def verify() -> int:
    """Are the two vendored copies of the palette still the global sheet's?

    Compared token by token rather than line by line: each repo wraps the sheet in its
    own header and its own component layer, so the files are meant to differ. What is
    not meant to differ is a single colour. The two font stacks are the documented
    exception — they are what this module owns.
    """
    if not GLOBAL_SHEET.exists():
        print(f"SKIP     no global sheet at {GLOBAL_SHEET}")
        return 0
    g = _tokens(GLOBAL_SHEET)
    theme = [k for k in g if k.startswith(":root") or "prefers-color-scheme" in k]
    owned = {"--font-sans", "--font-mono"}
    bad = 0
    for label, path in (("pad", PAD / "src" / "lib" / "cyberpunk.css"),
                        ("workbook", ROOT / "data" / "cyberskin.css")):
        t = _tokens(path)
        for name in theme:
            here = t.get(name)
            if here is None:
                print(f"PALETTE  {label} has no `{name}` block")
                bad += 1
                continue
            for tok, want in g[name].items():
                if tok in owned:
                    continue
                if tok not in here:
                    print(f"PALETTE  {label} is missing {tok} in {name}")
                    bad += 1
                elif here[tok] != want:
                    print(f"PALETTE  {label} {tok}\n           global {want}\n           here   {here[tok]}")
                    bad += 1
    return bad


if __name__ == "__main__":
    write = "--write" in sys.argv
    n = sync(write) + verify()
    if n == 0:
        print("in step: the pages and the pad agree, and both still match the global sheet.")
    elif write:
        print(f"\n{n} fixed — rebuild the pages (build/skin.py) and the pad (npm run build).")
    print()
    sys.exit(0 if n == 0 or write else 1)
