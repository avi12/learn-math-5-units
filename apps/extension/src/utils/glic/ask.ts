/** A question beside Live, in a conversation of its own.
 *
 * The page's own signed-in text endpoint, asked directly — the request Gemini's web app
 * makes for a first turn, which agentic-gaming-assistant sends in parallel to a Live call
 * (src-tauri/src/voice/gemini.rs, `fetch_web_text`). From this page it is same-origin, so
 * the cookies and the Origin are the page's own; the three tokens are in the page's
 * bootstrap object, or in /app's when this build lacks them. It never touches the Live
 * conversation: pausing Live for a text turn left it listening and silent on the real
 * page (Avi, 14.10.2026). */

const STREAM_GENERATE = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
/** The three tokens a StreamGenerate request is signed with, by their keys in the page's
 *  `WIZ_global_data` — the build label, the session id, and the anti-forgery token. */
const WizKey = { BL: 'cfb2h', SID: 'FdrFJe', AT: 'SNlM0e' } as const;

/** One string value out of a page's `WIZ_global_data`, decoded as the JSON it is. */
const wizValue = ({ html, key }: { html: string; key: string }): string => {
  const m = new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`).exec(html);
  if (!m) {
    return '';
  }

  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return '';
  }
};

const tokens = async (): Promise<{ bl: string; sid: string; at: string }> => {
  const wiz = (window as unknown as { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data ?? {};
  const own = { bl: String(wiz[WizKey.BL] ?? ''), sid: String(wiz[WizKey.SID] ?? ''), at: String(wiz[WizKey.AT] ?? '') };
  if (own.at && own.bl) {
    return own;
  }

  const html = await (await fetch('/app', { credentials: 'include' })).text();
  return {
    bl: wizValue({ html, key: WizKey.BL }),
    sid: wizValue({ html, key: WizKey.SID }),
    at: wizValue({ html, key: WizKey.AT })
  };
};

/** The answer's text from a StreamGenerate body: `)]}'`, then byte counts and JSON
 *  lines; each `wrb.fr` row wraps the response as a JSON string, and the model's text
 *  is cumulative at [4][0][1][0], so the last one seen is the whole answer. */
const answerOf = (body: string): string => {
  let text = '';
  for (const line of body.split('\n')) {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }

    if (!Array.isArray(frame)) {
      continue;
    }

    for (const row of frame) {
      if (!Array.isArray(row) || typeof row[2] !== 'string') {
        continue;
      }

      try {
        const t = (JSON.parse(row[2]) as unknown[][][][])?.[4]?.[0]?.[1]?.[0];
        if (typeof t === 'string') {
          text = t;
        }
      } catch {
        /* a row that is not a response */
      }
    }
  }
  return text;
};

export const ask = async (prompt: string): Promise<string> => {
  if (!prompt) {
    return '';
  }

  const { bl, sid, at } = await tokens();
  if (!at) {
    return '';
  }

  const query = new URLSearchParams({
    bl,
    'f.sid': sid,
    hl: 'en',
    _reqid: String(100_000 + (Date.now() % 900_000)),
    rt: 'c'
  });
  const fReq = JSON.stringify([null, JSON.stringify([[prompt, 0, null, null, null, null, 0]])]);
  const res = await fetch(`${STREAM_GENERATE}?${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
    body: new URLSearchParams({ 'f.req': fReq, at })
  });
  return res.ok ? answerOf(await res.text()) : '';
};
