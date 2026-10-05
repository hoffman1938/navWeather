/**
 * Where a pipeline writes (weather, air quality, elevation, map tiles): one R2 bucket of `wrangler.toml`, chosen by
 * its binding name.
 *   default        the local state of `wrangler dev` (.wrangler/state) — the dev Worker sees what we write
 *   env            `preview` / `production`: that environment's real bucket on Cloudflare, through a one-binding
 *                  config of our own (the Worker's config stays local); needs `wrangler login` or CLOUDFLARE_API_TOKEN
 *   out            plain files in a folder (inspection, CI artefacts)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function openStore({ binding, env, out }) {
  if (env && env !== 'preview' && env !== 'production') throw new Error('--env is preview or production');
  if (out) {
    return {
      kind: `files in ${out}`,
      put: async (key, bytes) => {
        mkdirSync(dirname(join(out, key)), { recursive: true });
        writeFileSync(join(out, key), bytes);
      },
      getText: async (key) => {
        try {
          return readFileSync(join(out, key), 'utf8');
        } catch {
          return null;
        }
      },
      has: async (key) => existsSync(join(out, key)),
      prefixes: async () => [],
      deletePrefix: async (prefix) => rmSync(join(out, prefix), { recursive: true, force: true }),
      close: async () => {},
    };
  }
  const { getPlatformProxy, unstable_readConfig } = await import('wrangler');
  let proxy;
  if (env) {
    const cfg = unstable_readConfig({ config: 'wrangler.toml', env }, { hideWarnings: true });
    const bucketName = cfg.r2_buckets.find((b) => b.binding === binding)?.bucket_name;
    if (!bucketName) throw new Error(`wrangler.toml [env.${env}] has no R2 binding ${binding}`);
    const configPath = `data/build/${binding.toLowerCase()}-remote.wrangler.json`;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ name: 'navweather-pipeline', compatibility_date: '2026-09-01', r2_buckets: [{ binding, bucket_name: bucketName, remote: true }] }));
    proxy = await getPlatformProxy({ configPath, persist: false });
  } else {
    proxy = await getPlatformProxy({ persist: true });
  }
  const bucket = proxy.env[binding];
  if (!bucket) throw new Error(`wrangler.toml has no R2 binding ${binding}`);
  const keys = async (prefix) => {
    const all = [];
    let cursor;
    do {
      const page = await bucket.list({ prefix, cursor });
      all.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return all;
  };
  return {
    kind: env ? `R2 ${binding} of ${env} on Cloudflare` : `local R2 ${binding} (the bucket of \`npm run dev\`)`,
    put: (key, bytes) => bucket.put(key, bytes),
    getText: async (key) => (await bucket.get(key))?.text() ?? null,
    has: async (key) => (await bucket.head(key)) !== null,
    /** The "folders" right under a prefix (ending in "/"). */
    prefixes: async (prefix) => (await bucket.list({ prefix, delimiter: '/' })).delimitedPrefixes,
    deletePrefix: async (prefix) => {
      const all = await keys(prefix);
      for (let i = 0; i < all.length; i += 1000) await bucket.delete(all.slice(i, i + 1000));
    },
    close: () => proxy.dispose(),
  };
}

/** `--name value` from the command line. */
export function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Up to `limit` writes at a time. */
export function writer(store, limit = 8) {
  const pending = new Set();
  let bytes = 0;
  return {
    async put(key, data) {
      while (pending.size >= limit) await Promise.race(pending);
      const p = store.put(key, data).finally(() => pending.delete(p));
      pending.add(p);
      bytes += data.byteLength ?? data.length;
    },
    async flush() {
      await Promise.all(pending);
    },
    get bytes() {
      return bytes;
    },
  };
}
