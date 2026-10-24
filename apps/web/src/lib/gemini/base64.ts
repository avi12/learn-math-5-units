/** Base64 for the audio that crosses the Live socket. `String.fromCharCode(...bytes)`
 *  over a whole buffer overflows the call stack on a few seconds of audio, so the bytes
 *  are spread in chunks small enough for any engine's argument limit. */
const BASE64_CHUNK_BYTES = 0x8000;

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
