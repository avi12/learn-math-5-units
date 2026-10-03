/** Download and transcribe one video per workbook block.
 *
 *   node build/transcribe_batch.mjs <scratchdir>
 *
 * Sequential on purpose: Whisper already uses every core. The PICKS table below is
 * workbook data — block number to the video its playlist already links to — which is
 * the reason this file belongs in this repo and not beside the pad it used to sit in.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** resolved against this file, so the batch runs from wherever you happen to be */
const TRANSCRIBE = fileURLToPath(new URL('transcribe.mjs', import.meta.url));

const scratch = process.argv[2];
const audio = join(scratch, 'audio');
const subs = join(scratch, 'subs');
mkdirSync(audio, { recursive: true });

// One video per block, chosen from the playlist the block already links to.
const PICKS = [
  ['02', 'XRtL5TkWB6M'],   // proving a sequence is geometric, computing terms
  ['04', 'teMJYNMALTQ'],   // probability with a two-way table
  ['05', 'uumWMrwQfjY'],   // proportion in a circle
  ['06', 'ecmI6otcXg8'],   // plane trigonometry: a proof, identities
  ['09', 'Nt2AKx4_zNY'],   // geometric extremum problems
  ['07', '5-cbKIajxcc']    // full rational-function investigation, start to finish
];

for (const [block, id] of PICKS) {
  const wav = join(audio, `${id}.wav`);
  const out = join(subs, `${id}.large.txt`);
  if (existsSync(out)) {
    console.error(`block ${block}: ${id} already transcribed`);
    continue;
  }
  if (!existsSync(wav)) {
    console.error(`block ${block}: downloading ${id}`);
    execFileSync('yt-dlp', [
      '--extractor-args', 'youtube:player_client=web_embedded',
      '-f', 'bestaudio', '--extract-audio', '--audio-format', 'wav',
      '--postprocessor-args', '-ar 16000 -ac 1',
      '-o', join(audio, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${id}`
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  console.error(`block ${block}: transcribing ${id}`);
  execFileSync('node', [TRANSCRIBE, wav, out, 'onnx-community/whisper-large-v3-turbo', 'he'],
    { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.error('batch done');
