/** Transcribe a 16 kHz mono WAV with Whisper, locally.
 *
 *   npm i                                   (once — see package.json)
 *   node build/transcribe.mjs <in.wav> <out.txt> [model] [lang]
 *
 * Several of the workbook's videos carry no captions at all, so the only way to know
 * what a teacher actually says in them is to listen. transformers.js runs Whisper on the
 * CPU here; the clips are 4-12 minutes, which is well within reach.
 *
 * `whisper-base` turns Hebrew into repetition loops — `onnx-community/whisper-large-v3-turbo`
 * is the floor, at roughly 3.5 minutes of CPU per 7.5 minutes of clip.
 *
 * It used to live in the pad's repo, because that is where @huggingface/transformers
 * happened to be installed. Nothing about it belongs to the pad: it reads this repo's
 * videos to write this repo's pages, so it is here now and this repo declares the
 * dependency itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';

const [, , inFile, outFile, model = 'onnx-community/whisper-base', lang = 'he'] = process.argv;

/** Minimal WAV reader: we control the file, and ffmpeg wrote it as PCM s16le mono. */
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error(`expected 16-bit mono, got ${fmt.bits}-bit x${fmt.channels}`);
  }
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return { audio: out, rate: fmt.rate };
}

const { audio, rate } = readWav(inFile);
console.error(`audio: ${(audio.length / rate / 60).toFixed(1)} min at ${rate} Hz`);
if (rate !== 16000) throw new Error('resample to 16 kHz first (ffmpeg -ar 16000)');

let last = -1;
const asr = await pipeline('automatic-speech-recognition', model, {
  dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
  progress_callback: (e) => {
    if (e.status === 'progress' && typeof e.progress === 'number') {
      const p = Math.floor(e.progress / 20) * 20;
      if (p !== last) { last = p; process.stderr.write(`\rdownloading ${p}%   `); }
    }
  }
});
console.error('\nmodel ready, transcribing…');

const t0 = Date.now();
const out = await asr(audio, {
  language: lang,
  task: 'transcribe',
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: true
});
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
const chunks = out.chunks ?? [];
const lines = chunks.length
  ? chunks.map((c) => `[${(c.timestamp?.[0] ?? 0).toFixed(0)}s] ${c.text.trim()}`).join('\n')
  : text;
writeFileSync(outFile, lines, 'utf-8');
console.error(`wrote ${outFile}  (${text.length} chars)`);
