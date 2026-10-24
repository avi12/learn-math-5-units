/** The mic's AudioWorklet: it runs on the audio thread and only gathers samples into
 *  40 ms chunks for the main thread, which converts and sends them (mic.ts). Sending
 *  every 128-sample render quantum would mean hundreds of socket messages a second.
 *
 *  It is loaded through Vite's `?worker&url` (mic.ts), so it is bundled as its own file
 *  and may import the shared processor name. The worklet globals are declared here
 *  because the app's DOM typings do not include the AudioWorklet scope. */
import { MIC_PROCESSOR_NAME } from './defaults';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

const CHUNK_SECONDS = 0.04;

class MicProcessor extends AudioWorkletProcessor {
  private readonly chunk = new Float32Array(Math.round(sampleRate * CHUNK_SECONDS));
  private filled = 0;

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (!channel) {
      return true;
    }

    for (const sample of channel) {
      this.chunk[this.filled++] = sample;

      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor(MIC_PROCESSOR_NAME, MicProcessor);
