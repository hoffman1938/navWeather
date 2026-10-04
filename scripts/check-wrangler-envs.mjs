// The three Worker environments of wrangler.toml stay in step (DEVELOPMENT_PLAN DP-2.2): the same bindings and
// limits everywhere — wrangler does not inherit them — and nothing shared between preview and production.
//   npm run check:envs        (also in CI)
import assert from 'node:assert/strict';
import { unstable_readConfig } from 'wrangler';

const read = (env) => unstable_readConfig({ config: 'wrangler.toml', env }, { hideWarnings: true });
const envs = { dev: read(undefined), preview: read('preview'), production: read('production') };

const shape = (c) => ({
  durableObjects: c.durable_objects.bindings.map((b) => `${b.name}:${b.class_name}`).sort(),
  limits: c.ratelimits.map((r) => `${r.name}:${r.simple.limit}/${r.simple.period}`).sort(),
  d1: c.d1_databases.map((d) => d.binding).sort(),
  r2: c.r2_buckets.map((b) => b.binding).sort(),
  vars: Object.keys(c.vars).sort(),
  migrations: c.migrations.map((m) => m.tag),
  observability: c.observability,
});

const dev = shape(envs.dev);
for (const name of ['preview', 'production']) assert.deepEqual(shape(envs[name]), dev, `${name} differs from dev`);

const own = (c) => [c.name, ...c.d1_databases.map((d) => `d1:${d.database_name}`), ...c.r2_buckets.map((b) => `r2:${b.bucket_name}`), ...c.ratelimits.map((r) => `rl:${r.namespace_id}`)];
const seen = new Map();
for (const [name, c] of Object.entries(envs)) {
  for (const id of own(c)) {
    assert.ok(!seen.has(id), `${id} is used by both ${seen.get(id)} and ${name}`);
    seen.set(id, name);
  }
}
assert.equal(envs.production.name, 'navweather');
assert.equal(envs.dev.observability.logs.invocation_logs, false, 'invocation logs would record share ids and coordinates');
console.log(`wrangler environments in step: ${Object.entries(envs).map(([n, c]) => `${n} → ${c.name}`).join(', ')}`);
