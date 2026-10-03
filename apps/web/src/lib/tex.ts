/** An exercise as the page shows it: Hebrew prose with the maths rendered.
 *
 *  The text arrives from the workbook repo (`build/graders.py`) with every formula already
 *  fenced in `$…$` — the same fence the prompt quotes to Claude — so there is no guessing
 *  here about where the Hebrew stops and the TeX starts.
 *
 *  Every formula gets its own LTR box. That is not styling: inside an RTL paragraph a bare
 *  `|q|<1` reorders into `|1>|q` and "אינו 1," into "אינו ,1" — the workbook has been burned
 *  by exactly this twice — and the short formulas are precisely the ones that flip.
 *
 *  The TeX becomes MathML and the browser typesets it. Avi, on a root sign: "למה להשתמש פה
 *  ב-svg path? תרנדר latex ישירות". KaTeX builds maths out of positioned spans and draws what
 *  a font cannot stretch — the root, tall brackets — as SVG paths. Chromium has laid out
 *  MathML natively since 109, stretching those from the OpenType MATH table of the font, so
 *  a root is a glyph again. Temml is the converter written for exactly that. The font is
 *  Latin Modern Math, shipped with the app rather than taken from the system: the tablet's
 *  Android has no maths font, and without one nothing stretches.
 *
 *  It runs at BUILD time, not in the browser. The exercises are fixed text, so the same
 *  input always gives the same MathML, and converting it on every device meant shipping
 *  Temml — a quarter of the bundle — to do work whose answer never changes. The
 *  `exercise-html` plugin in vite.config.ts calls this on every exercise in graders.json
 *  and the page receives `html` ready to show. The stylesheet and the font are still the
 *  page's: they are imported in main.ts.
 */
import temml from 'temml';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NEWLINE = '\n';

/** HTML for one exercise. `sections` are its lettered parts (א, ב, …): each starts on its
 *  own line with its letter in bold, so a bagrut-length question reads as the paper prints
 *  it instead of one run-on paragraph. The card keeps newlines (`white-space: pre-line`),
 *  so a line break here is a plain newline, and a run of blank lines collapses to one.
 *  Only text outside the formulas is looked at. */
export function exerciseHtml(text: string, sections: string[] = []): string {
  const letters = sections.join('');
  const part = letters ? new RegExp(`(^|[ \\n])([${letters}])\\.[ \\n]`, 'g') : null;
  return text
    .replace(/[ \t]*\n\s*/g, NEWLINE)
    .split(/(\$[^$]+\$)/)
    .map((piece, i) => {
      if (piece.length > 2 && piece.startsWith('$') && piece.endsWith('$')) {
        // `wrap: 'tex'` marks a soft break after each top-level relation and operator, as
        // TeX does in a paragraph, so a long formula wraps instead of pushing the card wide.
        const html = temml.renderToString(piece.slice(1, -1), {
          throwOnError: false,
          wrap: 'tex'
        });
        return `<span class="tex" dir="ltr">${html}</span>`;
      }
      const t = escape(piece);
      if (!part) {
        return t;
      }

      // The very start of the exercise needs no break; anywhere else a part starts a line.
      return t.replace(part, (_m: string, _pre: string, l: string, off: number) =>
        `${i === 0 && off === 0 ? '' : NEWLINE}<b>${l}.</b> `
      );
    })
    .join('');
}
