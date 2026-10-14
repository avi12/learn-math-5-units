import { BridgeMessage, bridgeMessenger, ExtensionMessage, extensionMessenger, GLIC_URL, within, type Activation } from '../utils/protocol';

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
      void bridgeMessenger.sendMessage(BridgeMessage.ACTIVATE, a).catch(() => {});
    };

    // Whichever of the two scripts comes up second finds the other: the bridge asks when
    // it is installed, and this tells it once the worker has answered.
    bridgeMessenger.onMessage(BridgeMessage.PRESENT, () => activation);
    bridgeMessenger.onMessage(BridgeMessage.CAPTURE, () => extensionMessenger.sendMessage(ExtensionMessage.GLIC_CAPTURE).catch(() => null));
    bridgeMessenger.onMessage(BridgeMessage.REPORT, ({ data }) => {
      void extensionMessenger.sendMessage(ExtensionMessage.GLIC_REPORT, data).catch(() => {});
    });

    // a new exercise: the activation again, which the bridge takes as a new name only
    extensionMessenger.onMessage(ExtensionMessage.GLIC_RETITLE, ({ data }) => {
      if (activation) {
        activate(data);
      }
    });
    extensionMessenger.onMessage(ExtensionMessage.GLIC_CALL, ({ data }) =>
      within(CALL_TIMEOUT_MS, bridgeMessenger.sendMessage(BridgeMessage.CALL, data), null)
    );

    const hello = await extensionMessenger.sendMessage(ExtensionMessage.GLIC_HELLO).catch(() => null);
    if (hello?.mine) {
      activate({ title: hello.title, url: hello.url });
    }
  }
});
