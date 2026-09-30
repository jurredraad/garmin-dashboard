// Eenmalig: ontsleutelt de oude index.html (één versleutelde pagina) naar src/_legacy.html.
//   node tools/decrypt-legacy.mjs          vraagt het dashboardwachtwoord
//   node tools/decrypt-legacy.mjs --key    vraagt de opgeslagen browsersleutel (localStorage "garmin-dash-key")
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { getPassword } from "./prompt.mjs";

const useKey = process.argv.includes("--key");
const file = process.argv.slice(2).find(a => !a.startsWith("--")) ?? "src/legacy-index.html";
const html = readFileSync(file, "utf8");
const m = html.match(/const P = (\{.*?\});/s);
if (!m) throw new Error("Geen versleutelde payload (const P) gevonden");
const P = JSON.parse(m[1]);
const b64 = s => Buffer.from(s, "base64");

let key;
if (useKey) {
  // Terminals kunnen bij plakken escape-codes (\x1b[200~ … \x1b[201~) meesturen; alleen de base64 overhouden.
  const input = (await getPassword("Sleutel: ")).replace(/\x1b\[20[01]~/g, "");
  const match = input.match(/[A-Za-z0-9+/]{43}=/);
  if (!match) {
    console.error(`Geen geldige sleutel geplakt (${input.length} tekens ontvangen, verwacht 44).`);
    console.error('Kopieer opnieuw in de Chrome-console: copy(localStorage.getItem("garmin-dash-key"))');
    console.error("en plak direct daarna, zonder tussendoor iets anders te kopiëren.");
    process.exit(1);
  }
  key = await crypto.subtle.importKey("raw", b64(match[0]), "AES-GCM", false, ["decrypt"]);
} else {
  const pw = await getPassword();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(P.salt), iterations: P.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(P.iv) }, key, b64(P.ct))
  .catch(() => { console.error(useKey ? "Verkeerde sleutel." : "Verkeerd wachtwoord."); process.exit(1); });

mkdirSync("src", { recursive: true });
writeFileSync("src/_legacy.html", Buffer.from(plain));
console.log(`Ontsleuteld naar src/_legacy.html (${plain.byteLength} bytes). Salt: ${P.salt}`);
