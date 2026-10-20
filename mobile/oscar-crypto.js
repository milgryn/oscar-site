// OSCAR Mobile : mêmes dérivations et même chiffrement que le PC (src-tauri/src/services/mobile.rs).
// Code d'appairage (base32, 20 octets) → HKDF-SHA256 (sel « oscar-mobile-v1 ») → clé AES-256-GCM (« enc »)
// et canal (« channel », 16 octets en hexadécimal). Message chiffré : base64(nonce 12 octets ‖ chiffré + tag).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const te = new TextEncoder();
const td = new TextDecoder();

export function normalizeCode(code) {
  return String(code).toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function base32Decode(code) {
  const clean = normalizeCode(code);
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("code invalide");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function formatCode(code) {
  return (normalizeCode(code).match(/.{1,4}/g) || []).join("-");
}

const b64 = {
  encode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(text) {
    const s = atob(text.trim());
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

/** { channel, key } à partir du code d'appairage. Lève une erreur si le code est invalide. */
export async function deriveKeys(code, subtle = globalThis.crypto.subtle) {
  const secret = base32Decode(code);
  if (secret.length !== 20) throw new Error("code invalide");
  const base = await subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const derive = (info, bits) =>
    subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: te.encode("oscar-mobile-v1"), info: te.encode(info) }, base, bits);
  const [encBits, chBits] = await Promise.all([derive("enc", 256), derive("channel", 128)]);
  const key = await subtle.importKey("raw", encBits, "AES-GCM", false, ["encrypt", "decrypt"]);
  const channel = [...new Uint8Array(chBits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { channel, key };
}

export async function encryptJson(keys, value, subtle = globalThis.crypto.subtle) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, keys.key, te.encode(JSON.stringify(value))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64.encode(out);
}

export async function decryptJson(keys, payload, subtle = globalThis.crypto.subtle) {
  const raw = b64.decode(payload);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, keys.key, raw.subarray(12));
  return JSON.parse(td.decode(plain));
}
