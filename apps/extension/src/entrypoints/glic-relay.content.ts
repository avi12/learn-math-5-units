import { orNull, quietly, within } from '../utils/async';
import {
  type Activation,
  BridgeCall,
  BridgeMessage,
  bridgeMessenger,
  BridgeReport,
  ExtensionMessage,
  extensionMessenger,
  GLIC_URL
} from '../utils/protocol';

/** Beside the bridge, in the Gemini tab: carry its reports to the worker and the worker's
 *  calls and pictures back down.
 *
 * Two scripts because of two worlds. The bridge has to run in the PAGE's world to stand
 * in for the host the Gemini client expects, and that world has no `chrome.runtime`. This
 * one runs in the extension's world, which has it, and the two share the document — so
 * they talk in DOM events on it (`bridgeMessenger`).
 *
 * It asks the worker first whether this tab was opened for a session, and only then
 * tells the bridge to take over. An ordinary visit to /glic is left exactly as it was. */

/** A call is a text turn at worst — up to half a minute of Gemini answering — so the
 *  wait is generous; a call that never answers still answers null in the end. */
const CALL_TIMEOUT_MS = 60_000;

export default defineContentScript({
  matches: [`${GLIC_URL}*`],
  runAt: 'document_start',

  async main() {
    if (window.top !== window) {
      return;
    }

    let activation: Activation | null = null;
    const activate = (a: Activation): void => {
      activation = a;
      void quietly(bridgeMessenger.sendMessage(BridgeMessage.ACTIVATE, a));
    };

    // Whichever of the two scripts comes up second finds the other: the bridge asks when
    // it is installed, and this tells it once the worker has answered.
    bridgeMessenger.onMessage(BridgeMessage.PRESENT, () => activation);
    bridgeMessenger.onMessage(BridgeMessage.CAPTURE, () => {
      return orNull(extensionMessenger.sendMessage(ExtensionMessage.GLIC_CAPTURE));
    });

    // The bridge's reports, up to the worker: nothing waits on them.
    const up = (sent: Promise<void>): void => void quietly(sent);
    bridgeMessenger.onMessage(BridgeReport.BOOTED, () => up(extensionMessenger.sendMessage(BridgeReport.BOOTED)));
    bridgeMessenger.onMessage(BridgeReport.READY, () => up(extensionMessenger.sendMessage(BridgeReport.READY)));
    bridgeMessenger.onMessage(BridgeReport.STATE, ({ data }) => up(extensionMessenger.sendMessage(BridgeReport.STATE, data)));
    bridgeMessenger.onMessage(BridgeReport.ERROR, ({ data }) => up(extensionMessenger.sendMessage(BridgeReport.ERROR, data)));
    bridgeMessenger.onMessage(BridgeReport.TRANSCRIPT, ({ data }) => up(extensionMessenger.sendMessage(BridgeReport.TRANSCRIPT, data)));
    bridgeMessenger.onMessage(BridgeReport.TURN_END, ({ data }) => up(extensionMessenger.sendMessage(BridgeReport.TURN_END, data)));

    // The worker's calls, down to the bridge, each answered by a deadline.
    const down = <T>(answer: Promise<T>) => within({ ms: CALL_TIMEOUT_MS, promise: answer, fallback: null });
    extensionMessenger.onMessage(BridgeCall.START, () => down(bridgeMessenger.sendMessage(BridgeCall.START)));
    extensionMessenger.onMessage(BridgeCall.STOP, () => down(bridgeMessenger.sendMessage(BridgeCall.STOP)));
    extensionMessenger.onMessage(BridgeCall.BEGIN_TEXT, () => down(bridgeMessenger.sendMessage(BridgeCall.BEGIN_TEXT)));
    extensionMessenger.onMessage(BridgeCall.SUBMIT, () => down(bridgeMessenger.sendMessage(BridgeCall.SUBMIT)));
    extensionMessenger.onMessage(BridgeCall.ASK, ({ data }) => down(bridgeMessenger.sendMessage(BridgeCall.ASK, data)));

    // a new exercise: the activation again, which the bridge takes as a new name only
    extensionMessenger.onMessage(ExtensionMessage.GLIC_RETITLE, ({ data }) => {
      if (!activation) {
        return;
      }

      activate(data);
    });

    const hello = await orNull(extensionMessenger.sendMessage(ExtensionMessage.GLIC_HELLO));
    if (!hello?.mine) {
      return;
    }

    activate({ title: hello.title, url: hello.url });
  }
});
