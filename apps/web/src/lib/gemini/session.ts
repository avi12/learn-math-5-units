/** A Gemini Live session over the public API's WebSocket, straight from the page.
 *
 *  The server ends every socket after a while (it sends `goAway` first) and hands out
 *  resumption handles along the way. So a session is not one socket: on `goAway` a second
 *  socket opens with the latest handle, and only once it is set up does it replace the
 *  first, so the conversation carries on with no gap and no lost context. Only when the
 *  socket that matters closes — the live one with no replacement under way, or the
 *  replacement itself — is the session over, and `onClosed` says why.
 *
 *  Audio and frames sent before setup completes, or while no socket is open, are
 *  dropped rather than queued: they are a live stream, and stale audio is worse than none. */
import type { Frame } from '@learn-math/shared/protocol';
import { bytesToBase64 } from './base64';
import { LIVE_ENDPOINT, LIVE_MODEL, LIVE_VOICE } from './defaults';
import {
  audioMessage,
  buildSetupMessage,
  parseServerMessage,
  type ServerEvent,
  ServerEventKind,
  videoMessage
} from './messages';
import { pcm16Bytes } from './pcm';

const SESSION_ENDED = 'The session ended';
const RECONNECT_FAILED = 'Reconnect failed';
const CLOSE_NORMAL = 1000;
const CLOSE_REASON_STOPPED = 'bye';

export const LiveConnection = {
  CONNECTING: 'connecting',
  READY: 'ready',
  RECONNECTING: 'reconnecting'
} as const;
export type LiveConnection = (typeof LiveConnection)[keyof typeof LiveConnection];

export interface LiveClosure {
  reason: string;
  /** the socket closed before setup completed — a bad key, model or setup, not a drop */
  isSetupRejected: boolean;
}

export interface LiveSessionEvents {
  onConnection(connection: LiveConnection): void;
  onAudio(bytes: Uint8Array): void;
  onInterrupted(): void;
  /** a piece of the transcription of what the learner said */
  onUserText(text: string): void;
  /** a piece of the transcription of what Gemini said */
  onModelText(text: string): void;
  onTurnComplete(): void;
  onClosed(closure: LiveClosure): void;
}

export interface LiveSessionOptions {
  apiKey: string;
  systemInstruction: string;
  events: LiveSessionEvents;
  model?: string;
  voice?: string;
}

const textDecoder = new TextDecoder();

function messageText(data: unknown) {
  if (typeof data === 'string') {
    return data;
  }

  return data instanceof ArrayBuffer ? textDecoder.decode(data) : '';
}

/** A browser WebSocket cannot set headers, so the key rides in the query string. */
function socketUrl(apiKey: string) {
  return `${LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
}

export function openLiveSession(options: LiveSessionOptions) {
  const { apiKey, systemInstruction, events, model = LIVE_MODEL, voice = LIVE_VOICE } = options;
  let active: WebSocket | null = null;
  let resuming: WebSocket | null = null;
  let resumeHandle: string | null = null;
  let isReady = false;
  let isStopped = false;

  function closeSockets() {
    for (const socket of [active, resuming]) {
      socket?.close(CLOSE_NORMAL, CLOSE_REASON_STOPPED);
    }
    active = null;
    resuming = null;
  }

  /** Both ways a session ends, from either side: nothing more goes out or comes in. */
  function shutDown() {
    isStopped = true;
    isReady = false;
    closeSockets();
  }

  function finish(closure: LiveClosure) {
    if (isStopped) {
      return;
    }

    shutDown();
    events.onClosed(closure);
  }

  function promote(socket: WebSocket) {
    if (socket === resuming) {
      active?.close(CLOSE_NORMAL, CLOSE_REASON_STOPPED);
      active = socket;
      resuming = null;
    }

    isReady = true;
    events.onConnection(LiveConnection.READY);
  }

  function resume() {
    if (resuming) {
      return;
    }

    events.onConnection(LiveConnection.RECONNECTING);
    resuming = connect();
  }

  function handle({ socket, event }: {
    socket: WebSocket;
    event: ServerEvent;
  }) {
    switch (event.kind) {
      case ServerEventKind.SETUP_COMPLETE:
        promote(socket);
        return;
      case ServerEventKind.AUDIO:
        events.onAudio(event.bytes);
        return;
      case ServerEventKind.INTERRUPTED:
        events.onInterrupted();
        return;
      case ServerEventKind.USER_TEXT:
        events.onUserText(event.text);
        return;
      case ServerEventKind.MODEL_TEXT:
        events.onModelText(event.text);
        return;
      case ServerEventKind.TURN_COMPLETE:
        events.onTurnComplete();
        return;
      case ServerEventKind.RESUME_HANDLE:
        resumeHandle = event.handle;
        return;
      case ServerEventKind.GO_AWAY:
        resume();
    }
  }

  function onSocketClosed({ socket, reason, wasSetUp }: {
    socket: WebSocket;
    reason: string;
    wasSetUp: boolean;
  }) {
    if (socket === resuming) {
      finish({
        reason: `${RECONNECT_FAILED}: ${reason || SESSION_ENDED}`,
        isSetupRejected: !wasSetUp
      });
      return;
    }

    /** The old socket closing after its replacement took over, or while one is opening,
     *  is the handover working, not the session ending. */
    if (socket !== active || resuming) {
      return;
    }

    finish({
      reason: reason || SESSION_ENDED,
      isSetupRejected: !wasSetUp
    });
  }

  function connect() {
    const socket = new WebSocket(socketUrl(apiKey));
    socket.binaryType = 'arraybuffer';
    let wasSetUp = false;
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify(
          buildSetupMessage({
            model,
            voice,
            systemInstruction,
            resumeHandle
          })
        )
      );
    });
    socket.addEventListener('message', (e) => {
      for (const event of parseServerMessage(messageText(e.data))) {
        wasSetUp ||= event.kind === ServerEventKind.SETUP_COMPLETE;
        handle({
          socket,
          event
        });
      }
    });
    socket.addEventListener('close', (e) => {
      onSocketClosed({
        socket,
        reason: e.reason,
        wasSetUp
      });
    });
    return socket;
  }

  function send(message: object) {
    if (!isReady || active?.readyState !== WebSocket.OPEN) {
      return;
    }

    active.send(JSON.stringify(message));
  }

  events.onConnection(LiveConnection.CONNECTING);
  active = connect();

  return {
    sendAudio(pcm: Int16Array) {
      send(audioMessage(bytesToBase64(pcm16Bytes(pcm))));
    },
    sendFrame(frame: Frame) {
      send(videoMessage(frame));
    },
    close: shutDown
  };
}
