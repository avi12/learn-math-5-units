/** The transcript, read off the Live wire: both sides of what is said, as it is said.
 *
 * The Live channel's long-poll GETs are the downlink — see gemini-live-windows,
 * docs/live-transcript-wire.md, for the framing read below. */
import { Direction, type TranscriptLine } from '../protocol';

const LIVE_CHANNEL_PATH = '/v1/processSession';
const MsgField = { SEQ: 0, SERVER_CONTENT: 1, INPUT_TRANSCRIPTION: 7 } as const;
const ContentField = { GENERATION_COMPLETE: 2, INTERRUPTED: 3, OUTPUT_TRANSCRIPTION: 5 } as const;

/** Where the lines go. Nothing is told while `active()` says no. */
interface TranscriptSink {
  active: () => boolean;
  /** a line, new or grown; sent again only when its text changed */
  line: (line: TranscriptLine) => void;
  /** Gemini's utterance `index` ended, or was cut off */
  turnEnded: (index: number) => void;
}

const firstString = (v: unknown): string | null => {
  if (typeof v === 'string') {
    return v;
  }

  if (!Array.isArray(v)) {
    return null;
  }

  for (const item of v) {
    const found = firstString(item);
    if (found !== null) {
      return found;
    }
  }
  return null;
};

/** The utterances of one conversation, and what of them was already told. `chunk` takes
 *  one framed chunk of the downlink; `reset` starts a new conversation. */
export function createTranscript({ active, line, turnEnded }: TranscriptSink) {
  let utterances: { direction: Direction; text: string }[] = [];
  let openUser = -1;
  let unfinishedUser = -1;
  let openAssistant = -1;
  let relayed: string[] = [];

  const relay = (index: number): void => {
    const u = utterances[index];
    if (!u) {
      return;
    }

    const { direction, text } = u;
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!active() || !trimmed || relayed[index] === trimmed) {
      return;
    }

    relayed[index] = trimmed;
    line({ direction, text: trimmed, index });
  };

  const open = (direction: Direction): number => utterances.push({ direction, text: '' }) - 1;

  /** MSG[7]: the person's whole utterance so far; `[null, [text]]` once final. */
  const onInput = (field: unknown[]): void => {
    const text = firstString(field);
    if (text === null) {
      return;
    }

    const isFinal = field[0] === null;
    const index =
      openUser >= 0 ? openUser : isFinal && unfinishedUser >= 0 ? unfinishedUser : open(Direction.USER);
    const u = utterances[index];
    if (u) {
      u.text = text;
    }
    openUser = isFinal ? -1 : index;
    unfinishedUser = -1;
    relay(index);
  };

  /** MSG[1][5] = [fragment, start, end, first]: a piece of what Gemini is saying. */
  const onOutput = (field: unknown[]): void => {
    const [fragment, , , first] = field;
    if (typeof fragment !== 'string') {
      return;
    }

    if (openAssistant < 0 || first === 1) {
      openAssistant = open(Direction.ASSISTANT);
      unfinishedUser = openUser;
      openUser = -1;
    }
    const u = utterances[openAssistant];
    if (u) {
      u.text += fragment;
    }
    relay(openAssistant);
  };

  const onServerMessage = (msg: unknown): void => {
    if (!Array.isArray(msg) || typeof msg[MsgField.SEQ] !== 'string') {
      return;
    }

    const input = msg[MsgField.INPUT_TRANSCRIPTION];
    if (Array.isArray(input)) {
      onInput(input);
    }

    const content = msg[MsgField.SERVER_CONTENT];
    if (!Array.isArray(content)) {
      return;
    }

    const output = content[ContentField.OUTPUT_TRANSCRIPTION];
    if (Array.isArray(output)) {
      onOutput(output);
    }

    if (content[ContentField.GENERATION_COMPLETE] == null && content[ContentField.INTERRUPTED] == null) {
      return;
    }

    if (openAssistant >= 0 && active()) {
      turnEnded(openAssistant);
    }
    openAssistant = -1;
  };

  return {
    chunk(chunk: string): void {
      let frames: unknown;
      try {
        frames = JSON.parse(chunk);
      } catch {
        return;
      }

      if (!Array.isArray(frames)) {
        return;
      }

      for (const frame of frames) {
        const payload = Array.isArray(frame) ? frame[1] : null;
        if (!Array.isArray(payload)) {
          continue;
        }

        for (const entry of payload) {
          if (Array.isArray(entry) && entry[0] === null) {
            onServerMessage(entry[1]);
          }
        }
      }
    },
    reset(): void {
      utterances = [];
      openUser = -1;
      unfinishedUser = -1;
      openAssistant = -1;
      relayed = [];
    }
  };
}

/** Follows a downlink as it streams: "<length>\n<chunk>" repeated, length in UTF-16
 *  units. Reading responseText takes nothing from the client's own handler. */
const tap = ({ xhr, chunk }: { xhr: XMLHttpRequest; chunk: (chunk: string) => void }): void => {
  let offset = 0;
  const read = (): void => {
    let text: string;
    try {
      text = xhr.responseText;
    } catch {
      return;
    }

    for (;;) {
      const nl = text.indexOf('\n', offset);
      if (nl < 0) {
        return;
      }

      const length = Number(text.slice(offset, nl));
      const end = nl + 1 + length;
      if (!Number.isInteger(length) || text.length < end) {
        return;
      }

      const piece = text.slice(nl + 1, end);
      offset = end;
      try {
        chunk(piece);
      } catch {
        /* a misread frame costs a line of transcript, never the client's work */
      }
    }
  };
  xhr.addEventListener('progress', read);
  xhr.addEventListener('readystatechange', read);
};

/** Hand every chunk of every Live downlink to `chunk`, from now on. Everything passes
 *  through to the client untouched. */
export function tapLiveChannel(chunk: (chunk: string) => void): void {
  try {
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const downlinks = new WeakSet<XMLHttpRequest>();
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (String(method).toUpperCase() === 'GET' && String(url).includes(LIVE_CHANNEL_PATH)) {
        downlinks.add(this);
      } else {
        downlinks.delete(this);
      }
      return (xhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: [Document | XMLHttpRequestBodyInit | null | undefined]) {
      if (downlinks.has(this)) {
        tap({ xhr: this, chunk });
      }
      return xhrSend.apply(this, args);
    };
  } catch {
    /* a frozen XHR: no transcript, and no notes, but Live itself still works */
  }
}
