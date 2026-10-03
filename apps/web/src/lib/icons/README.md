# Icons

One file per icon, imported where it is used as `IconName.svg?raw` and rendered with
`{@html}` — so a bundle carries only the glyphs its screens use. Size comes from the
container (`--icon-size` in `app.css`), colour from `currentColor`; neither is in a file.

**The hand.** A 24×24 viewBox, stroke-width 3, square caps, mitred corners, on a 1.5-unit
grid — which is the old 16-unit integer grid scaled ×1.5, so at the 16px the app draws
them every line still lands on a whole pixel. No rounding: the skin's chamfers are cut,
not filed, and a soft glyph on a hard chassis is the one thing that would look borrowed.
Outlined, never filled — even `IconPlay`, whose chip is already an outline.

**⚠️ Directional icons are drawn for RTL, deliberately.** `IconUndo` and `IconPrev` point
RIGHT, `IconRedo` and `IconNext` LEFT, because in a Hebrew toolbar "back" is the way you
came from; `IconEnter` walks into a room on the left and `IconInspect`'s handle hangs left.
SVG geometry does NOT flip under `direction: rtl`, so mirroring is decided here, once.
The exception is `IconPlay`: no Hebrew player mirrors transport controls.

**What some of them mean.** `IconCamera`, not two sheets: the copy button takes a picture
of the board, and its gesture is a shutter. `IconParts` is that sheet with a dashed cut —
one page out of the strip. `IconInspect` is Claude looking at the work: a magnifier, not
a tick, because a tick is what comes back. `IconSnap` is the notebook grid.

**Optimised** with `npx svgo@4 -f src/lib/icons --multipass` — rerun it after adding one.
