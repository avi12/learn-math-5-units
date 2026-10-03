# -*- coding: utf-8 -*-
"""Build pages/hub571.html — every published page in one document.

  python build/onepage.py

Avi: *"תרכז הכל לארטיפקט אחד, לא רוצה לעבור בין מלא ארטיפקטים"*. Seven pages had grown
into seven links, and a link between artifacts is a context switch — the opposite of the
bite-sized rule the whole project is built on.

Nothing is rewritten. Each page is spliced in as it stands, which is what makes this
safe: those pages are verified (sympy, KaTeX, originality) and re-authoring them here
would put a second, unverified copy of the same material in the repo. This script only
does the three things a merge actually needs:

  1. **One skin, one KaTeX.** Every page carries the token block, the component pass and
     a 359kb KaTeX stylesheet. Seven copies of each is ~2mb of nothing. They are checked
     byte-for-byte to be identical and then emitted once.
  2. **Scoped page CSS.** Two pages both style `.fig svg`, and one of them wants a
     660px min-width. Each page's own rules are prefixed with `:where(#p-x)` — `:where`
     so the prefix adds **zero** specificity and the component pass still wins exactly as
     it does today. An id prefix would have out-ranked the skin and quietly broken it.
  3. **Links become anchors.** A cross-page link that still pointed at an artifact URL
     would leave the document the merge exists to avoid leaving.

What goes in is a content decision, not a listing of what exists. Avi named it twice:
*"הארטיפקט צריך לכלול בעיקר את השאלות שקלוד סינתז"* and then *"כמו גם את הלמה ואת סרטוני
ההסברה"* — the synthesised questions, the why, and the videos. So the workbook leads,
and everything that is a report *about* the work rather than the work itself is out: the
provenance page, the workbook-vs-sittings comparison, and eleven of the plan page's
thirteen sections. Those pages are untouched in pages/ and still stand as their own
artifacts; they are simply not what this document is for.

The sittings part — exercises written from each real exam question, and its year pages — is
not "left out" but gone, from the repo too (17.09.2026): "תמחק כל שאלה שהיא שייכת לשאלון,
רק תשאיר שאלות מסונתזות".

The plan page is the one that comes in partially — `keep` names the sections to carry,
and the rest of it (admission gates, exam structure, the sample week, the toolbox) is
process, not maths. Kept sections are renumbered, because "05" and "11" printed next to
each other is a document telling the reader that nine things are missing.

The output is large — rendered KaTeX is heavy. It is measured against the 16mb Artifact
ceiling on every build and the script refuses to write past it.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared import FONTS_LINK  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = ROOT / "dist" / "hub571"
OUT = DIST / "index.html"
LIMIT = 16 * 1024 * 1024          # per file
TOTAL = 64 * 1024 * 1024          # per Artifact version

H_BEG, H_END = "/* CYBERSKIN:TOKENS:BEGIN */", "/* CYBERSKIN:TOKENS:END */"
L_BEG, L_END = "/* CYBERSKIN:PASS:BEGIN */", "/* CYBERSKIN:PASS:END */"

# Exercises first, then the why they rest on. `keep` is None for a whole page, or the
# section headings to carry — matched as a prefix of the <h2>, so `&quot;` in the markup
# does not have to be spelled out here.
PARTS = [
    ("p-workbook", "workbook.html",  "מדרגות 571",     "עשרה נושאים — למה, וידאו ותשעה תרגילים בכל אחד", None),
    ("p-why",     "plan.html",      "סרטוני ה״למה״",   "מפת הנושאים, ולכל נושא הסרטון שמסביר אותו",
     ("מפת הנושאים", "סרטוני ה")),
    ("p-eq",       "eqpage.html",    "סימן השוויון",    "למה אין השמה במתמטיקה", None),
    ("p-pow",      "powpage.html",   "על מה החזקה חלה", "‏sin²x מול sin⁻¹x", None),
]

# The artifact each page was published as, so a cross-page link can be turned inward.
# Only the pages this document actually carries get an anchor; a link to one that was
# left out has to stay a link, or it would point at an id that is not here.
ARTIFACT = {
    "6c568bbb-e20a-465b-a684-a25fb30496dc": "plan.html",
    "474015de-e74f-459d-b11c-6f5ec4294762": "workbook.html",
    "8f4f4421-fe0b-4c83-9a10-f06aa46fed1b": "eqpage.html",
    "fcd226f6-4c6e-4816-b6d2-32b6b0656761": "powpage.html",
    "2805a97c-3516-45b1-94f0-ee575c106de7": "srcpage.html",
}
PART_ID = {name: pid for pid, name, *_ in PARTS}
ANCHOR = {aid: PART_ID[name] for aid, name in ARTIFACT.items() if name in PART_ID}


# ------------------------------------------------------------- css scoping ---
def _close(css: str, open_at: int) -> int:
    """Index of the `}` that closes the `{` at open_at."""
    depth = 0
    for i in range(open_at, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    raise SystemExit("unbalanced braces in page css")


def _split_selectors(sel: str) -> list:
    """Split on commas that are not inside parentheses — `:where(a, b)` stays whole."""
    out, depth, cur = [], 0, ""
    for c in sel:
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if c == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += c
    out.append(cur)
    return out


def scope(css: str, prefix: str) -> str:
    """Prefix every rule with `prefix`, recursing into @media.

    `body` rules are dropped rather than prefixed: the page background is set by the skin
    for the whole document, and seven scoped copies of it would be seven no-ops at best.
    """
    out, i = [], 0
    while True:
        j = css.find("{", i)
        if j < 0:
            out.append(css[i:])
            break
        sel = css[i:j]
        k = _close(css, j)
        head = sel.strip()
        if head.startswith("@"):
            if not head.startswith("@media"):
                raise SystemExit(f"unexpected at-rule in page css: {head[:40]}")
            out.append(sel + "{" + scope(css[j + 1:k], prefix) + "}")
        elif re.fullmatch(r"\s*body\s*", sel):
            out.append("\n")
        else:
            parts = [prefix + " " + s.strip() for s in _split_selectors(sel) if s.strip()]
            out.append("\n" + ",".join(parts) + "{" + css[j + 1:k] + "}")
        i = k + 1
    return "".join(out)


# ------------------------------------------------------------------ pieces ---
def read(name: str) -> dict:
    s = (ROOT / "pages" / name).read_text(encoding="utf-8")
    blocks = [m.group(1) for m in re.finditer(r"<style>([\s\S]*?)</style>", s)]
    main = next(b for b in blocks if H_BEG in b)
    tokens = main[main.index(H_BEG):main.index(H_END) + len(H_END)]
    pas = main[main.index(L_BEG):main.index(L_END) + len(L_END)]
    own = main[main.index(H_END) + len(H_END):main.index(L_BEG)]
    katex = next((b for b in blocks if "KaTeX_AMS" in b[:400]), None)
    # anything else the page put in a <style> of its own is page css too
    extra = [b for b in blocks if b is not main and b is not katex]
    # plan.html opens `<div class="page" dir="rtl" lang="he">`; the rest carry no
    # attributes. Match the tag, not one spelling of it.
    m = re.search(r'<div class="page"[^>]*>', s)
    if not m:
        raise SystemExit(f"{name}: no page wrapper")
    body = s[m.start():].rstrip()
    return {"tokens": tokens, "pass": pas, "own": own + "\n".join(extra),
            "katex": katex, "body": body}


SECTION = re.compile(r"<section[^>]*>[\s\S]*?</section>")
H2 = re.compile(r"<h2[^>]*>([\s\S]*?)</h2>")
NUM = re.compile(r'(<span class="num">)(\d+)(</span>)')


def keep_sections(body: str, wanted: tuple, name: str) -> str:
    """The page wrapper with only `wanted` sections left inside it.

    The hero and the footnote go with the dropped sections: both are about the page as a
    whole, and what is left is two sections that stand on their own.
    """
    m = re.match(r'<div class="page"[^>]*>', body)
    if not m:
        raise SystemExit(f"{name}: no page wrapper to slice")
    kept = []
    for sec in SECTION.finditer(body):
        h2 = H2.search(sec.group(0))
        head = h2.group(1) if h2 else ""
        if any(head.startswith(w) for w in wanted):
            kept.append(sec.group(0))
    if len(kept) != len(wanted):
        raise SystemExit(f"{name}: wanted {len(wanted)} sections, matched {len(kept)}")
    # 05 and 11 sitting next to each other would advertise the nine that are gone.
    kept = [NUM.sub(lambda x, i=i: f"{x.group(1)}{i:02d}{x.group(3)}", k, count=1)
            for i, k in enumerate(kept, start=1)]
    return m.group(0) + "\n" + "\n".join(kept) + "\n</div>"


ANCHOR_LINK = re.compile(
    r'<a\s+[^>]*href="https://claude\.ai/code/artifact/([0-9a-f-]+)"[^>]*>([\s\S]*?)</a>')


def relink(body: str) -> tuple:
    """Cross-page links become in-page anchors, and lose the external-link arrow."""
    n = 0

    def repl(m):
        nonlocal n
        target = ANCHOR.get(m.group(1))
        if not target:
            return m.group(0)          # an artifact this document does not contain
        n += 1
        text = m.group(2).replace("&nbsp;↗", "").replace(" ↗", "").replace("↗", "").strip()
        return f'<a href="#{target}">{text}</a>'

    return ANCHOR_LINK.sub(repl, body), n


HUBCSS = """
.hubnav{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;
  padding:10px 20px;background:var(--surface);border-bottom:2px solid var(--border);}
.hubnav a{display:inline-block;padding:5px 13px;text-decoration:none;
  font-family:var(--font-mono);font-size:12.5px;letter-spacing:.06em;
  color:var(--fg-muted);background:var(--surface-2);border:1px solid var(--border);
  clip-path:polygon(var(--chamfer-s) 0,100% 0,100% calc(100% - var(--chamfer-s)),
    calc(100% - var(--chamfer-s)) 100%,0 100%,0 var(--chamfer-s));}
.hubnav a:hover{color:var(--fg);background:var(--hover);}
.hubnav a:focus-visible{outline:2px solid var(--border-strong);outline-offset:2px;}
/* On a phone the nav wraps to several rows — pinned, it covered almost half the
   screen (measured at 400px). There it stays at the top of the page and scrolls away. */
@media (max-width:600px){.hubnav{position:static;}}
.hubsec{scroll-margin-top:58px;}
.hubpart{max-width:1000px;margin:0 auto;padding:64px 20px 0;
  display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
.hubpart span{font-family:var(--font-mono);font-size:12px;letter-spacing:.14em;
  color:var(--primary);}
.hubpart b{font-family:var(--font-mono);font-size:13px;letter-spacing:.1em;color:var(--fg);}
.hubpart em{font-style:normal;font-family:var(--font-mono);font-size:11.5px;
  color:var(--fg-subtle);}
.hubpart::after{content:"";flex:1;min-width:40px;height:2px;background:var(--border);}
"""


def main() -> None:
    parts = []
    for pid, name, label, blurb, keep in PARTS:
        page = read(name)
        if keep:
            page["body"] = keep_sections(page["body"], keep, name)
        parts.append((pid, name, label, blurb, page))

    # one skin, one KaTeX - and only after proving the copies are the same bytes
    tokens = {p[4]["tokens"] for p in parts}
    passes = {p[4]["pass"] for p in parts}
    katexes = {p[4]["katex"] for p in parts if p[4]["katex"]}
    for what, seen in (("tokens", tokens), ("component pass", passes), ("katex", katexes)):
        if len(seen) != 1:
            raise SystemExit(f"{len(seen)} different copies of the {what} — "
                             "run build/skin.py on every page before merging")

    css = [tokens.pop(), HUBCSS]
    body = []
    relinked = 0
    for i, (pid, name, label, blurb, page) in enumerate(parts, start=1):
        css.append(f"\n/* ---- {name} ---- */")
        css.append(scope(page["own"], f":where(#{pid})"))
        text, n = relink(page["body"])
        relinked += n
        # The id goes on the element that WRAPS the page, not on the label above it.
        # With it on the label, `:where(#p-plan) .stats` matched nothing — the hero's
        # chips stacked into full-width bars and every section head lost its flex row.
        # The anchor still lands on the label, because the label is the first thing in.
        body.append(f'<section class="hubsec" id="{pid}">\n'
                    f'<div class="hubpart"><span>חלק {i:02d}</span><b>{label}</b>'
                    f'<em>{blurb}</em></div>\n{text}\n</section>')
    css.append(passes.pop())

    nav = "\n".join(f'  <a href="#{pid}">{label}</a>' for pid, _, label, _, _ in parts)
    kept_secs = sum(len(k) for *_, k in PARTS if k)
    doc = (
        '<meta charset="utf-8">\n'
        "<title>תיק 571</title>\n"
        + FONTS_LINK + "\n"
        "<style>\n" + "\n".join(css) + "\n</style>\n"
        "<style>" + katexes.pop() + "</style>\n\n"
        f'<nav class="hubnav">\n{nav}\n</nav>\n\n'
        + "\n\n".join(body) + "\n"
    )

    size = len(doc.encode())
    if size > LIMIT:
        raise SystemExit(f"{size // 1024 // 1024}mb — over the 16mb Artifact ceiling")
    DIST.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")

    # Every file has its own 16mb ceiling and the version as a whole has 64mb; both are
    # checked here, on the exact set that gets published. Since 17.09.2026 that set is the
    # hub alone: the year pages of exercises written from each exam question were removed
    # ("תמחק כל שאלה שהיא שייכת לשאלון"), and a stale one left here would be published.
    stale = sorted(DIST.glob("s-*.html"))
    if stale:
        raise SystemExit("year pages are still in dist/hub571 — delete them: " +
                         ", ".join(f.name for f in stale))
    files = sorted(DIST.glob("*.html"))
    for f in files:
        if f.stat().st_size > LIMIT:
            raise SystemExit(f"{f.name}: over the 16mb per-file ceiling")
    total = sum(f.stat().st_size for f in files)
    if total > TOTAL:
        raise SystemExit(f"{total // 1024 // 1024}mb in {len(files)} files — "
                         "over the 64mb version ceiling")
    print(f"{len(files)} files, {total // 1024} kb ({100 * total // TOTAL}% of the version "
          f"ceiling): " + ", ".join(f.name for f in files))
    print(f"{OUT.relative_to(ROOT)}: {size // 1024} kb ({100 * size // LIMIT}% of the ceiling) | "
          f"{len(parts)} parts ({kept_secs} sections sliced out of plan.html) | "
          f"{relinked} cross-links became anchors | "
          f"saved {sum(len(p[4]['katex'] or '') for p in parts[1:]) // 1024} kb "
          "by carrying one KaTeX")


if __name__ == "__main__":
    sys.exit(main())
