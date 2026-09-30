// Versleutelt onderdelen uit src/ naar enc/ en werkt manifest.json bij.
// Onderdelen die je niet noemt blijven zoals ze in de vorige build stonden.
//
//   node tools/build.mjs data                Windows: alleen nieuwe Garmin-data (src/data.json)
//   node tools/build.mjs app strava          Mac: app-code (css, html, js) en/of Strava-import
//   node tools/build.mjs all --new-salt      nieuw wachtwoord: alles opnieuw (alle bronbestanden nodig)
//
// Wachtwoord uit GD_PASSWORD of een verborgen prompt.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { ITER, b64, unb64, randomBytes, deriveKey, encrypt, decrypt } from "./crypto.mjs";
import { getPassword } from "./prompt.mjs";

const SRC = process.env.GD_SRC ?? "src";
const PARTS = { css: "app.css", html: "app.html", data: "data.json", strava: "strava.json", js: "app.js" };
const ALIASES = { app: ["css", "html", "js"], all: Object.keys(PARTS) };
const JSON_PARTS = ["data", "strava"];

const args = process.argv.slice(2);
const newSalt = args.includes("--new-salt");
const wanted = [...new Set(args.filter(a => !a.startsWith("--")).flatMap(a => ALIASES[a] ?? [a]))];
const unknown = wanted.filter(p => !PARTS[p]);
if (!wanted.length || unknown.length) {
  console.error(`Gebruik: node tools/build.mjs <${[...Object.keys(ALIASES), ...Object.keys(PARTS)].join("|")}>… [--new-salt]`);
  if (unknown.length) console.error(`Onbekend onderdeel: ${unknown.join(", ")}`);
  process.exit(1);
}
for (const p of wanted) {
  const f = `${SRC}/${PARTS[p]}`;
  if (!existsSync(f)) throw new Error(`Ontbreekt: ${f}`);
  if (JSON_PARTS.includes(p)) JSON.parse(readFileSync(f, "utf8")); // faalt vroeg bij kapotte data
}

// Eerste build zonder manifest: salt van de oude alles-in-één pagina overnemen als die er is.
const legacy = existsSync(`${SRC}/legacy-index.html`)
  ? JSON.parse(readFileSync(`${SRC}/legacy-index.html`, "utf8").match(/const P = (\{.*?\});/s)[1])
  : null;
const old = existsSync("manifest.json") ? JSON.parse(readFileSync("manifest.json", "utf8")) : legacy;
const salt = old && !newSalt ? unb64(old.salt) : randomBytes(16);
const iter = old?.iter ?? ITER;

// Met een nieuwe sleutel zijn oude onderdelen onleesbaar: dan moet alles opnieuw.
const keep = newSalt || !old?.files ? [] : Object.keys(old.files).filter(p => !wanted.includes(p) && PARTS[p]);
const missing = Object.keys(PARTS).filter(p => p !== "strava" && !wanted.includes(p) && !keep.includes(p));
if (missing.length) throw new Error(`Geen bron en geen vorige build voor: ${missing.join(", ")}. Neem ze mee (bv. "all").`);

const password = await getPassword();
if (!password) throw new Error("Leeg wachtwoord");
const key = await deriveKey(password, salt, iter);

// Zelfde salt maar ander wachtwoord zou alle bezoekers stil buitensluiten: controleer tegen de vorige build.
if (old && !newSalt) {
  const [iv, ct] = old.files
    ? [Object.values(old.files)[0].iv, readFileSync(Object.values(old.files)[0].path)]
    : [old.iv, unb64(old.ct)];
  const ok = await decrypt(key, iv, ct).then(() => true, () => false);
  if (!ok) throw new Error("Wachtwoord past niet bij de huidige build. Nieuw wachtwoord? Gebruik --new-salt met \"all\".");
}

mkdirSync("enc", { recursive: true });
const files = {};
for (const p of Object.keys(PARTS)) {
  if (keep.includes(p)) { files[p] = old.files[p]; continue; }
  if (!wanted.includes(p)) continue;
  const { iv, ct } = await encrypt(key, readFileSync(`${SRC}/${PARTS[p]}`));
  const path = `enc/${createHash("sha256").update(ct).digest("hex").slice(0, 12)}.bin`;
  writeFileSync(path, ct);
  files[p] = { path, iv };
}
// Alleen bestanden uit deze build bewaren
const live = new Set(Object.values(files).map(f => f.path.slice(4)));
for (const f of readdirSync("enc")) if (!live.has(f)) rmSync(`enc/${f}`);

const build = createHash("sha256").update(Object.values(files).map(f => f.path).join()).digest("hex").slice(0, 12);
writeFileSync("manifest.json", JSON.stringify({ v: 1, build, salt: b64(salt), iter, files }, null, 2) + "\n");
console.log(`Build ${build}: versleuteld ${wanted.join(", ")}${keep.length ? `; ongewijzigd ${keep.join(", ")}` : ""}`);
