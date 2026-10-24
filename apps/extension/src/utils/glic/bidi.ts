/** Hebrew reads right to left, in a page laid out for English. */

/* The live captions are lines of "You: …" / "Gemini: …" in `captions-scroller`. Their
 * first strong letter is the label's, so `auto` would call every line left to right.
 * The line's direction is therefore read from what comes after the label, and set as
 * the `dir` attribute — the one thing the client's own rendering never rewrites (its
 * text nodes it does, so they are not split). In a right-to-left line the label sits
 * at the right edge, where Hebrew starts. */
const CAPTION_LABEL = /^\s*(You|Gemini)\s*:\s*/;
const FIRST_LETTER = /\p{L}/u;
const HEBREW = /\p{Script=Hebrew}/u;

const directCaptions = (): void => {
  const lines = new Set<HTMLElement>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!CAPTION_LABEL.test(n.nodeValue ?? '') || !n.parentElement?.closest('captions-scroller')) {
      continue;
    }

    // A label in a span of its own: the line is the span's parent.
    const labelAlone = !(n.nodeValue ?? '').replace(CAPTION_LABEL, '').trim();
    const line = labelAlone ? n.parentElement.parentElement : n.parentElement;
    if (line && line.tagName !== 'CAPTIONS-SCROLLER') {
      lines.add(line);
    }
  }

  for (const line of lines) {
    const rest = (line.textContent ?? '').replace(CAPTION_LABEL, '');
    const letter = FIRST_LETTER.exec(rest)?.[0];
    const dir = letter && HEBREW.test(letter) ? 'rtl' : 'ltr';
    if (line.dir !== dir) {
      line.dir = dir;
    }
  }
};

export function installBidi(): void {
  /* The page's rounds (what was asked, what was answered) are laid out for English. Each
   * block takes the direction of its own first letter — `dir="auto"` in CSS, per
   * paragraph, so a Hebrew line beside a code block or an English line still sits right.
   * An adopted sheet, because at document_start there is no <head> to put a <style> in. */
  const bidi = new CSSStyleSheet();
  bidi.replaceSync(`
    user-query :is(p, li, h1, h2, h3, h4, .query-text-line),
    .presented-response-container :is(p, li, h1, h2, h3, h4, td, th, blockquote),
    message-content :is(p, li, h1, h2, h3, h4, td, th, blockquote) {
      unicode-bidi: plaintext;
      text-align: start;
    }
  `);
  document.adoptedStyleSheets.push(bidi);

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(directCaptions).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
