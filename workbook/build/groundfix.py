# -*- coding: utf-8 -*-
"""One brief per workbook block, for the agent that repairs it — and the applier for its answer.

    python build/groundfix.py brief         # build/ground/fix/<block>.brief.json
    python build/groundfix.py apply         # apply build/ground/fix/<block>.patch.json to the sources

The grounding audit (build/ground/audit/) judged every item of the curriculum against the
32 new-program papers and the ministry's list of topics not examined in תשפ"ז. What it
found in the workbook is edits to three places — content.py (how-to, tools, trap, grader,
the two added exercises per rung), workbook.base.html (the first exercise of each rung and
the video cards) — and those are one file each, shared by all ten blocks. Ten agents
editing the same two files at once is how edits get lost, so agents do not edit: each
writes a patch, and `apply` lands them one after another, failing loudly on any `old`
string that is not found exactly once.

The brief also carries an originality screen the old checker never ran: build/qsim.py only
ever scored tier 3. Every exercise of every tier is scored here against all 208 questions,
with the top matches and the shared runs, so the repair agent reads the real pairs instead
of trusting a number that short exercises inflate.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

FIX = HERE / "ground" / "fix"
AUDIT = HERE / "ground" / "audit"
ELEM = HERE / "ground" / "elements"
BLOCKS = [f"{i:02d}" for i in range(1, 11)]


def brief() -> int:
    import exercises
    import qsim

    FIX.mkdir(parents=True, exist_ok=True)
    papers, common, text = qsim.corpus()
    refute = json.loads((AUDIT / "_refute.json").read_text(encoding="utf-8"))

    exs = exercises.blocks()
    for b in BLOCKS:
        g = f"wb{b}"
        audit = json.loads((AUDIT / f"{g}.json").read_text(encoding="utf-8"))
        elems = {e["id"]: e for e in json.loads((ELEM / f"{g}.json").read_text(encoding="utf-8"))["items"]}
        over = {o["id"]: o for o in (refute.get(g) or {}).get("overturned", [])}
        findings = []
        for it in audit["items"]:
            o = over.get(it["id"])
            verdict = o["to"] if o else it["verdict"]
            # the item's action was chosen for the verdict the refute overturned, so a refute
            # to "in" leaves nothing to do — its stale "remove" must not reach the repairer
            if verdict == "in" and (o or it.get("action", "keep") == "keep"):
                continue
            if verdict == "framing":
                continue
            findings.append({"id": it["id"], "kind": elems[it["id"]]["kind"],
                             "text": elems[it["id"]]["text"], "verdict": verdict,
                             "action": it.get("action"), "excluded_by": it.get("excluded_by"),
                             "note": it.get("note"),
                             "refute": o["reason"] if o else None})
        orig = []
        for e in exs[b]:
            size, scored = qsim.score(e["text"], papers, common)
            top = scored[0]
            orig.append({"label": e["label"], "text": e["text"], "grams": size,
                         "top": [{"score": round(s, 3), "paper": p, "q": n} for s, p, n, _ in scored],
                         "shared": qsim.shared_runs(e["text"], text[(top[1], top[2])])
                         if top[0] >= qsim.FLAG else []})
        (FIX / f"{b}.brief.json").write_text(json.dumps(
            {"block": b, "findings": findings, "originality": orig}, ensure_ascii=False, indent=1),
            encoding="utf-8")
        print(f"  {b}: {len(findings)} findings, "
              f"{sum(o['top'][0]['score'] >= qsim.FLAG for o in orig)} exercises at or above the flag")
    return 0


ELEMENT_TAGS = {"p", "li", "a", "h3", "h4", "figcaption"}


def render(snippets: list) -> dict:
    """⟦…⟧ -> KaTeX html, through the same renderer the page builders use."""
    import re
    import subprocess
    tex = {f: f for s in snippets for f in re.findall(r"⟦([^⟧]*)⟧", s)}
    if not tex:
        return {}
    import os
    # per process: ten repair agents run `try` at once, and a shared scratch name would let
    # one agent's render read another's formulas
    src, out = HERE / f"gf_tex_{os.getpid()}.json", HERE / f"gf_html_{os.getpid()}.json"
    src.write_text(json.dumps(tex, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["node", str(HERE / "dprender.mjs"), str(src), str(out)], cwd=str(ROOT), check=True)
    return json.loads(out.read_text(encoding="utf-8"))


def _apply(patches: list, root: Path) -> int:
    """Land edits from `patches` onto the files under `root`. Two kinds of edit:

      {"op": "replace", "file", "old", "new", "why"}
          exact replacement; `old` must occur exactly once when it is applied. For source
          files (content.py, verify9.py) — where ⟦…⟧ is the source and stays as written.

      {"op": "element", "file", "tag", "contains", "new", "why"}
          for built HTML (the base page, plan.html, powpage.html), where formulas are
          rendered KaTeX and an exact `old` is not something anyone can type. The one
          <tag> element whose plain text (math read back as LaTeX, like the audit's
          elements) contains `contains` is replaced by `new` — "" deletes it. ⟦…⟧ in `new`
          is rendered here.

    Anything that does not match exactly once stops the run at that edit, with the file,
    the patch and the reason. Nothing is half-applied inside one edit.
    """
    import re
    from qsim import strip

    html_new = [e["new"] for _, p in patches for e in p["edits"] if e["file"].endswith(".html")]
    rendered = render(html_new)

    def math(chunk: str) -> str:
        return re.sub(r"⟦([^⟧]*)⟧", lambda m: '<span class="tex">' + rendered[m.group(1)] + "</span>", chunk)

    done = 0
    for name, patch in patches:
        for i, e in enumerate(patch["edits"]):
            path = root / e["file"]
            s = path.read_text(encoding="utf-8")
            new = math(e["new"]) if e["file"].endswith(".html") else e["new"]
            where = f"{name} edit {i} ({e['file']})"
            if e.get("op", "replace") == "replace":
                c = s.count(e["old"])
                if c != 1:
                    raise SystemExit(f"{where}: `old` occurs {c} times — {e['old'][:80]!r}")
                s = s.replace(e["old"], new)
            elif e["op"] == "element":
                tag = e["tag"]
                if tag not in ELEMENT_TAGS:
                    raise SystemExit(f"{where}: tag {tag!r} is not one of {sorted(ELEMENT_TAGS)}")
                hits = [m for m in re.finditer(rf"<{tag}\b[^>]*>[\s\S]*?</{tag}>", s)
                        if e["contains"] in strip(m.group(0))]
                if len(hits) != 1:
                    raise SystemExit(f"{where}: {len(hits)} <{tag}> elements contain {e['contains'][:60]!r}")
                m = hits[0]
                s = s[:m.start()] + new + s[m.end():]
            else:
                raise SystemExit(f"{where}: unknown op {e.get('op')!r}")
            path.write_text(s, encoding="utf-8")
            done += 1
        print(f"  {name}: {len(patch['edits'])} edits")
    return done


def apply(units: list | None = None) -> int:
    """Land build/ground/fix/*.patch.json on the real files, in name order — all of them, or
    only the named units (`apply 04 05`), so reviewed patches can land while others are still
    under review. A landed patch is renamed to *.landed.json: applying it twice would fail on
    its own `old` strings, and the name says which ones are already in."""
    files = sorted(FIX.glob("*.patch.json"))
    if units:
        files = [f for f in files if f.name.split(".")[0] in units]
        missing = set(units) - {f.name.split(".")[0] for f in files}
        if missing:
            raise SystemExit(f"no patch for {sorted(missing)}")
    patches = [(f.name, json.loads(f.read_text(encoding="utf-8"))) for f in files]
    print(f"{_apply(patches, ROOT)} edits applied")
    for f in files:
        f.rename(f.with_name(f.name.replace(".patch.json", ".landed.json")))
    return 0


def try_patch(path: str) -> int:
    """Apply ONE patch to private copies and prove it holds, touching nothing shared.

        python build/groundfix.py try build/ground/fix/<name>.patch.json

    What it proves: every edit matches exactly once; content.py still imports, every block
    keeps two added exercises per rung (and `first` entries are 2- or 3-tuples); every
    ⟦…⟧ in content.py renders in the repo's KaTeX; the patched verify9.py passes with zero
    mismatches. Exit 1 on the first thing that does not hold.
    """
    import importlib.util
    import re
    import shutil
    import subprocess

    patch_file = Path(path)
    patch = json.loads(patch_file.read_text(encoding="utf-8"))
    sandbox = FIX / f"_try_{patch_file.stem}"
    if sandbox.exists():
        shutil.rmtree(sandbox)
    files = {e["file"] for e in patch["edits"]} | {"build/content.py", "build/verify9.py"}
    for rel in files:
        dst = sandbox / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dst)
    _apply([(patch_file.name, patch)], sandbox)

    spec = importlib.util.spec_from_file_location("content_try", sandbox / "build" / "content.py")
    content = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(content)
    for num, b in content.BLOCKS.items():
        for lvl, items in b["new"].items():
            want = 6 if (num, lvl) == ("01", "3") else 2
            if len(items) != want:
                raise SystemExit(f"block {num} rung {lvl}: {len(items)} added exercises, expected {want}")
            for it in items:
                if len(it) != 2:
                    raise SystemExit(f"block {num} rung {lvl}: an added exercise is not (q, a)")
        for lvl, it in b.get("first", {}).items():
            if lvl not in "123" or len(it) not in (2, 3):
                raise SystemExit(f"block {num}: first[{lvl!r}] must be (q, a) or (q, a, source)")
    src = (sandbox / "build" / "content.py").read_text(encoding="utf-8")
    bad_ne = re.findall(r"\\\\neq?(?![a-zA-Z])", src)
    if bad_ne:
        raise SystemExit(f"content.py: {len(bad_ne)} \\ne/\\neq — only \\mathrel{{\\char`≠}} renders")
    snippets = []
    for b in content.BLOCKS.values():
        snippets += [b["trap"], b["grader"]] + [h + " " + t for h, t in b["howto"]]
        snippets += [n + " " + r for n, r, _s in b["tools"]]
        snippets += [x for lvl in b["new"].values() for q, a in lvl for x in (q, a)]
        snippets += [x for it in b.get("first", {}).values() for x in it[:2]]
    render(snippets)            # raises through dprender on any KaTeX failure

    r = subprocess.run([sys.executable, str(sandbox / "build" / "verify9.py")],
                       capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-500:])
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-2000:])
        raise SystemExit("verify9 failed on the patched copy")
    print(f"OK — {patch_file.name} holds ({len(patch['edits'])} edits)")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "try":
        sys.exit(try_patch(sys.argv[2]))
    if mode == "apply":
        sys.exit(apply(sys.argv[2:]))
    sys.exit({"brief": brief, "apply": apply}.get(mode, lambda: print(__doc__) or 2)())
