// Eenmalig: splitst src/_legacy.html (oude alles-in-één pagina) in src/app.css, app.html, app.js en data.json.
import { readFileSync, writeFileSync } from "node:fs";

let html = readFileSync("src/_legacy.html", "utf8");

const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1].trim()).join("\n\n");
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (inline.length !== 1) throw new Error(`Verwacht 1 inline script, gevonden: ${inline.length}`);

const m = inline[0].match(/^\s*const DATA = (\{.*\});?\s*$/m);
if (!m) throw new Error("Geen 'const DATA = {...}' regel gevonden");
const data = JSON.parse(m[1]);
const js = inline[0].replace(m[0], "\n// DATA wordt door loader.js op window.DATA gezet.\n").trim() + "\n";

// Body-markup + externe libs (link/script src) houden; inline script, style, meta en title eruit.
const head = [...html.matchAll(/<link[^>]*>|<script[^>]*\bsrc=[^>]*><\/script>/g)].map(m => m[0]);
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) ?? [, html])[1]
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<(meta|title|link)[^>]*>(<\/title>)?/g, "")
  .trim();

writeFileSync("src/app.css", css + "\n");
writeFileSync("src/app.html", [...head, body].join("\n") + "\n");
writeFileSync("src/app.js", js);
writeFileSync("src/data.json", JSON.stringify(data));
console.log(`css ${css.length}, html ${body.length}, js ${js.length}, data ${data.days?.length ?? "?"} dagen`);
