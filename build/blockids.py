# -*- coding: utf-8 -*-
"""Give every workbook block an id, so a link can point at it.

    python build/blockids.py pages/workbook.base.html pages/workbook.html

The coverage audit of 09.09.2026 mapped each exam question onto the workbook block that
teaches its tools, and the sittings page linked each question to its block — a link needs a
target, and the block articles never had one. The sittings page and that map were removed on
17.09.2026; the ids stay, as anchors into the hub.

`wbNN` rather than `bNN`: this page is merged into hub571 with six others, and a two-letter
prefix is what keeps it from colliding with an id another page already spends. The
trinomial guide is `class="block guide"` and is skipped, exactly as rebuild/qsim/dupcheck
skip it — it is a guide, not a numbered block.

Idempotent, and run on BOTH pages like figs.py and addvids.py: the articles live in the
base HTML, so a run against the built page alone is undone by the next rebuild.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    targets = [ROOT / a for a in sys.argv[1:]] or [ROOT / "pages" / "workbook.html"]
    for page in targets:
        raw = page.read_bytes()
        crlf = b"\r\n" in raw
        s = raw.decode("utf-8").replace("\r\n", "\n")
        done = 0

        def repl(m: re.Match) -> str:
            nonlocal done
            body = m.group(2)
            num = re.search(r'class="bnum">(\d\d)</span>', body)
            if not num or 'id="wb' in m.group(1):
                return m.group(0)
            done += 1
            return f'<article class="block" id="wb{num.group(1)}">{body}'

        s = re.sub(r'<article class="block"([^>]*)>([\s\S]*?)(?=</article>)', repl, s)
        if not done:
            print(f"  {page.name}: already has ids")
            continue
        page.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
        print(f"  {page.name}: {done} blocks tagged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
