# pumpfun-sharpe-bot

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/Tokocrypto96/pumpfun-sharpe-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/Tokocrypto96/pumpfun-sharpe-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

Paper-trading bot for the [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) competition on [make.fun](https://make.fun).

The competition ranks entries by **hourly Sharpe ratio** on a 6-hour pump.fun forward replay — steady, controlled gains beat one lucky moonshot. This bot is built for exactly that.

## Strategy

Two lanes, max 5 open positions, paper trading only (`agent-fun/replay/v2`, Node 22, no dependencies):

- **Lane A — momentum (the edge).** A launch that already rose +8% or more, still has 5+ buyers and positive recent flow, entered at 0.10 SOL. Partial take-profit at +8%, full exit at +15%, hard stop at −6%, trailing stop once up +8%, max hold 90 slots. On the dev dataset this lane alone is net positive.
- **Lane B — breadth (the guardrail).** Fresh launches passing a strict rug filter (real liquidity, creator skin-in-the-game, no bundle, no dev sell, sane run-up, positive flow), entered at the 0.01 SOL minimum and exited within 12 slots. It exists to clear the 20-distinct-mints bar in a 6-hour window, where lane A alone would find only ~5 coins, while losing as little as possible.

One position slot is always reserved for lane A. Everything is deterministic: no clock, no randomness, no I/O, no network.

## Local test results (dev dataset, full 24h window)

Run with `node tools/sim.ts --kit <kit-dir>` (a local re-implementation of the replay's market model; the score that counts is the official grader):

| | net PnL | distinct mints | fills | max drawdown |
|---|---|---|---|---|
| Lane A only | +0.0029 SOL | 21 | 46 | 0.19% |
| Lane B only | −0.0785 SOL | 121 | 245 | 0.87% |
| **Both lanes** | **−0.0313 SOL** | **129** | **267** | **0.45%** |

Per 6-hour slice of the dev window the combined bot clears the 20-mint bar in every slice (22 / 30 / 45 / 32 mints), and one slice is net positive (+0.0087 SOL). The dev window is one small sample — the final window is a different 6 hours — so these numbers are a robustness check, not a forecast.

## Layout

- `main.ts` — entrypoint, run by the grader as `node main.ts`.
- `strategy.ts` — the strategy (both lanes, all parameters in `DEFAULT_PARAMS`).
- `vendor/makefun-bot.ts` — the kit's `agent-fun/replay/v2` bot shim (vendored SDK).
- `tools/sim.ts` — local simulator (loads the full dev dataset, all three parts).
- `tools/quarters.ts` — per-6-hour-slice report for the same simulator.

## License

MIT — see [LICENSE](LICENSE).
