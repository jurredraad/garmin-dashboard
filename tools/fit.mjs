// Minimale FIT-lezer (Garmin/Runna/etc. activiteitbestanden): leest file_id, session, lap en record.
// Alleen de velden die het dashboard gebruikt; onbekende velden worden overgeslagen.
const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000;
const SEMI = 180 / 2 ** 31;

// Base types: [grootte, lezer, ongeldige waarde]
const BASE = {
  0x00: [1, (b, p) => b.readUInt8(p), 0xff], 0x01: [1, (b, p) => b.readInt8(p), 0x7f],
  0x02: [1, (b, p) => b.readUInt8(p), 0xff], 0x0a: [1, (b, p) => b.readUInt8(p), 0x00],
  0x83: [2, (b, p, le) => le ? b.readInt16LE(p) : b.readInt16BE(p), 0x7fff],
  0x84: [2, (b, p, le) => le ? b.readUInt16LE(p) : b.readUInt16BE(p), 0xffff],
  0x8b: [2, (b, p, le) => le ? b.readUInt16LE(p) : b.readUInt16BE(p), 0x0000],
  0x85: [4, (b, p, le) => le ? b.readInt32LE(p) : b.readInt32BE(p), 0x7fffffff],
  0x86: [4, (b, p, le) => le ? b.readUInt32LE(p) : b.readUInt32BE(p), 0xffffffff],
  0x8c: [4, (b, p, le) => le ? b.readUInt32LE(p) : b.readUInt32BE(p), 0x00000000],
  0x88: [4, (b, p, le) => le ? b.readFloatLE(p) : b.readFloatBE(p), null],
};

// global message → { veldnummer: [naam, schaal, offset] }
const MESSAGES = {
  0: { name: "file_id", fields: { 1: ["manufacturer"], 2: ["product"] } },
  18: { name: "session", fields: { 2: ["start_time"], 5: ["sport"], 7: ["elapsed", 1000], 8: ["timer", 1000],
    9: ["distance", 100], 11: ["calories"], 16: ["avg_hr"], 17: ["max_hr"], 18: ["avg_cadence"], 22: ["ascent"] } },
  19: { name: "lap", fields: { 7: ["elapsed", 1000], 9: ["distance", 100], 15: ["avg_hr"], 16: ["max_hr"],
    17: ["avg_cadence"], 21: ["ascent"] } },
  20: { name: "record", fields: { 253: ["timestamp"], 0: ["lat"], 1: ["lon"], 2: ["altitude", 5, 500], 3: ["hr"],
    4: ["cadence"], 5: ["distance", 100], 6: ["speed", 1000], 73: ["speed", 1000], 78: ["altitude", 5, 500] } },
};

export function parseFit(buf) {
  const headerSize = buf[0];
  const end = headerSize + buf.readUInt32LE(4);
  if (buf.toString("ascii", 8, 12) !== ".FIT") throw new Error("Geen FIT-bestand");
  const defs = {}, out = { file_id: [], session: [], lap: [], record: [] };
  let p = headerSize, lastTs = 0;

  while (p < end) {
    const h = buf[p++];
    let local, compressedTs = null;
    if (h & 0x80) { // compressed timestamp header
      local = (h >> 5) & 3;
      const off = h & 0x1f;
      compressedTs = lastTs + ((off - (lastTs & 0x1f)) & 0x1f);
    } else if (h & 0x40) { // definition message
      local = h & 0x0f;
      p++; // reserved
      const le = buf[p++] === 0;
      const global = le ? buf.readUInt16LE(p) : buf.readUInt16BE(p); p += 2;
      const n = buf[p++], fields = [];
      for (let i = 0; i < n; i++, p += 3) fields.push({ num: buf[p], size: buf[p + 1], type: buf[p + 2] });
      let dev = 0;
      if (h & 0x20) { const nd = buf[p++]; for (let i = 0; i < nd; i++, p += 3) dev += buf[p + 1]; }
      defs[local] = { global, le, fields, dev };
      continue;
    } else {
      local = h & 0x0f;
    }

    const d = defs[local];
    if (!d) throw new Error(`FIT: data zonder definitie (local ${local})`);
    const spec = MESSAGES[d.global];
    const msg = {};
    for (const f of d.fields) {
      const want = spec?.fields[f.num];
      const bt = BASE[f.type];
      if (want && bt && f.size === bt[0]) {
        const v = bt[1](buf, p, d.le);
        if (v !== bt[2] && !(typeof v === "number" && Number.isNaN(v))) {
          const [name, scale = 1, offset = 0] = want;
          msg[name] = v / scale - offset;
        }
      }
      p += f.size;
    }
    p += d.dev;

    if (msg.timestamp != null) lastTs = msg.timestamp;
    else if (compressedTs != null && d.global === 20) { msg.timestamp = compressedTs; lastTs = compressedTs; }
    if (!spec) continue;
    for (const k of ["timestamp", "start_time"]) if (msg[k] != null) msg[k] = (msg[k] + FIT_EPOCH) * 1000;
    if (msg.lat != null) msg.lat *= SEMI;
    if (msg.lon != null) msg.lon *= SEMI;
    out[spec.name].push(msg);
  }
  return out;
}

export const FIT_MANUFACTURER = { 1: "Garmin", 265: "Strava", 294: "Coros", 123: "Polar", 32: "Wahoo", 89: "Tacx", 260: "Zwift" };
