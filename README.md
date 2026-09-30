# Mijn Garmin

Privé-dashboard op GitHub Pages. De repo is openbaar, daarom staat alles wat privé is versleuteld in `enc/`
(AES-GCM, sleutel via PBKDF2-SHA256 uit het wachtwoord). Leesbare bronbestanden en data staan in `src/`,
dat nooit gecommit wordt.

| Onderdeel | Bron (`src/`, niet in git) | Waar bijgewerkt |
|---|---|---|
| `data`   | `data.json` — Garmin-data | Windows-pc, dagelijks |
| `strava` | `strava.json` — uit Strava-archief | Mac, af en toe |
| `css`, `html`, `js` (`app`) | `app.css`, `app.html`, `app.js` | Mac, bij wijzigingen aan het dashboard |

`node tools/build.mjs <onderdelen>` versleutelt alleen de genoemde onderdelen; de rest blijft zoals in de vorige
build. Het wachtwoord komt uit `GD_PASSWORD` of een verborgen prompt, en moet passen bij de huidige build.

## Dagelijkse update (Windows)

1. `git pull`
2. Garmin-data ophalen en wegschrijven als `src/data.json` (zelfde structuur als voorheen de `const DATA`)
3. `node tools/build.mjs data` met `GD_PASSWORD` gezet
4. `git add enc manifest.json` → commit → push

Niet meer zelf een `index.html` genereren: die is nu vast.

## Strava bijwerken (Mac)

1. Strava → Instellingen → Mijn account → archief aanvragen; `activities.csv` en `activities/` naar `src/strava/`
2. `node tools/strava-import.mjs` → `src/strava.json` (activiteiten opgenomen met een Garmin worden overgeslagen;
   de rest wordt in de browser nog ontdubbeld tegen de Garmin-data)
3. `node tools/build.mjs strava` → commit → push

## Nieuw wachtwoord

`node tools/build.mjs all --new-salt` (vereist alle bronbestanden) en daarna `GD_PASSWORD` op Windows aanpassen.
