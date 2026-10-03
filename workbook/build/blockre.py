# -*- coding: utf-8 -*-
"""How a workbook topic block is recognised in the built HTML. One definition.

Four files were matching `<article class="block">` as a literal string, each for its own
reason, and all four leaned on the same subtlety: the closing quote is what excludes the
trinomial guide, which is `<article class="block guide">` and is not a numbered topic.

Then the blocks were given ids (`build/blockids.py`) so the sittings page could link to
them, and every one of those literals stopped matching at once — silently, because a
`re.finditer` that finds nothing raises nothing. `rebuild.py` was the only one with an
assert, and it is the reason this was caught rather than shipped.

So the pattern lives here now. `class="block"` still has to be followed by something that
is not another class — a space then an attribute, or the closing bracket — which is what
keeps the guide out.
"""
import re

# `class="block"` followed by attributes or by the end of the tag, never by ` guide"`.
BLOCK = re.compile(r'<article class="block"(?:\s+[^>]*)?>([\s\S]*?)</article>')

# The same, anchored at the two-space indent the page uses, for code that needs offsets
# into the file rather than the captured body.
BLOCK_OPEN = re.compile(r'  <article class="block"(?:\s+[^>]*)?>')

__all__ = ["BLOCK", "BLOCK_OPEN"]
