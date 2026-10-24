/** Conversions between the Web Audio API's float samples and the 16-bit PCM that Gemini
 *  Live sends and expects. Little-endian is written out through a DataView rather than
 *  trusted to the platform, since that is what the wire says. */
const PCM16_MAX = 0x7fff;
const PCM16_MIN = -0x8000;
const BYTES_PER_SAMPLE = 2;

export function floatToPcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = clamped < 0 ? Math.round(clamped * -PCM16_MIN) : Math.round(clamped * PCM16_MAX);
  }
  return pcm;
}

export function pcm16ToFloat(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / BYTES_PER_SAMPLE));
  for (let i = 0; i < samples.length; i++) {
    const sample = view.getInt16(i * BYTES_PER_SAMPLE, true);
    samples[i] = sample < 0 ? sample / -PCM16_MIN : sample / PCM16_MAX;
  }
  return samples;
}

export function pcm16Bytes(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.length * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(i * BYTES_PER_SAMPLE, pcm[i] ?? 0, true);
  }
  return bytes;
}

/** Box-filter downsampling: each output sample is the mean of the input samples it
 *  covers. A browser may refuse the 16 kHz context the mic asks for and run at 48 kHz;
 *  averaging is enough for speech and keeps the worklet out of the resampling business. */
export function downsample({ samples, fromRate, toRate }: {
  samples: Float32Array;
  fromRate: number;
  toRate: number;
}) {
  if (fromRate <= toRate) {
    return samples;
  }

  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let iOut = 0; iOut < output.length; iOut++) {
    const start = Math.floor(iOut * ratio);
    const end = Math.min(samples.length, Math.floor((iOut + 1) * ratio));
    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += samples[i] ?? 0;
    }
    output[iOut] = sum / Math.max(1, end - start);
  }
  return output;
}
