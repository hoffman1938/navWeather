/**
 * A small, dependency-free reader for OpenStreetMap PBF files (https://wiki.openstreetmap.org/wiki/PBF_Format):
 * file blocks → zlib → PrimitiveBlocks → nodes (plain and dense), ways and relations with their tags.
 * Enough for our regional extracts (Geofabrik); lzma/zstd blobs are not supported (Geofabrik uses zlib).
 *
 *   for (const block of readPbf(buffer)) for (const e of block) …   // e: { type, id, lat?, lon?, tags, refs?, members? }
 */
import { inflateSync } from 'node:zlib';

/** Protobuf wire reader over a Uint8Array (varints decoded as JS numbers: exact up to 2^53). */
class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }
  eof() {
    return this.pos >= this.end;
  }
  varint() {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  }
  svarint() {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  bytes() {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    return [start, this.pos];
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      const len = this.varint(); // read first: `pos += varint()` would add to the old position
      this.pos += len;
    }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
  /** Iterate fields: yields [field, wire]; the caller reads or skips the value. */
  *fields() {
    while (this.pos < this.end) {
      const key = this.varint();
      yield [Math.floor(key / 8), key % 8];
    }
  }
  packed(read) {
    const [s, e] = this.bytes();
    const r = new Reader(this.buf, s, e);
    const out = [];
    while (!r.eof()) out.push(read(r));
    return out;
  }
}

const utf8 = new TextDecoder();

function decodeBlob(buf) {
  const r = new Reader(buf);
  let raw = null;
  let zlib = null;
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 2) raw = r.bytes();
    else if (f === 3 && w === 2) zlib = r.bytes();
    else r.skip(w);
  }
  if (raw) return buf.subarray(raw[0], raw[1]);
  if (zlib) return inflateSync(buf.subarray(zlib[0], zlib[1]));
  throw new Error('unsupported blob compression (only raw and zlib)');
}

function tagsOf(keys, vals, strings) {
  const t = {};
  for (let i = 0; i < keys.length; i++) t[strings[keys[i]]] = strings[vals[i]];
  return t;
}

function decodePrimitiveBlock(buf) {
  const r = new Reader(buf);
  let strings = [];
  const groups = [];
  let granularity = 100;
  let latOff = 0;
  let lonOff = 0;
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 2) {
      const [s, e] = r.bytes();
      const sr = new Reader(buf, s, e);
      strings = [];
      for (const [sf, sw] of sr.fields()) {
        if (sf === 1 && sw === 2) {
          const [a, b] = sr.bytes();
          strings.push(utf8.decode(buf.subarray(a, b)));
        } else sr.skip(sw);
      }
    } else if (f === 2 && w === 2) groups.push(r.bytes());
    else if (f === 17) granularity = r.varint();
    else if (f === 19) latOff = r.varint();
    else if (f === 20) lonOff = r.varint();
    else r.skip(w);
  }
  const coord = (v, off) => (off + granularity * v) * 1e-9;
  const out = [];
  for (const [gs, ge] of groups) {
    const g = new Reader(buf, gs, ge);
    for (const [f, w] of g.fields()) {
      const [s, e] = f >= 1 && f <= 4 && w === 2 ? g.bytes() : [0, 0];
      if (f === 1) out.push(decodeNode(new Reader(buf, s, e), strings, coord, latOff, lonOff));
      else if (f === 2) decodeDense(new Reader(buf, s, e), strings, coord, latOff, lonOff, out);
      else if (f === 3) out.push(decodeWay(new Reader(buf, s, e), strings));
      else if (f === 4) out.push(decodeRelation(new Reader(buf, s, e), strings));
      else if (!(f >= 1 && f <= 4 && w === 2)) g.skip(w);
    }
  }
  return out;
}

function decodeNode(r, strings, coord, latOff, lonOff) {
  let id = 0, lat = 0, lon = 0, keys = [], vals = [];
  for (const [f, w] of r.fields()) {
    if (f === 1) id = r.svarint();
    else if (f === 2) keys = r.packed((x) => x.varint());
    else if (f === 3) vals = r.packed((x) => x.varint());
    else if (f === 8) lat = r.svarint();
    else if (f === 9) lon = r.svarint();
    else r.skip(w);
  }
  return { type: 'node', id, lat: coord(lat, latOff), lon: coord(lon, lonOff), tags: tagsOf(keys, vals, strings) };
}

function decodeDense(r, strings, coord, latOff, lonOff, out) {
  let ids = [], lats = [], lons = [], kv = [];
  for (const [f, w] of r.fields()) {
    if (f === 1) ids = r.packed((x) => x.svarint());
    else if (f === 8) lats = r.packed((x) => x.svarint());
    else if (f === 9) lons = r.packed((x) => x.svarint());
    else if (f === 10) kv = r.packed((x) => x.varint());
    else r.skip(w);
  }
  let id = 0, lat = 0, lon = 0, k = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];
    const tags = {};
    if (kv.length) {
      while (k < kv.length && kv[k] !== 0) {
        tags[strings[kv[k]]] = strings[kv[k + 1]];
        k += 2;
      }
      k++; // the 0 that ends this node's tags
    }
    out.push({ type: 'node', id, lat: coord(lat, latOff), lon: coord(lon, lonOff), tags });
  }
}

function decodeWay(r, strings) {
  let id = 0, keys = [], vals = [], refs = [];
  for (const [f, w] of r.fields()) {
    if (f === 1) id = r.varint();
    else if (f === 2) keys = r.packed((x) => x.varint());
    else if (f === 3) vals = r.packed((x) => x.varint());
    else if (f === 8) refs = r.packed((x) => x.svarint());
    else r.skip(w);
  }
  for (let i = 1; i < refs.length; i++) refs[i] += refs[i - 1];
  return { type: 'way', id, tags: tagsOf(keys, vals, strings), refs };
}

const MEMBER = ['node', 'way', 'relation'];

function decodeRelation(r, strings) {
  let id = 0, keys = [], vals = [], roles = [], memids = [], types = [];
  for (const [f, w] of r.fields()) {
    if (f === 1) id = r.varint();
    else if (f === 2) keys = r.packed((x) => x.varint());
    else if (f === 3) vals = r.packed((x) => x.varint());
    else if (f === 8) roles = r.packed((x) => x.varint());
    else if (f === 9) memids = r.packed((x) => x.svarint());
    else if (f === 10) types = r.packed((x) => x.varint());
    else r.skip(w);
  }
  let ref = 0;
  const members = memids.map((d, i) => {
    ref += d;
    return { type: MEMBER[types[i]] ?? 'node', ref, role: strings[roles[i]] ?? '' };
  });
  return { type: 'relation', id, tags: tagsOf(keys, vals, strings), members };
}

/** Every element of the file, block by block (header blocks skipped). */
export function* readPbf(buf) {
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const headerLen = buf.readUInt32BE(pos);
    pos += 4;
    const hr = new Reader(buf, pos, pos + headerLen);
    let type = '';
    let dataSize = 0;
    for (const [f, w] of hr.fields()) {
      if (f === 1 && w === 2) {
        const [a, b] = hr.bytes();
        type = utf8.decode(buf.subarray(a, b));
      } else if (f === 3) dataSize = hr.varint();
      else hr.skip(w);
    }
    pos += headerLen;
    const blob = buf.subarray(pos, pos + dataSize);
    pos += dataSize;
    if (type === 'OSMData') yield decodePrimitiveBlock(decodeBlob(blob));
  }
}
