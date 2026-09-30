// Versleutelt src/ naar enc/ en schrijft manifest.json.
//   node tools/build.mjs              wachtwoord uit GD_PASSWORD of verborgen prompt
//   node tools/build.mjs --new-salt   nieuwe salt (na een wachtwoordwissel; iedereen logt opnieuw in)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { ITER, b64, unb64, randomBytes, deriveKey, encrypt, decrypt } from "./crypto.mjs";
import { getPassword } from "./prompt.mjs";

const SRC = process.env.GD_SRC ?? "src";
// Volgorde = laadvolgorde in loader.js
const PARTS = { css: "app.css", html: "app.html", data: "data.json", js: "app.js" };

for (const f of Object.values(PARTS)) {
  if (!existsSync(`${SRC}/${f}`)) throw new Error(`Ontbreekt: ${SRC}/${f}`);
}
JSON.parse(readFileSync(`${SRC}/data.json`, "utf8")); // faalt vroeg bij kapotte data

// Eerste build zonder manifest: salt van de oude alles-in-één pagina overnemen als die er is,
// zodat opgeslagen sleutels in browsers blijven werken bij hetzelfde wachtwoord.
const legacy = existsSync(`${SRC}/legacy-index.html`)
  ? JSON.parse(readFileSync(`${SRC}/legacy-index.html`, "utf8").match(/const P = (\{.*?\});/s)[1])
  : null;
const old = existsSync("manifest.json") ? JSON.parse(readFileSync("manifest.json", "utf8")) : legacy;
const salt = old && !process.argv.includes("--new-salt") ? unb64(old.salt) : randomBytes(16);
const iter = old?.iter ?? ITER;

const password = await getPassword();
if (!password) throw new Error("Leeg wachtwoord");
const key = await deriveKey(password, salt, iter);

// Zelfde salt maar ander wachtwoord zou alle bezoekers stil buitensluiten: controleer tegen de vorige build.
if (old && Buffer.compare(salt, unb64(old.salt)) === 0) {
  const [iv, ct] = old.files
    ? [Object.values(old.files)[0].iv, readFileSync(Object.values(old.files)[0].path)]
    : [old.iv, unb64(old.ct)];
  const ok = await decrypt(key, iv, ct).then(() => true, () => false);
  if (!ok) throw new Error("Wachtwoord past niet bij de huidige build. Nieuw wachtwoord? Gebruik --new-salt.");
}

mkdirSync("enc", { recursive: true });
for (const f of readdirSync("enc")) rmSync(`enc/${f}`);

const files = {};
const hash = createHash("sha256");
for (const [name, f] of Object.entries(PARTS)) {
  const { iv, ct } = await encrypt(key, readFileSync(`${SRC}/${f}`));
  const path = `enc/${createHash("sha256").update(ct).digest("hex").slice(0, 12)}.bin`;
  writeFileSync(path, ct);
  files[name] = { path, iv };
  hash.update(ct);
}

const manifest = { v: 1, build: hash.digest("hex").slice(0, 12), salt: b64(salt), iter, files };
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Build ${manifest.build}: ${Object.keys(files).length} bestanden versleuteld naar enc/`);
