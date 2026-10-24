/** The pen's side button, handed in from outside the browser.
 *
 * Chrome on Android never delivers a stylus-button touch to the page — it claims the
 * button for text selection, and the page sees no pointer event at all (measured on a
 * Galaxy Tab S3 with `?pendebug`: a normal touch prints a line, a touch with the button
 * prints nothing). No web API reaches past that, so the only way to get the button is to
 * be the thing that owns the window.
 *
 * `android/` is a WebView wrapper that does exactly that and nothing else. What it sends
 * is deliberately RAW — `buttonState` and `toolType` as Android reported them — and the
 * decision about what those mean is made here, in the web app. That split is the point:
 * changing the gesture, adding the eraser end, dropping the whole idea, are all a web
 * deploy, and a web deploy already reloads every open tab by itself. The APK only ever
 * has to be installed again if the wrapper itself gains a field.
 *
 * In an ordinary browser tab nobody calls any of this, `held` stays false, and every
 * other way of erasing works exactly as before.
 */

/** Android's MotionEvent button bits (`buttonState`). Every one of them means "rub out";
 *  which one a given pen sends is the pen's business. STYLUS_PRIMARY is the S Pen's. */
export const AndroidButton = {
  SECONDARY: 0x02,
  STYLUS_PRIMARY: 0x20,
  STYLUS_SECONDARY: 0x40
} as const;
export type AndroidButton = (typeof AndroidButton)[keyof typeof AndroidButton];

const ERASE_BUTTONS = AndroidButton.SECONDARY | AndroidButton.STYLUS_PRIMARY | AndroidButton.STYLUS_SECONDARY;

/** Android's MotionEvent.TOOL_TYPE_* codes, as `toolType` carries them. ERASER is the far
 *  end of a pen that has one; the rest are listed so a ?pendebug reading can be looked up. */
export const AndroidToolType = {
  UNKNOWN: 0,
  FINGER: 1,
  STYLUS: 2,
  MOUSE: 3,
  ERASER: 4
} as const;
export type AndroidToolType = (typeof AndroidToolType)[keyof typeof AndroidToolType];

/* The same facts as the browser reports them, for the pages that never see the wrapper.
   Pointer Events names the device in `pointerType`, the buttons held in the `buttons`
   bitmask, and the button that changed in `button` — and a pen's barrel and eraser have
   their own entries in both. */

/** `PointerEvent.pointerType`. */
export const PointerKind = { PEN: 'pen', TOUCH: 'touch', MOUSE: 'mouse' } as const;
export type PointerKind = (typeof PointerKind)[keyof typeof PointerKind];

/** Bits of `PointerEvent.buttons`: what is held right now. TIP is a pen on the glass (or
 *  the left mouse button); BARREL is the pen's side button (or the right mouse button). */
export const PointerButtons = { TIP: 1, BARREL: 2, ERASER: 32 } as const;
export type PointerButtons = (typeof PointerButtons)[keyof typeof PointerButtons];

/** `PointerEvent.button`: which button this one event is about. */
export const PointerButton = { BARREL: 2, ERASER: 5 } as const;
export type PointerButton = (typeof PointerButton)[keyof typeof PointerButton];

/** The values of `data-theme` on the root, which the skin's stylesheet switches on. */
export const Theme = { DARK: 'dark', LIGHT: 'light' } as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

export interface PenReport {
  /** true when the wrapper's own reading of the button bits says a button is down */
  button?: boolean;
  /** MotionEvent.buttonState, verbatim */
  buttonState?: number;
  /** MotionEvent.getToolType(0), verbatim */
  toolType?: number;
  /** sent once per page load, so the page knows it is inside the wrapper */
  hello?: boolean;
  /** the wrapper's version, for the ?pendebug readout */
  wrapper?: string;
  /** the tablet's dark mode, as the wrapper reads it — see applyWrapperTheme */
  dark?: boolean;
}

let held = false;
let wrapper = '';
let dark: boolean | null = null;
let listener: ((change: { down: boolean; report: PenReport }) => void) | null = null;

/** The wrapper's own side of the bridge. Present only inside the Android app. */
export interface AndroidPad {
  version(): string;
  /** Hand a file to the Android share sheet. Base64, no data: prefix. */
  share(name: string, mime: string, base64: string): boolean;
}

declare global {
  interface Window {
    /** Raw pen facts from the native wrapper. */
    __pen?: (r: PenReport) => void;
    /** The older, narrower call. Kept so a wrapper that predates __pen still works. */
    __spen?: (down: boolean) => void;
    /** Injected by the wrapper; undefined in a browser tab. */
    AndroidPad?: AndroidPad;
  }
}

/** The wrapper's bridge, or null in an ordinary tab. Everything that uses it has to
 *  keep working without it — the same page is opened in Chrome on the desktop. */
export function pad(): AndroidPad | null {
  return typeof window.AndroidPad?.share === 'function' ? window.AndroidPad : null;
}

export function spenHeld(): boolean {
  return held;
}

/** '' outside the wrapper; the wrapper's version inside it. */
export function spenWrapper(): string {
  return wrapper;
}

/** Wear the theme the wrapper reported.
 *
 *  A WebView decides `prefers-color-scheme` from the app theme's `isLightTheme` and from
 *  nothing else, and on the tablet this app exists for that road is closed twice: the
 *  attribute is API 29 and the tablet is API 28, and One UI 1's "Night theme" is Samsung's
 *  own and never sets the AOSP night bit. Measured in the running app: status bar black,
 *  page told `light`. So the wrapper reads it natively and says so here.
 *
 *  This is the one place the raw report is turned into a decision, which is the rule the
 *  rest of this file follows. `data-theme` is a switch the stylesheet already has — it is
 *  what the desktop toggle would set — so nothing new is styled, and an ordinary browser
 *  tab never reaches this line and keeps following the OS on its own. */
function applyWrapperTheme(next: boolean) {
  dark = next;
  document.documentElement.dataset.theme = next ? Theme.DARK : Theme.LIGHT;
}

function decide(r: PenReport): boolean {
  const bits = r.buttonState ?? 0;
  return (bits & ERASE_BUTTONS) !== 0 || r.toolType === AndroidToolType.ERASER || r.button === true;
}

/** Publish the hooks. Returns the teardown, so a component can own it. */
export function installSpen(onchange?: NonNullable<typeof listener>): () => void {
  listener = onchange ?? null;
  function set({ down: next, report: r }: Parameters<NonNullable<typeof listener>>[0]): void {
    if (typeof r.wrapper === 'string') {
      wrapper = r.wrapper;
    }

    // Before the early return below: the theme arrives on `hello` and on a toggle, and
    // both of those carry no button change at all.
    if (typeof r.dark === 'boolean' && r.dark !== dark) {
      applyWrapperTheme(r.dark);
    }

    if (next === held) {
      return;
    }

    held = next;
    listener?.({ down: held, report: r });
  }

  window.__pen = (r) => set({ down: decide(r ?? {}), report: r ?? {} });
  window.__spen = (down) => set({ down: down === true, report: { button: down === true } });
  return () => {
    delete window.__pen;
    delete window.__spen;
    listener = null;
    held = false;
    wrapper = '';
    // Leave `data-theme` alone: the wrapper's answer is still the right one for this
    // device, and clearing it would drop the page back to a media query that cannot work.
    dark = null;
  };
}
