/** The direct link between the tablet and the desktop, for what is too fast or too
 *  fleeting for the room: where the pen hovers, and what Gemini writes down.
 *
 * Avi: "שפעולות hover של העט יוצגו ישר על דף האינטרנט כדי שג'מיני לייב ידע לאן להסתכל".
 * A hover is a pointer event in the TABLET's copy of the page (pointerType 'pen', no
 * button down — see `hovering` in Surface.svelte), while Gemini watches the DESKTOP's
 * copy, on another device. So the position has to travel, and how it travels is the
 * whole design. The other way, a note Gemini writes reaches the desktop through the
 * extension and has to be shown on the tablet, where the person actually is.
 *
 * Not through Firestore. The room is billed per document write and the free tier is a
 * hard daily cap (see room.ts); a pen near the glass moves the whole time someone writes,
 * so even one write a second would cost more than the strokes themselves. Not through a
 * WebSocket either: that needs a server to relay through, and this is a static site on
 * the free plan with no server to run one.
 *
 * WebRTC needs neither. The two devices talk to each other directly over a data channel,
 * and Firestore is used only to introduce them: the desktop writes one offer, the tablet
 * one answer, each a session description with every candidate already in it (no
 * trickle — two writes instead of a dozen). After that a message costs nothing, however
 * often it is sent, and on the home network the two share it arrives in milliseconds.
 *
 * The desktop offers and the tablet answers, always. A reloaded tablet answers the same
 * offer a second time, under a new answer id — and an offer can only be answered once, so
 * the desktop takes that as its cue to start over with a fresh offer. A link that fails
 * outright is retried a few times and then left alone, rather than writing to the room
 * in a loop on a network that will not carry it. */
import type { LiveNote, LiveState } from '@learn-math/shared/protocol';
import { onSnapshot, remove, rtcRef, RtcSlot, save } from './room';

/** A point on the board, in the same normalised units as the strokes (ink.ts); null when
 *  the pen is not over it. */
export type Hover = { x: number; y: number } | null;

/** Which end of the link this page is. The desktop is the one that offers. */
export const Side = { DESK: 'desk', PAD: 'pad' } as const;
export type Side = (typeof Side)[keyof typeof Side];

/** Everything that crosses the link. */
export const LinkMessage = {
  HOVER: 'hover',
  NOTES: 'notes',
  LIVE: 'live'
} as const;
export type LinkMessage = (typeof LinkMessage)[keyof typeof LinkMessage];

/** What each message carries, in the shape of @webext-core/messaging's protocol maps
 *  (shared/protocol.ts). Only the shape: that library speaks over extension and window
 *  channels, and this is a data channel between two devices. One way, so nothing
 *  answers. */
export interface LinkProtocolMap {
  /** pad → desk: where the pen hovers, as `encodeHover` writes it */
  [LinkMessage.HOVER](at: string): void;
  /** desk → pad: Gemini's notes, the whole current list (newest first) */
  [LinkMessage.NOTES](notes: LiveNote[]): void;
  /** desk → pad: how the Gemini session is doing */
  [LinkMessage.LIVE](data: { state: LiveState; blind: boolean }): void;
}

type LinkData<T extends LinkMessage> = Parameters<LinkProtocolMap[T]>[0];

/** The link as a page shows it. */
export const LinkState = {
  /** waiting for the other device */
  WAITING: 'waiting',
  OPEN: 'open',
  /** retried and given up: this network will not carry a direct link */
  FAILED: 'failed'
} as const;
export type LinkState = (typeof LinkState)[keyof typeof LinkState];

export interface LinkHandlers {
  /** the channel has just opened — the moment to say what the other side missed */
  open?(): void;
  state?(s: LinkState): void;
}

export interface Link {
  sendMessage<T extends LinkMessage>(type: T, data: LinkData<T>): void;
  /** One listener per type; returns its removal. */
  onMessage<T extends LinkMessage>(type: T, onReceived: (data: LinkData<T>) => void): () => void;
  stop(): void;
}

/** One end of the channel, before messages have types: what the two ends share. */
interface Wiring extends LinkHandlers {
  message(raw: string): void;
}

interface End {
  send(raw: string): void;
  stop(): void;
}

/** Where each side finds out its own address from outside the home router. A host
 *  candidate is enough on one network; this is for the router that will not let two of
 *  its own devices see each other directly. */
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/** How long to wait for the candidates before sending what there is. Gathering on a home
 *  network finishes in well under a second; a STUN server that does not answer must not
 *  hold the offer back for ever. */
const GATHER_MS = 3000;

/** A failed link is offered again this many times in a row, then left until the page
 *  reloads or the role changes. Each try is two writes. */
const MAX_RETRIES = 3;
const RETRY_MS = 2000;

/** What sits in the two Firestore slots. `aid` is the answer's own id (answer only). */
interface Description {
  sid: string;
  aid?: string;
  sdp: string;
  at: number;
}

function nonce(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** "x,y" in four decimals, like a stored point, or "" for none. */
export function encodeHover(h: Hover): string {
  return h ? `${h.x.toFixed(4)},${h.y.toFixed(4)}` : '';
}

export function decodeHover(s: string): Hover {
  if (!s) {
    return null;
  }

  const [x, y] = s.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Resolves once the local description carries every candidate it is going to get. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
      }
    };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** One channel's wiring, the same on both ends. */
function wire(channel: RTCDataChannel, h: Wiring): void {
  channel.onmessage = (e) => h.message(String(e.data));
  channel.onopen = () => {
    h.state?.(LinkState.OPEN);
    h.open?.();
  };
}

function sender(get: () => RTCDataChannel | null): (raw: string) => void {
  return (raw) => {
    const c = get();
    if (c?.readyState === 'open') {
      c.send(raw);
    }
  };
}

/** Open this page's end of the link. Returns the way to talk down it, and the teardown. */
export function openLink(roomId: string, side: Side, h: LinkHandlers): Link {
  const listeners = new Map<LinkMessage, (data: never) => void>();
  const message = (raw: string): void => {
    try {
      const m = JSON.parse(raw) as { type: LinkMessage; data: never };
      listeners.get(m.type)?.(m.data);
    } catch {
      /* not ours, or torn — a message lost costs one frame of hover, never the link */
    }
  };
  const end = side === Side.DESK ? offer(roomId, { ...h, message }) : answer(roomId, { ...h, message });
  return {
    sendMessage: (type, data) => end.send(JSON.stringify({ type, data })),
    onMessage(type, onReceived) {
      listeners.set(type, onReceived as (data: never) => void);
      return () => listeners.delete(type);
    },
    stop: end.stop
  };
}

/** The desktop's end: offer, and keep offering while the tablet comes and goes. */
function offer(roomId: string, h: Wiring): End {
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let sid = '';
  /** the answer this offer was completed with — a second one means a reloaded tablet */
  let applied = '';
  let failures = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function drop(): void {
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.close();
    }

    pc = null;
    channel = null;
  }

  async function start(): Promise<void> {
    clearTimeout(retry);
    drop();
    h.state?.(LinkState.WAITING);
    const mine = new RTCPeerConnection(ICE);
    pc = mine;
    sid = nonce();
    applied = '';
    const ch = mine.createDataChannel(Side.DESK);
    channel = ch;
    wire(ch, {
      ...h,
      state: (s) => {
        failures = 0;
        h.state?.(s);
      }
    });
    ch.onclose = () => {
      if (pc === mine) {
        h.state?.(LinkState.WAITING);
      }
    };
    mine.onconnectionstatechange = () => {
      if (mine.connectionState !== 'failed' || pc !== mine || stopped) {
        return;
      }

      if (++failures > MAX_RETRIES) {
        drop();
        h.state?.(LinkState.FAILED);
        return;
      }

      retry = setTimeout(() => void start(), RETRY_MS * failures);
    };
    await mine.setLocalDescription(await mine.createOffer());
    await gathered(mine);
    // A newer offer, or the teardown, overtook this one while it was gathering.
    if (pc !== mine || stopped || !mine.localDescription) {
      return;
    }

    const row: Description = { sid, sdp: mine.localDescription.sdp, at: Date.now() };
    void save(rtcRef(roomId, RtcSlot.OFFER), row);
  }

  const offAnswer = onSnapshot(rtcRef(roomId, RtcSlot.ANSWER), (snap) => {
    const a = snap.data() as Description | undefined;
    if (!a || a.sid !== sid || !pc || a.aid === applied) {
      return;
    }

    if (applied) {
      // The same offer answered twice: the tablet reloaded and lost its end of the link.
      void start();
      return;
    }

    applied = a.aid ?? '';
    void pc.setRemoteDescription({ type: 'answer', sdp: a.sdp }).catch(() => void start());
  });

  void start();
  return {
    send: sender(() => channel),
    stop() {
      stopped = true;
      clearTimeout(retry);
      offAnswer();
      drop();
      // Left behind, the offer would only make the next tablet that opens answer a desk
      // that is gone — one wasted write — but there is no reason to leave it.
      void remove(rtcRef(roomId, RtcSlot.OFFER)).catch(() => {});
      void remove(rtcRef(roomId, RtcSlot.ANSWER)).catch(() => {});
    }
  };
}

/** The tablet's end: answer every new offer, and talk down the newest link. */
function answer(roomId: string, h: Wiring): End {
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let answered = '';

  async function accept(o: Description): Promise<void> {
    pc?.close();
    channel = null;
    h.state?.(LinkState.WAITING);
    const mine = new RTCPeerConnection(ICE);
    pc = mine;
    mine.ondatachannel = (e) => {
      if (pc !== mine) {
        return;
      }

      channel = e.channel;
      wire(e.channel, h);
    };
    await mine.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await mine.setLocalDescription(await mine.createAnswer());
    await gathered(mine);
    if (pc !== mine || !mine.localDescription) {
      return;
    }

    const row: Description = { sid: o.sid, aid: nonce(), sdp: mine.localDescription.sdp, at: Date.now() };
    void save(rtcRef(roomId, RtcSlot.ANSWER), row);
  }

  const off = onSnapshot(rtcRef(roomId, RtcSlot.OFFER), (snap) => {
    const o = snap.data() as Description | undefined;
    if (!o || o.sid === answered) {
      return;
    }

    answered = o.sid;
    void accept(o).catch(() => h.state?.(LinkState.FAILED));
  });

  return {
    send: sender(() => channel),
    stop() {
      off();
      pc?.close();
      pc = null;
      channel = null;
    }
  };
}
