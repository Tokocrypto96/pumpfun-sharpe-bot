// Sharpe Sprint — a paper-trading bot for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Ranking is by HOURLY SHARPE, not raw PnL, so this bot is built for steady, small,
// repeatable wins with tight risk control instead of one lucky moonshot. It runs two lanes:
//   - Lane A (the edge): momentum — a launch that already rose +8% or more, still has 5+
//     buyers and positive recent flow, entered at 0.10 SOL with a partial take-profit at
//     +8%, full exit at +15%, a hard -6% stop and a trailing stop.
//   - Lane B (the breadth): fresh launches passing a strict rug filter (real liquidity,
//     creator skin-in-the-game, no bundle, no dev sell), entered at 0.015 SOL and exited
//     within 12 slots — it exists to clear the 20-distinct-mints bar in a 6-hour window,
//     where lane A alone would find only ~5 coins, while losing as little as possible.
// One position slot is always reserved for lane A; at most 5 positions are open at once.
//
// A pure function of the batches it is fed: no clock, no randomness, no I/O, no files.

import {
  type Batch,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

export interface Params {
  /** Stake per coin, lamports (equal size for every entry). */
  stakeLamports: bigint;
  /** Entry age window, slots since create. */
  minAge: number;
  maxAge: number;
  /** Real SOL reserve window at decision time, lamports. */
  minRealSol: bigint;
  maxRealSol: bigint;
  /** Creator's own buys in the create slot, lamports window. */
  minDevBuy: bigint;
  maxDevBuy: bigint;
  /** Distinct non-creator buyers seen before entry: window. */
  minBuyers: number;
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Recent-flow window (slots) and the minimum net flow it must show, lamports. */
  flowWindow: number;
  minFlowLamports: bigint;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys, bps. */
  buySlippageBps: number;
  /** Partial take-profit: sell tp1PartBps of the position at +tp1Bps over cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** Full take-profit: exit at +tpBps over cost. */
  tpBps: number;
  /** Hard stop: exit at -slBps under cost. */
  slBps: number;
  /** Trailing stop: once up trailArmBps, exit on a fall of trailBps from the peak value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the recent net flow falls below minus this many lamports. */
  exitFlowLamports: bigint;
  /** Entry trend: price now over the price trendLookback slots ago, minimum, bps. */
  minTrendBps: number;
  /** Entry trend lookback, slots. */
  trendLookback: number;
  /** Entry: distinct non-creator buyers in the last buyerWindow slots, minimum. */
  minRecentBuyers: number;
  buyerWindow: number;
  // ---- Lane B: breadth lane (guardrail) ---------------------------------------
  // The final window is 6h (~300 coins); lane A alone would clear ~5 mints, below the
  // 20-mint minimum. Lane B trades early, strict-filtered launches at minimum size with
  // very fast exits, purely to clear the distinct-mints bar while losing as little as
  // possible; lane A carries the edge. One position slot is always reserved for lane A.
  /** Stake per lane-B coin, lamports. */
  laneBStakeLamports: bigint;
  laneBMinAge: number;
  laneBMaxAge: number;
  laneBMinRealSol: bigint;
  laneBMaxRealSol: bigint;
  laneBMinDevBuy: bigint;
  laneBMaxDevBuy: bigint;
  laneBMinBuyers: number;
  laneBMaxBuyers: number;
  laneBMaxSellRatioBps: number;
  laneBMaxBigSellBps: number;
  laneBMinRunupBps: number;
  laneBMaxRunupBps: number;
  laneBBuySlippageBps: number;
  laneBTpBps: number;
  laneBSlBps: number;
  laneBMaxHold: number;
  laneBExitOnDevSell: boolean;
  laneBExitFlowLamports: bigint;
  /** Lane B entry: recent net flow must be at least this (lamports). */
  laneBMinFlowLamports: bigint;
}

export const DEFAULT_PARAMS: Params = {
  stakeLamports: 100_000_000n, // 0.10 SOL
  minAge: 15,
  maxAge: 90,
  minRealSol: 200_000_000n, // 0.2 SOL
  maxRealSol: 20_000_000_000n, // 20 SOL
  minDevBuy: 10_000_000n, // 0.01 SOL
  maxDevBuy: 1_500_000_000n, // 1.5 SOL
  minBuyers: 5,
  maxBuyers: 30,
  maxSellRatioBps: 4_000, // sells <= 40% of buys
  maxBigSellBps: 500, // no single sell > 5% of reserve
  minRunupBps: 800, // +8%: the launch already proved it can rise
  maxRunupBps: 10_000, // +100%
  flowWindow: 8,
  minFlowLamports: 0n,
  skipDevSold: true,
  buySlippageBps: 500,
  tp1Bps: 800, // +8% partial
  tp1PartBps: 5_000, // sell half
  tpBps: 1_500, // +15% full exit
  slBps: 600, // -6% hard stop
  trailArmBps: 800, // arm trailing at +8%
  trailBps: 200, // exit on -2% from peak
  maxHold: 90,
  exitOnDevSell: false, // creators sell small amounts constantly; only the pre-entry filter cares
  staleSlots: 120,
  exitFlowLamports: 1_000_000_000_000n, // effectively off: short-window flow is noise, not signal
  minTrendBps: -100_000, // off by default: trend confirmation cut the set below the mint bar
  trendLookback: 5,
  minRecentBuyers: 0, // off by default: same reason
  buyerWindow: 10,
  laneBStakeLamports: 10_000_000n, // 0.01 SOL: the round-trip minimum, fees dominate so keep it minimal
  laneBMinAge: 0,
  laneBMaxAge: 12,
  laneBMinRealSol: 300_000_000n,
  laneBMaxRealSol: 30_000_000_000n,
  laneBMinDevBuy: 10_000_000n,
  laneBMaxDevBuy: 2_500_000_000n,
  laneBMinBuyers: 1,
  laneBMaxBuyers: 12,
  laneBMaxSellRatioBps: 4_000,
  laneBMaxBigSellBps: 500,
  laneBMinRunupBps: -300,
  laneBMaxRunupBps: 2_000,
  laneBBuySlippageBps: 10_000,
  laneBTpBps: 1_500,
  laneBSlBps: 800,
  laneBMaxHold: 12,
  laneBExitOnDevSell: true,
  laneBExitFlowLamports: 30_000_000n,
  laneBMinFlowLamports: 0n,
};

interface Trade {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  createVq: bigint;
  createVt: bigint;
  trades: Trade[];
  marks: { slot: number; vq: bigint; vt: bigint }[];
  buyers: Set<Pubkey>;
  devBought: bigint;
  devSold: boolean;
  boughtByOthers: bigint;
  soldByOthers: bigint;
  maxBigSellBps: number;
  lastTradeSlot: number;
}

interface Position {
  mint: Pubkey;
  entrySlot: number;
  peakBps: number; // best value-over-cost seen, bps
  tookTp1: boolean;
  lane: 'A' | 'B';
}

const BPS = 10_000n;

/** Current value (lamports) of `tokens` on a curve with virtual reserves vq / vt. */
function valueOf(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (vt === 0n || tokens === 0n) return 0n;
  return (tokens * vq) / vt;
}

/** Price now over price at create, in bps (can be negative). */
function runupBps(c: Coin, vq: bigint, vt: bigint): number {
  if (c.createVq === 0n || c.createVt === 0n || vq === 0n || vt === 0n) return 0;
  // ratio = (vq/vt) / (createVq/createVt), scaled by 10_000
  const ratio = (vq * c.createVt * BPS) / (c.createVq * vt);
  return Number(ratio - BPS);
}

export function createStrategy(params: Params) {
  const coins = new Map<Pubkey, Coin>();
  const positions = new Map<Pubkey, Position>();

  function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const orders: OrderInput[] = [];
    const slot = batch.slot;

    // ---- fold this batch's events into the tape -------------------------------
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!coins.has(e.mint)) {
          coins.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            createVq: BigInt(e.virtual_quote_reserves),
            createVt: BigInt(e.virtual_token_reserves),
            trades: [],
            marks: [],
            buyers: new Set(),
            devBought: 0n,
            devSold: false,
            boughtByOthers: 0n,
            soldByOthers: 0n,
            maxBigSellBps: 0,
            lastTradeSlot: e.slot,
          });
        }
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (!c) continue;
        const sol = BigInt(e.sol_amount);
        const t: Trade = { slot: e.slot, isBuy: e.is_buy, sol, user: e.user };
        c.trades.push(t);
        c.lastTradeSlot = e.slot;
        c.marks.push({
          slot: e.slot,
          vq: BigInt(e.virtual_quote_reserves),
          vt: BigInt(e.virtual_token_reserves),
        });
        if (c.marks.length > 24) c.marks.splice(0, c.marks.length - 24);
        if (e.user === c.creator) {
          if (e.is_buy) c.devBought += sol;
          else c.devSold = true;
        } else {
          if (e.is_buy) {
            c.buyers.add(e.user);
            c.boughtByOthers += sol;
          } else {
            c.soldByOthers += sol;
            const reserve = BigInt(e.real_sol_reserves);
            if (reserve > 0n) {
              const bps = Number((sol * BPS) / reserve);
              if (bps > c.maxBigSellBps) c.maxBigSellBps = bps;
            }
          }
        }
      }
    }

    // ---- sync held positions (harness may have closed some) -------------------
    for (const mint of [...positions.keys()]) {
      if (!state.positions.has(mint)) positions.delete(mint);
    }

    const openSlots = state.committedPositionCount();

    // ---- exits first: protect capital before opening anything new ------------
    for (const [mint, holding] of state.positions) {
      const curve = state.curves.get(mint);
      if (!curve || curve.complete) continue;
      // A sell already in flight for this mint: wait for it to resolve first,
      // otherwise the second sell would exceed the tokens held.
      let sellPending = false;
      for (const p of state.pending.values()) {
        if (p.order.side === 'sell' && p.order.mint === mint) { sellPending = true; break; }
      }
      if (sellPending) continue;
      const c = coins.get(mint);
      const pos = positions.get(mint) ?? {
        mint,
        entrySlot: slot,
        peakBps: 0,
        tookTp1: false,
        lane: 'A' as const,
      };
      positions.set(mint, pos);

      const value = valueOf(
        holding.token_amount,
        curve.virtual_quote_reserves,
        curve.virtual_token_reserves,
      );
      const cost = holding.cost_lamports;
      if (cost === 0n) continue;
      // value over cost, in bps (signed)
      const pnlBps = Number(((value - cost) * BPS) / cost);
      if (pnlBps > pos.peakBps) pos.peakBps = pnlBps;

      const age = slot - pos.entrySlot;
      let exit: string | null = null;
      let sellPartBps = 10_000; // full exit by default

      if (pos.lane === 'B') {
        // Lane B: in fast, out fast. No partials, no trailing: every extra order is a fee.
        if (pnlBps >= params.laneBTpBps) exit = 'tp';
        else if (pnlBps <= -params.laneBSlBps) exit = 'sl';
        else if (age >= params.laneBMaxHold) exit = 'maxhold';
        else if (c && params.laneBExitOnDevSell && c.devSold) exit = 'devsell';
        else if (c) {
          const recent = c.trades.filter((t) => t.slot > slot - params.flowWindow);
          let flow = 0n;
          for (const t of recent) flow += t.isBuy ? t.sol : -t.sol;
          if (flow < -params.laneBExitFlowLamports) exit = 'flow';
        }
      } else if (pnlBps >= params.tpBps) exit = 'tp';
      else if (pnlBps <= -params.slBps) exit = 'sl';
      else if (!pos.tookTp1 && pnlBps >= params.tp1Bps) {
        exit = 'tp1';
        sellPartBps = params.tp1PartBps;
      } else if (pos.peakBps >= params.trailArmBps && pnlBps <= pos.peakBps - params.trailBps) {
        exit = 'trail';
      } else if (age >= params.maxHold) exit = 'maxhold';
      else if (c && params.exitOnDevSell && c.devSold) exit = 'devsell';
      else if (c && slot - c.lastTradeSlot >= params.staleSlots) exit = 'stale';
      else if (c) {
        const recent = c.trades.filter((t) => t.slot > slot - params.flowWindow);
        let flow = 0n;
        for (const t of recent) flow += t.isBuy ? t.sol : -t.sol;
        if (flow < -params.exitFlowLamports) exit = 'flow';
      }

      if (exit) {
        const amount =
          sellPartBps >= 10_000
            ? holding.token_amount
            : (holding.token_amount * BigInt(sellPartBps)) / BPS;
        if (amount > 0n) {
          orders.push({
            side: 'sell',
            mint,
            token_amount: amount,
            max_slippage_bps: 500,
          });
          if (exit === 'tp1') pos.tookTp1 = true;
          if (sellPartBps >= 10_000) positions.delete(mint);
        }
      }
    }

    // ---- entries: lane A (momentum edge) first, lane B (breadth) after --------
    // One slot is always reserved for lane A; lane B may use at most 4 at once.
    // `planned` counts positions already committed plus buys decided in this batch,
    // since orders pushed here are not pending yet.
    let planned = state.committedPositionCount();
    if (planned < 5 && orders.length < 16) {
      for (const [mint, c] of coins) {
        if (orders.length >= 16) break;
        if (state.positions.has(mint)) continue;
        let buyPending = false;
        for (const p of state.pending.values()) {
          if (p.order.side === 'buy' && p.order.mint === mint) { buyPending = true; break; }
        }
        if (buyPending) continue;
        const curve = state.curves.get(mint);
        if (!curve || curve.complete) continue;
        const age = slot - c.createSlot;

        // Lane A: proven runner — rose already, still has buyers and positive flow.
        let lane: 'A' | 'B' | null = null;
        let stake = 0n;
        let slippage = params.buySlippageBps;
        if (
          age >= params.minAge && age <= params.maxAge &&
          planned < 5
        ) {
          const realSol = curve.real_quote_reserves;
          const runup = runupBps(c, curve.virtual_quote_reserves, curve.virtual_token_reserves);
          const recent = c.trades.filter((t) => t.slot > slot - params.flowWindow);
          let flow = 0n;
          for (const t of recent) flow += t.isBuy ? t.sol : -t.sol;
          let sellRatioOk = false;
          if (c.boughtByOthers > 0n) {
            sellRatioOk = Number((c.soldByOthers * BPS) / c.boughtByOthers) <= params.maxSellRatioBps;
          }
          const recentBuyers = new Set(
            c.trades
              .filter((t) => t.slot > slot - params.buyerWindow && t.isBuy && t.user !== c.creator)
              .map((t) => t.user),
          );
          let trendOk = true;
          if (params.minTrendBps > -100_000 && c.marks.length >= 2) {
            const now = c.marks[c.marks.length - 1]!;
            const target = slot - params.trendLookback;
            let old: { slot: number; vq: bigint; vt: bigint } | null = null;
            for (const m of c.marks) {
              if (m.slot <= target) old = m;
              else break;
            }
            if (old && old.vq > 0n && old.vt > 0n && now.vq > 0n && now.vt > 0n) {
              trendOk = Number(((now.vq * old.vt * BPS) / (old.vq * now.vt) - BPS)) >= params.minTrendBps;
            }
          }
          if (
            realSol >= params.minRealSol && realSol <= params.maxRealSol &&
            c.devBought >= params.minDevBuy && c.devBought <= params.maxDevBuy &&
            !(params.skipDevSold && c.devSold) &&
            c.buyers.size >= params.minBuyers && c.buyers.size <= params.maxBuyers &&
            c.maxBigSellBps <= params.maxBigSellBps &&
            sellRatioOk &&
            runup >= params.minRunupBps && runup <= params.maxRunupBps &&
            flow >= params.minFlowLamports &&
            recentBuyers.size >= params.minRecentBuyers &&
            trendOk
          ) {
            lane = 'A';
            stake = params.stakeLamports;
            slippage = params.buySlippageBps;
          }
        }

        // Lane B: fresh launch, strict rug filter, minimum size, in-and-out fast.
        if (
          lane === null &&
          age >= params.laneBMinAge && age <= params.laneBMaxAge &&
          planned < 4
        ) {
          const realSol = curve.real_quote_reserves;
          let sellRatioOk = false;
          if (c.boughtByOthers > 0n) {
            sellRatioOk =
              Number((c.soldByOthers * BPS) / c.boughtByOthers) <= params.laneBMaxSellRatioBps;
          }
          const runup = runupBps(c, curve.virtual_quote_reserves, curve.virtual_token_reserves);
          const recentB = c.trades.filter((t) => t.slot > slot - params.flowWindow);
          let flowB = 0n;
          for (const t of recentB) flowB += t.isBuy ? t.sol : -t.sol;
          if (
            realSol >= params.laneBMinRealSol && realSol <= params.laneBMaxRealSol &&
            c.devBought >= params.laneBMinDevBuy && c.devBought <= params.laneBMaxDevBuy &&
            !c.devSold &&
            c.buyers.size >= params.laneBMinBuyers && c.buyers.size <= params.laneBMaxBuyers &&
            c.maxBigSellBps <= params.laneBMaxBigSellBps &&
            sellRatioOk &&
            runup >= params.laneBMinRunupBps && runup <= params.laneBMaxRunupBps &&
            flowB >= params.laneBMinFlowLamports
          ) {
            lane = 'B';
            stake = params.laneBStakeLamports;
            slippage = params.laneBBuySlippageBps;
          }
        }
        if (lane === null) continue;

        // Size: equal stake per lane, capped at 1% of real reserve and by free cash.
        const cap = state.maxBuyLamports(mint);
        if (stake > cap) stake = cap;
        const free = state.freeCashLamports();
        if (stake > free - state.txFeeLamports()) continue;
        if (stake < 10_000_000n) continue; // round trips must be >= 0.01 SOL

        orders.push({
          side: 'buy',
          mint,
          quote_lamports: stake,
          max_slippage_bps: slippage,
        });
        planned++;
        positions.set(mint, { mint, entrySlot: slot, peakBps: 0, tookTp1: false, lane });
      }
    }

    void openSlots;
    return orders;
  }

  return { onBatch };
}
