// pumpfun-sharpe-bot — entry for "Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins"
// (make.fun bounty u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532).
//
// Ranked by hourly Sharpe ratio on a 6-hour pump.fun forward replay, so the strategy
// chases steady, small, repeatable wins with tight risk control: two lanes — a 0.10 SOL
// momentum lane on proven runners, and a 0.01 SOL breadth lane on fresh launches that
//
// Run by the grader as `node main.ts` (Node 22 strips the types; no build, no install).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
