// Ontsleutelt de onderdelen uit manifest.json en start het dashboard.
// Dit is een module: niets hieruit belandt in de globale scope van app.js.
const KEY = "garmin-dash-key";
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const text = bytes => new TextDecoder().decode(bytes);

const $ = id => document.getElementById(id);
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: v => { try { localStorage.setItem(KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(KEY); } catch {} },
};

const manifest = await (await fetch("manifest.json", { cache: "no-cache" })).json();

async function keyFromPassword(pw) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(manifest.salt), iterations: manifest.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function open(key, part) {
  const f = manifest.files[part];
  const res = await fetch(f.path);
  if (!res.ok) throw new Error(`${f.path}: ${res.status}`);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(f.iv) }, key, await res.arrayBuffer()));
}

function runScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Kon ${src} niet laden`));
    document.body.append(s);
  });
}

async function start(key) {
  // Alles eerst ontsleutelen (gooit bij een verkeerde sleutel), pas daarna de pagina aanpassen.
  const [css, html, data, js, strava] = await Promise.all(["css", "html", "data", "js", "strava"]
    .map(p => manifest.files[p] ? open(key, p) : null));
  const style = document.createElement("style");
  style.textContent = text(css);
  document.head.append(style);
  document.body.className = "";
  document.body.innerHTML = text(html);
  // Scripts via innerHTML worden niet uitgevoerd: externe libs (bv. Leaflet) hier op volgorde laden.
  for (const s of [...document.body.querySelectorAll("script[src]")]) {
    s.remove();
    await runScript(s.src);
  }
  window.DATA = JSON.parse(text(data));
  window.STRAVA = strava ? JSON.parse(text(strava)) : [];
  // Klassiek script via Blob-URL, zodat inline handlers en globale functies van de app blijven werken.
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  await runScript(url);
  URL.revokeObjectURL(url);
}

const saved = store.get();
let started = false;
if (saved) {
  try {
    await start(await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", false, ["decrypt"]));
    started = true;
  } catch { store.clear(); }
}

if (!started) {
  const f = $("f");
  f.hidden = false;
  $("pw").focus();
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const go = $("go"), err = $("err");
    go.disabled = true; err.hidden = true;
    let key;
    try {
      key = await keyFromPassword($("pw").value);
      await open(key, "css"); // snelle wachtwoordcheck vóór alles ontsleuteld wordt
    } catch { err.hidden = false; go.disabled = false; return; }
    if ($("rem").checked) store.set(toB64(await crypto.subtle.exportKey("raw", key)));
    await start(key);
  });
}
