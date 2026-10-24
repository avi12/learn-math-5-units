/** The microphone, as 16 kHz 16-bit PCM chunks for the Live socket.
 *
 *  The worklet's URL comes from Vite's `?worker&url`: in dev it is the module served on
 *  the fly, and in a build Vite bundles the worklet (with what it imports) into its own
 *  asset and hands back that file's URL. A bare `new URL('./mic-worklet.ts',
 *  import.meta.url)` would copy the TypeScript source untranspiled into the build. */
import { MIC_PROCESSOR_NAME, MIC_SAMPLE_RATE } from './defaults';
import workletUrl from './mic-worklet.ts?worker&url';
import { downsample, floatToPcm16 } from './pcm';

/** The browser's own echo cancellation is what keeps Gemini from hearing itself through
 *  the speakers and interrupting its own answer. */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export async function openMic(onChunk: (pcm: Int16Array) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
  await context.audioWorklet.addModule(workletUrl);
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, MIC_PROCESSOR_NAME);
  processor.port.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (!(e.data instanceof Float32Array)) {
      return;
    }

    onChunk(
      floatToPcm16(
        downsample({
          samples: e.data,
          fromRate: context.sampleRate,
          toRate: MIC_SAMPLE_RATE
        })
      )
    );
  });
  processor.port.start();
  source.connect(processor);
  processor.connect(context.destination);
  await context.resume();

  return {
    close() {
      source.disconnect();
      processor.disconnect();
      for (const track of stream.getTracks()) {
        track.stop();
      }
      void context.close();
    }
  };
}

export type Mic = Awaited<ReturnType<typeof openMic>>;
