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

/** Android's MotionEvent button bits. Every one of them means "rub out"; which one a
 *  given pen sends is the pen's business. BUTTON_STYLUS_PRIMARY is the S Pen's. */
const BUTTON_SECONDARY = 0x02;
const BUTTON_STYLUS_PRIMARY = 0x20;
const BUTTON_STYLUS_SECONDARY = 0x40;
const ERASE_BUTTONS = BUTTON_SECONDARY | BUTTON_STYLUS_PRIMARY | BUTTON_STYLUS_SECONDARY;

/** MotionEvent.TOOL_TYPE_ERASER — the far end of a pen that has one. */
const TOOL_TYPE_ERASER = 4;

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
let listener: ((v: boolean, r: PenReport) => void) | null = null;

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
  document.documentElement.dataset.theme = next ? 'dark' : 'light';
}

function decide(r: PenReport): boolean {
  const bits = r.buttonState ?? 0;
  return (bits & ERASE_BUTTONS) !== 0 || r.toolType === TOOL_TYPE_ERASER || r.button === true;
}

/** Publish the hooks. Returns the teardown, so a component can own it. */
export function installSpen(onchange?: (v: boolean, r: PenReport) => void): () => void {
  listener = onchange ?? null;
  function set(next: boolean, r: PenReport): void {
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
    listener?.(held, r);
  }

  window.__pen = (r) => set(decide(r ?? {}), r ?? {});
  window.__spen = (down) => set(down === true, { button: down === true });
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
