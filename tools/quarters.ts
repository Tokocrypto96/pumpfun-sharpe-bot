// Quarter check: bucket traded mints + PnL by create-slot quarter of the dev window.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { simulate } from './sim.ts';
import { DEFAULT_PARAMS } from '../strategy.ts';

const kit = process.argv[2];
const args = process.argv.slice(3);
const get = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const params = { ...DEFAULT_PARAMS, ...JSON.parse(get('--params') ?? '{}') };
const manifest = JSON.parse(readFileSync(`${kit}/dataset/manifest.json`, 'utf8'));
const start = manifest.window.start_slot;
const end = manifest.window.end_slot;
const createSlot = new Map<string, number>();
for (const f of manifest.files) {
  const raw = gunzipSync(readFileSync(`${kit}/dataset/${f.path}`)).toString('utf8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const e = JSON.parse(line);
    if (e.event === 'CreateEvent') createSlot.set(e.mint, e.slot);
  }
}
const r = simulate(kit, params);
const q: { n: number; pnl: number }[] = [
  { n: 0, pnl: 0 },
  { n: 0, pnl: 0 },
  { n: 0, pnl: 0 },
  { n: 0, pnl: 0 },
];
for (const [mint, v] of r.perMint) {
  const s = createSlot.get(mint) ?? start;
  const i = Math.min(3, Math.floor(((s - start) / (end - start)) * 4));
  q[i]!.n++;
  q[i]!.pnl += Number(v);
}
q.forEach((x, i) => console.log(`Q${i + 1} (~6h): mints=${x.n} pnl=${(x.pnl / 1e9).toFixed(6)} SOL`));
console.log(`total mints=${r.mints} net=${(Number(r.net) / 1e9).toFixed(6)} fills=${r.fills} maxDD=${r.maxDD.toFixed(4)}`);
