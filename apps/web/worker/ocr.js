/**
 * The whole server side: a Cloudflare Worker that holds the API key and forwards the
 * canvas to Claude for transcription. Free plan, no credit card, 100,000 requests/day.
 *
 * Deploy:
 *   npm i -g wrangler && wrangler login
 *   cd worker && wrangler deploy
 *   wrangler secret put ANTHROPIC_API_KEY
 *
 * Then rebuild the site with the Worker URL:
 *   VITE_OCR_ENDPOINT=https://<name>.<subdomain>.workers.dev npm run deploy
 */

// Claude Opus 5. Claude Haiku 4.5 ("claude-haiku-4-5") is about five times cheaper per
// call and is usually enough for transcribing a single handwritten expression - swap it
// here if the bill matters more than the odd misread.
const MODEL = 'claude-opus-5';

const PROMPT = `Transcribe the handwritten mathematics in this image into a single line of LaTeX.

Rules:
- Output ONLY the LaTeX. No $ delimiters, no \\[ \\], no explanation, no markdown fence.
- If several lines are written, join them with \\\\ so it stays one LaTeX string.
- Preserve exactly what is written, including mistakes. Do not solve, simplify or correct.
- Use \\frac for fractions, \\sqrt for roots, ^ and _ for scripts, \\sin \\cos \\tan \\log \\ln,
  \\int \\sum \\lim with their bounds, and Greek letters by name.
- If the image has no mathematics in it, output nothing at all.`;

// Only the site itself, plus a local dev server so the client half can be tested
// without deploying. Anything else gets no CORS headers and the browser blocks it.
const ORIGINS = [/^https:\/\/avi-math-study\.web\.app$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];

const cors = (request) => {
  const origin = request.headers.get('Origin') ?? '';
  const base = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  return ORIGINS.some((re) => re.test(origin))
    ? { ...base, 'Access-Control-Allow-Origin': origin }
    : base;
};

export default {
  async fetch(request, env) {
    const CORS = cors(request);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    let image;
    try {
      ({ image } = await request.json());
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    if (typeof image !== 'string' || image.length === 0) return json({ error: 'no-image' }, 400);
    // ~4MB of base64 is far more than a line-art canvas ever needs
    if (image.length > 4_000_000) return json({ error: 'too-large' }, 413);
    // checked after the request is validated, so a bad client call never looks like
    // a server misconfiguration
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'no-key' }, 500);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
              { type: 'text', text: PROMPT }
            ]
          }
        ]
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return json({ error: `upstream-${upstream.status}`, detail: detail.slice(0, 300) }, 502);
    }

    const data = await upstream.json();
    if (data.stop_reason === 'refusal') return json({ error: 'refused' }, 200);
    const latex = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      // the model occasionally wraps the answer despite being told not to
      .replace(/^```(?:latex)?\s*|\s*```$/g, '')
      .replace(/^\$+|\$+$/g, '')
      .trim();

    return json({ latex });
  }
};
