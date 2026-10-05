/**
 * Reading Open-Meteo `.om` files over HTTP range requests (only the parts we need) with `@openmeteo/file-reader`
 * (GPL-2.0; a dev dependency of this pipeline — never shipped to the app or the Worker).
 *
 * The reader (0.0.20, the newest) gets the first few decodes of a process wrong — the same wrong numbers each time,
 * from the same bytes (a DEM chunk around Tbilisi: 2 548 of 3 600 cells garbage for the first four decodes, right
 * from the fifth on, in any file). So before the first real read, a few decodes are thrown away; and every block is
 * still decoded twice from the same downloaded bytes and the two results must agree. Bytes are fetched once per
 * block, so the checks cost no extra download.
 */
import { OmDataType, OmFileReader } from '@openmeteo/file-reader';

export const BUCKET = 'https://openmeteo.s3.amazonaws.com';

export const stats = { bytes: 0, requests: 0 };

/**
 * A ceiling on what one run may download (`--max-mb`, set by each pipeline from what the owner agreed to): the run
 * stops before going over it rather than after.
 */
let maxBytes = Infinity;
export function setDownloadLimit(mb) {
  maxBytes = mb > 0 ? mb * 1e6 : Infinity;
}

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

/**
 * A file on the bucket, read in 64 KB blocks: each block is fetched once (until `clear()`), and the reader's prefetch
 * fetches the blocks of a read in parallel — one read of a 1° DEM tile went from 319 requests in a row (84 s) to a
 * few dozen at once.
 */
const BLOCK = 64 * 1024;
const PREFETCH_CONCURRENCY = 16;

class RangeBackend {
  constructor(url, blockSize = BLOCK) {
    this.url = url;
    this.blockSize = blockSize;
    this.size = null;
    this.blocks = new Map();
  }
  async count() {
    if (this.size === null) {
      const res = await fetchRetry(this.url, { method: 'HEAD' });
      this.size = Number(res.headers.get('content-length'));
    }
    return this.size;
  }
  block(i) {
    let p = this.blocks.get(i);
    if (!p) {
      const start = i * this.blockSize;
      const end = Math.min(this.size, start + this.blockSize);
      if (stats.bytes + (end - start) > maxBytes) {
        p = Promise.reject(new Error(`download limit of ${(maxBytes / 1e6).toFixed(0)} MB reached (--max-mb) — stopping before going over it`));
        p.catch(() => {});
        return p;
      }
      p = fetchRetry(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } }).then(async (res) => {
        const b = new Uint8Array(await res.arrayBuffer());
        if (b.length !== end - start) throw new Error(`${this.url}: got ${b.length} bytes for ${end - start}`);
        stats.bytes += b.length;
        stats.requests++;
        return b;
      });
      this.blocks.set(i, p);
      p.catch(() => this.blocks.delete(i));
    }
    return p;
  }
  /** blockSize 0: exactly the ranges the reader asks for (its prefetch and its decode ask for the same ones). */
  exact(offset, size) {
    const key = `${offset}:${size}`;
    let p = this.blocks.get(key);
    if (!p) {
      if (stats.bytes + size > maxBytes) {
        p = Promise.reject(new Error(`download limit of ${(maxBytes / 1e6).toFixed(0)} MB reached (--max-mb) — stopping before going over it`));
        p.catch(() => {});
        return p;
      }
      p = fetchRetry(this.url, { headers: { Range: `bytes=${offset}-${offset + size - 1}` } }).then(async (res) => {
        const b = new Uint8Array(await res.arrayBuffer());
        if (b.length !== size) throw new Error(`${this.url}: got ${b.length} bytes for ${size}`);
        stats.bytes += size;
        stats.requests++;
        return b;
      });
      this.blocks.set(key, p);
      p.catch(() => this.blocks.delete(key));
    }
    return p;
  }
  async getBytes(offset, size) {
    await this.count();
    if (!this.blockSize) return (await this.exact(offset, size)).slice();
    const first = Math.floor(offset / this.blockSize);
    const last = Math.floor((offset + size - 1) / this.blockSize);
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => this.block(first + k)));
    // A copy: the reader may keep or change what it gets.
    const out = new Uint8Array(size);
    let o = 0;
    parts.forEach((b, k) => {
      const from = k === 0 ? offset - first * this.blockSize : 0;
      const to = Math.min(b.length, offset + size - (first + k) * this.blockSize);
      out.set(b.subarray(from, to), o);
      o += to - from;
    });
    return out;
  }
  async collectPrefetchTasks(offset, size) {
    await this.count();
    if (!this.blockSize) return [() => this.exact(offset, size).then(() => undefined)];
    const first = Math.floor(offset / this.blockSize);
    const last = Math.floor((offset + size - 1) / this.blockSize);
    return Array.from({ length: last - first + 1 }, (_, k) => () => this.block(first + k).then(() => undefined));
  }
  clear() {
    this.blocks.clear();
  }
  async close() {}
}

/** Decodes thrown away once per process before any real read (four go wrong; twice that to be safe). */
const WARMUP_DECODES = 8;
let warmedUp = null;

const same = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
  return true;
};

/** One variable of one model run. */
export class OmVariable {
  /**
   * `blockKB`: smaller blocks waste less on narrow reads (a 1° DEM tile is a thin slice of its band); 0 = exactly the
   * ranges the reader asks for (many small slices, as the air-quality tiles read them).
   */
  static async open(path, { blockKB = 64 } = {}) {
    const backend = new RangeBackend(`${BUCKET}/${path}`, blockKB * 1024);
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

  /**
   * Values for rows [r0, r1) × columns [c0, c1) × every time, row-major (Float32Array, NaN = no value).
   * The reader is asked for whole chunks only and the block is cut out here: it decodes small reads inside one
   * chunk wrongly (a single cell of the DEM came back as -32591 instead of 428 m, every time, from the same bytes).
   */
  async read(r0, r1, c0, c1) {
    const [cr, cc] = this.reader.getChunkDimensions();
    const R0 = Math.floor(r0 / cr) * cr;
    const R1 = Math.min(this.dims[0], Math.ceil(r1 / cr) * cr);
    const C0 = Math.floor(c0 / cc) * cc;
    const C1 = Math.min(this.dims[1], Math.ceil(c1 / cc) * cc);
    const T = this.dims.slice(2).reduce((a, b) => a * b, 1);
    const ranges = [{ start: R0, end: R1 }, { start: C0, end: C1 }, ...this.dims.slice(2).map((d) => ({ start: 0, end: d }))];
    const once = async () => Float32Array.from(await this.reader.read({ type: OmDataType.FloatArray, ranges, prefetch: true, prefetchConcurrency: PREFETCH_CONCURRENCY }));
    warmedUp ??= (async () => {
      const first = [{ start: 0, end: cr }, { start: 0, end: cc }, ...this.dims.slice(2).map((d) => ({ start: 0, end: d }))];
      for (let i = 0; i < WARMUP_DECODES; i++) await this.reader.read({ type: OmDataType.FloatArray, ranges: first });
    })();
    await warmedUp;
    let all;
    try {
      const a = await once();
      const b = await once();
      if (same(a, b)) all = a;
      else {
        const c = await once();
        if (!same(b, c)) throw new Error(`${this.path}: decoding rows ${r0}–${r1} columns ${c0}–${c1} gave different results`);
        all = c;
      }
    } finally {
      this.backend.clear();
    }
    if (R0 === r0 && R1 === r1 && C0 === c0 && C1 === c1) return all;
    const W = C1 - C0;
    const w = c1 - c0;
    const out = new Float32Array((r1 - r0) * w * T);
    for (let r = r0; r < r1; r++) out.set(all.subarray(((r - R0) * W + (c0 - C0)) * T, ((r - R0) * W + (c1 - C0)) * T), (r - r0) * w * T);
    return out;
  }

  dispose() {
    this.reader.dispose();
  }
}
