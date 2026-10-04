/**
 * Reading Open-Meteo `.om` files over HTTP range requests (only the parts we need) with `@openmeteo/file-reader`
 * (GPL-2.0; a dev dependency of this pipeline — never shipped to the app or the Worker).
 *
 * Every block is decoded twice from the same downloaded bytes and the two results must agree: the reader's first
 * large decode in a process can come back wrong (seen with 0.0.20 — likely its WASM memory growing mid-read), and a
 * forecast must never carry such numbers. Bytes are fetched once per block, so checking costs no extra download.
 */
import { OmDataType, OmFileReader } from '@openmeteo/file-reader';

export const BUCKET = 'https://openmeteo.s3.amazonaws.com';

export const stats = { bytes: 0, requests: 0 };

async function fetchRetry(url, init, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      if (res.status < 500 || i >= tries) throw new Error(`${url}: HTTP ${res.status}`);
    } catch (e) {
      if (i >= tries) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * i * i));
  }
}

export async function getJson(path) {
  return (await fetchRetry(`${BUCKET}/${path}`)).json();
}

/** A file on the bucket: range reads, each range fetched once until `clear()`. */
class RangeBackend {
  constructor(url) {
    this.url = url;
    this.size = null;
    this.cache = new Map();
  }
  async count() {
    if (this.size === null) {
      const res = await fetchRetry(this.url, { method: 'HEAD' });
      this.size = Number(res.headers.get('content-length'));
    }
    return this.size;
  }
  getBytes(offset, size) {
    const key = `${offset}:${size}`;
    let p = this.cache.get(key);
    if (!p) {
      p = fetchRetry(this.url, { headers: { Range: `bytes=${offset}-${offset + size - 1}` } }).then(async (res) => {
        const b = new Uint8Array(await res.arrayBuffer());
        if (b.length !== size) throw new Error(`${this.url}: got ${b.length} bytes for ${size}`);
        stats.bytes += size;
        stats.requests++;
        return b;
      });
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    // The reader may keep or change what it gets: hand out a copy.
    return p.then((b) => b.slice());
  }
  clear() {
    this.cache.clear();
  }
  async close() {}
}

const same = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
  return true;
};

/** One variable of one model run. */
export class OmVariable {
  static async open(path) {
    const backend = new RangeBackend(`${BUCKET}/${path}`);
    const reader = await OmFileReader.create(backend);
    const v = new OmVariable(path, backend, reader);
    for (let i = 0; i < reader.numberOfChildren(); i++) {
      const c = await reader.getChild(i);
      const name = c.getName();
      if (name === 'unit') v.unit = await c.readScalar(OmDataType.String);
      if (name === 'time') v.times = Array.from(await c.read({ type: OmDataType.Int64Array, ranges: c.getDimensions().map((d) => ({ start: 0, end: d })) }), Number);
      if (name === 'forecast_reference_time') v.referenceTime = Number(await c.readScalar(OmDataType.Int64));
    }
    backend.clear();
    return v;
  }

  constructor(path, backend, reader) {
    this.path = path;
    this.backend = backend;
    this.reader = reader;
    this.unit = null;
    this.times = null;
    this.referenceTime = null;
    this.dims = reader.getDimensions();
  }

  /** Values for rows [r0, r1) × columns [c0, c1) × every time, row-major (Float32Array, NaN = no value). */
  async read(r0, r1, c0, c1) {
    const ranges = [{ start: r0, end: r1 }, { start: c0, end: c1 }, ...this.dims.slice(2).map((d) => ({ start: 0, end: d }))];
    const once = async () => Float32Array.from(await this.reader.read({ type: OmDataType.FloatArray, ranges }));
    try {
      const a = await once();
      const b = await once();
      if (same(a, b)) return a;
      const c = await once();
      if (same(b, c)) return c;
      throw new Error(`${this.path}: decoding rows ${r0}–${r1} columns ${c0}–${c1} gave different results`);
    } finally {
      this.backend.clear();
    }
  }

  dispose() {
    this.reader.dispose();
  }
}
