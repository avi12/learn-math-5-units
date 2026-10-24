/** What the bridge reads off the Gemini page: its buttons, by their labels, and its words.
 *
 * Everything matched on the page — button labels, phrases — is Google's and will change
 * one day. Each is named once, here. */

/** Fragments of the client's button aria-labels. */
export const Button = {
  CONFIRM_OK: 'OK',
  COPY: 'Copy',
  END: 'End',
  GO_BACK: 'Go back',
  GO_LIVE: 'Go Live',
  GOOD_RESPONSE: 'Good response',
  NO_THANKS: 'No thanks',
  PAUSE_LIVE: 'Pause live mode',
  REGENERATE: 'Regenerate',
  SEND: 'Send',
  SEND_MESSAGE: 'Send message',
  SKIP: 'Skip',
  START_LIVE: 'Start live mode',
  STOP_RESPONSE: 'Stop response',
  SUBMIT: 'Submit',
  TEXT_MODE: 'Switch to text mode',
  TRY_AGAIN: 'Try again',
  TURN_ON_CAPTIONS: 'Turn on live captions'
} as const;

/** Either one shows while Live is paused; clicking it resumes. */
export const RESUME_BUTTONS = [Button.START_LIVE, Button.GO_LIVE];
export const SUBMIT_BUTTONS = [Button.SUBMIT, Button.SEND_MESSAGE, Button.SEND];
/** The client shows these under an answer only once it has finished. */
export const REPLY_DONE = [Button.COPY, Button.GOOD_RESPONSE, Button.REGENERATE];

export const Phrase = {
  MIC_CONSENT: 'Live will use your microphone',
  UNAVAILABLE: "isn't available right now",
  WENT_WRONG: 'Something went wrong'
} as const;
const SIGN_IN = /\bSign in\b/;

const pageText = (): string => document.body?.innerText ?? '';
export const pageSays = (p: string): boolean => pageText().includes(p);

export const findButton = (...fragments: string[]): HTMLButtonElement | null => {
  const buttons = [...document.querySelectorAll('button')];
  for (const f of fragments) {
    const b = buttons.find((x) => (x.getAttribute('aria-label') ?? '').includes(f));
    if (b) {
      return b;
    }
  }
  return null;
};

export const clickButton = (...fragments: string[]): boolean => {
  const b = findButton(...fragments);
  b?.click();
  return !!b;
};

/** The error screen's button carries its words as text, not always as a label. */
export const tryAgainButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) =>
    `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.includes(Button.TRY_AGAIN)
  );

export const isSignedOut = (): boolean =>
  location.hostname === 'accounts.google.com' || (SIGN_IN.test(pageText()) && !findButton(Button.GO_LIVE));
