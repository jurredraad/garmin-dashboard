// Gedeelde versleuteling voor build: PBKDF2-SHA256 → AES-GCM-256, zelfde schema als loader.js.
import { webcrypto as crypto } from "node:crypto";

export const ITER = 600000;
export const b64 = buf => Buffer.from(buf).toString("base64");
export const unb64 = s => Buffer.from(s, "base64");
export const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, salt, iter = ITER) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Elke aanroep krijgt een nieuwe IV: bij AES-GCM mag een IV nooit hergebruikt worden met dezelfde sleutel.
export async function encrypt(key, bytes) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: b64(iv), ct: new Uint8Array(ct) };
}

export async function decrypt(key, iv, ct) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, ct));
}
