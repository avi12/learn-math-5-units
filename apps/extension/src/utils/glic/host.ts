/** The browser host the Gemini client is handed, and the handover — why the bridge stands
 *  in for Chrome here is told in glic.content.ts. */
import type { Activation } from '../protocol';
import type { Frame } from '@learn-math/shared/protocol';

type Json = Record<string, unknown>;
type Subscriber = (value: unknown) => void;

/** Host API values, from Chromium's glic_api_generated.ts. */
const PanelStateKind = { ATTACHED: 2 } as const;
const Platform = { LINUX: 3 } as const;
const FormFactor = { DESKTOP: 1 } as const;
const HostCapability = { MULTI_INSTANCE: 3, PDF_ZERO_STATE: 7, INVOKE: 8 } as const;

const PANEL_STATE = { kind: PanelStateKind.ATTACHED, windowId: 'pad' };

/** A picture as the host API hands it over. */
type HostFrame = ReturnType<typeof toHostFrame>;

/** A picture off the wire, as the client wants it: bytes, not base64. */
export const toHostFrame = (f: Frame | null) => {
  if (!f?.base64) {
    return null;
  }

  const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
  return { data: bytes.buffer, mimeType: f.mimeType, widthPixels: f.width, heightPixels: f.height };
};

const notify = ({ subscriber, value }: { subscriber: Subscriber; value: unknown }): void => {
  try {
    subscriber(value);
  } catch {
    /* a subscriber's error is its own */
  }
};

const observable = (value: unknown) => ({
  subscribe(change: Subscriber) {
    notify({ subscriber: change, value });
    return { unsubscribe() {} };
  }
});

const resolved = (value: unknown) => () => Promise.resolve(value);

/** The host. `capture` draws a picture for Live; `closed` is the client closing its panel.
 *  The shared tab it shows is renamed by `retitle`, and shared anew by `share`. */
export function createHost({ capture, closed }: { capture: () => Promise<HostFrame>; closed: () => void }) {
  let focusedTab: Json = {
    tabId: 'pad',
    url: location.origin,
    title: 'לוח מתמטיקה',
    faviconUrl: '',
    documentMimeType: 'text/html',
    isMediaActive: false
  };

  /** The shared tab, under the id of the latest share (the bridge's `SHARE_MS`). */
  let shares = 0;
  const currentTab = (): Json => ({ ...focusedTab, tabId: `pad-${shares}` });
  const focusedTabState = () => ({ hasFocus: { tabData: currentTab() } });

  const focusedTabSubscribers = new Set<Subscriber>();
  const focusedTabObservable = () => ({
    subscribe(change: Subscriber) {
      focusedTabSubscribers.add(change);
      notify({ subscriber: change, value: focusedTabState() });
      return { unsubscribe: () => focusedTabSubscribers.delete(change) };
    }
  });

  const announceFocusedTab = (): void => {
    for (const subscriber of focusedTabSubscribers) {
      notify({ subscriber, value: focusedTabState() });
    }
  };

  // Captions on: they are what the person sees in the Gemini window.
  const captions = observable(true);

  const host: Json = {
    getChromeVersion: resolved({ major: 130, minor: 0, build: 0, patch: 0 }),
    getPlatform: () => Platform.LINUX,
    getFormFactor: () => FormFactor.DESKTOP,
    getHostCapabilities: () =>
      new Set([HostCapability.MULTI_INSTANCE, HostCapability.PDF_ZERO_STATE, HostCapability.INVOKE]),
    getUserProfileInfo: resolved({
      displayName: 'You',
      email: '',
      givenName: 'You',
      localProfileName: 'You',
      isManaged: false,
      avatarIcon: resolved(undefined)
    }),
    getPanelState: () => observable(PANEL_STATE),
    panelActive: () => observable(true),
    getFocusedTabStateV2: focusedTabObservable,
    getContextFromFocusedTab: () => Promise.resolve({ tabData: currentTab() }),
    captureScreenshot: () => capture(),
    // Live's continuous view: one call per picture, one picture per share.
    async getContextFromTab(_tabId: unknown, options?: { viewportScreenshot?: boolean }) {
      const context: Json = { tabData: currentTab() };
      if (!options?.viewportScreenshot) {
        return context;
      }

      const shot = await capture();
      if (shot) {
        context.viewportScreenshot = shot;
        context.screenshotInfo = { widthPixels: shot.widthPixels, heightPixels: shot.heightPixels };
      }
      return context;
    },
    getTabContextPermissionStateV2: () => observable(true),
    getMicrophonePermissionState: () => observable(true),
    getLocationPermissionState: () => observable(true),
    getTabContextPermissionState: () => observable(true),
    getClosedCaptioningSetting: () => captions,
    getDefaultTabContextPermissionState: () => observable(true),
    canAttachPanel: () => observable(false),
    isBrowserOpen: () => observable(true),
    isManuallyResizing: () => observable(false),
    getOsMicrophonePermissionStatus: resolved(true),
    getOsHotkeyState: () => observable({ hotkey: '' }),
    resizeWindow: resolved(undefined),
    setTabContextPermissionState: resolved(undefined),
    setMicrophonePermissionState: resolved(undefined),
    setLocationPermissionState: resolved(undefined),
    setClosedCaptioningSetting: resolved(undefined),
    attachPanel: resolved(undefined),
    detachPanel: resolved(undefined),
    closePanel() {
      closed();
      return Promise.resolve();
    }
  };

  return {
    host,
    /** a new name for the shared tab; the client hears it at once */
    retitle({ title, url }: Activation): void {
      focusedTab = { ...focusedTab, title, url };
      announceFocusedTab();
    },
    /** the shared tab under a new id, for Live to pull a fresh picture of */
    share(): void {
      shares++;
      announceFocusedTab();
    }
  };
}

/** Capture the client's bootstrap listener now, to replay it later. Must run before the
 *  client's own scripts, which is document_start. `hook` defines the client's boot hook,
 *  `replay` hands the listener the synthetic bootstrap, and `booted` hears that the client
 *  adopted `host`. */
export function captureBootstrap({ host, booted }: { host: Json; booted: () => void }) {
  const bootstrapHandlers: EventListener[] = [];
  const originalAdd = EventTarget.prototype.addEventListener;
  Object.defineProperty(window, 'addEventListener', {
    configurable: true,
    writable: true,
    value(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) {
      if (type === 'message' && typeof listener === 'function') {
        bootstrapHandlers.push(listener);
      }
      originalAdd.call(window, type, listener, options);
    }
  });

  const registry = {
    registerWebClient(client: Json & { initialize(h: Json): unknown; notifyPanelWillOpen?(s: unknown): unknown }) {
      return Promise.resolve()
        .then(() => client.initialize(host))
        .then(() => {
          booted();
          setTimeout(() => {
            if (client.notifyPanelWillOpen) {
              notify({ subscriber: (s) => client.notifyPanelWillOpen?.(s), value: PANEL_STATE });
            }
          }, 0);
        });
    }
  };

  const bootstrapEvent = (): MessageEvent =>
    new MessageEvent('message', {
      origin: 'chrome://glic',
      source: window,
      data: { type: 'glic-bootstrap', glicApiSource: 'data:text/javascript,//pad' }
    });

  return {
    hook(): void {
      (window as unknown as { internalAutoGlicBoot?: () => unknown }).internalAutoGlicBoot = () => registry;
    },
    replay(): void {
      for (const handler of bootstrapHandlers) {
        notify({ subscriber: handler as Subscriber, value: bootstrapEvent() });
      }
    }
  };
}
