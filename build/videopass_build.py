# -*- coding: utf-8 -*-
"""Build pages/videopass.html - the 04.09.2026 report page.

Splices the cyberpunk token sheet into videopass_body.html.

The tokens are Avi's global skin and must not be retyped or edited here - they are
pasted verbatim, exactly as build/skin.py does for the five study pages.
"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
TOKENS = pathlib.Path.home() / ".claude" / "artifact-cyberpunk.css"

sheet = TOKENS.read_text(encoding="utf-8")
start = sheet.index(":root {")
end = sheet.index("/* ============================== BASE ===")
tokens = sheet[start:end].rstrip()

body = (HERE / "videopass_body.html").read_text(encoding="utf-8")
assert "/*TOKENS*/" in body, "marker missing"
out = body.replace("/*TOKENS*/", tokens)
(pathlib.Path(__file__).resolve().parent.parent / "pages" / "videopass.html").write_text(out, encoding="utf-8")
print(f"videopass.html: {len(out.encode()) // 1024} kb | tokens {len(tokens)} chars")
