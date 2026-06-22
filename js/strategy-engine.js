const StrategyEngine = (() => {
  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      const slice = values.slice(i - period + 1, i + 1);
      return slice.reduce((sum, v) => sum + v, 0) / period;
    });
  }

  function ema(values, period) {
    const out = [];
    const k = 2 / (period + 1);
    values.forEach((value, i) => {
      if (i === 0) {
        out.push(value);
        return;
      }
      out.push(value * k + out[i - 1] * (1 - k));
    });
    return out.map((v, i) => (i < period - 1 ? null : v));
  }

  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gain += diff;
      else loss -= diff;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i += 1) {
      const diff = values[i] - values[i - 1];
      const up = Math.max(diff, 0);
      const down = Math.max(-diff, 0);
      avgGain = (avgGain * (period - 1) + up) / period;
      avgLoss = (avgLoss * (period - 1) + down) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  const STRATEGIES = {
    ma_cross: {
      id: "ma_cross",
      name: "MA Crossover",
      description: "Buy when fast MA crosses above slow MA; sell on cross below.",
      defaults: { fast: 10, slow: 30 },
      fields: [
        { key: "fast", label: "Fast MA", type: "number", min: 2, max: 100 },
        { key: "slow", label: "Slow MA", type: "number", min: 5, max: 200 }
      ],
      signals(candles, params) {
        const closes = candles.map((c) => c.close);
        const fast = sma(closes, Number(params.fast));
        const slow = sma(closes, Number(params.slow));
        return crossSignals(candles, fast, slow);
      }
    },
    ema_cross: {
      id: "ema_cross",
      name: "EMA Crossover",
      description: "Exponential moving average crossover system.",
      defaults: { fast: 12, slow: 26 },
      fields: [
        { key: "fast", label: "Fast EMA", type: "number", min: 2, max: 100 },
        { key: "slow", label: "Slow EMA", type: "number", min: 5, max: 200 }
      ],
      signals(candles, params) {
        const closes = candles.map((c) => c.close);
        const fast = ema(closes, Number(params.fast));
        const slow = ema(closes, Number(params.slow));
        return crossSignals(candles, fast, slow);
      }
    },
    rsi_reversal: {
      id: "rsi_reversal",
      name: "RSI Reversal",
      description: "Buy oversold, sell overbought using RSI.",
      defaults: { period: 14, oversold: 30, overbought: 70 },
      fields: [
        { key: "period", label: "RSI Period", type: "number", min: 2, max: 50 },
        { key: "oversold", label: "Oversold", type: "number", min: 5, max: 45 },
        { key: "overbought", label: "Overbought", type: "number", min: 55, max: 95 }
      ],
      signals(candles, params) {
        const closes = candles.map((c) => c.close);
        const values = rsi(closes, Number(params.period));
        const signals = [];
        for (let i = 1; i < candles.length; i += 1) {
          if (values[i] == null || values[i - 1] == null) continue;
          if (values[i - 1] >= params.oversold && values[i] < params.oversold) {
            signals.push({ index: i, side: "buy", label: "RSI OS" });
          }
          if (values[i - 1] <= params.overbought && values[i] > params.overbought) {
            signals.push({ index: i, side: "sell", label: "RSI OB" });
          }
        }
        return signals;
      }
    }
  };

  function crossSignals(candles, fast, slow) {
    const signals = [];
    for (let i = 1; i < candles.length; i += 1) {
      if (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) continue;
      const prev = fast[i - 1] - slow[i - 1];
      const curr = fast[i] - slow[i];
      if (prev <= 0 && curr > 0) signals.push({ index: i, side: "buy", label: "Long" });
      if (prev >= 0 && curr < 0) signals.push({ index: i, side: "sell", label: "Exit" });
    }
    return signals;
  }

  function fillPrice(side, price, slippagePct) {
    const slip = price * (slippagePct / 100);
    return side === "buy" ? price + slip : price - slip;
  }

  function runBacktest(candles, strategyId, params, settings) {
    const strategy = STRATEGIES[strategyId] || STRATEGIES.ma_cross;
    const signals = strategy.signals(candles, { ...strategy.defaults, ...params });
    const initialCapital = Number(settings.initialCapital) || 10000;
    const commission = Number(settings.commission) || 0;
    const slippagePct = Number(settings.slippagePct) || 0.05;
    const qtyMode = settings.qtyMode || "fixed";
    const fixedQty = Number(settings.fixedQty) || 10;
    const equityPct = Number(settings.equityPct) || 95;

    let cash = initialCapital;
    let shares = 0;
    let entryPrice = 0;
    let entryTime = null;
    let entrySignal = null;
    const trades = [];
    const equityCurve = [{ time: candles[0]?.time, equity: initialCapital }];

    const closePosition = (index, side, signalLabel) => {
      if (shares <= 0) return;
      const candle = candles[index];
      const price = fillPrice("sell", candle.close, slippagePct);
      const proceeds = shares * price - commission;
      const costBasis = shares * entryPrice;
      const pl = proceeds - costBasis;
      cash += proceeds;
      trades.push({
        id: trades.length + 1,
        side: "long",
        entryTime: entryTime,
        exitTime: candle.time,
        entryPrice,
        exitPrice: price,
        qty: shares,
        signal: entrySignal,
        exitSignal: signalLabel,
        profit: pl,
        profitPct: (pl / costBasis) * 100,
        cumulative: cash - initialCapital
      });
      shares = 0;
      entryPrice = 0;
      entryTime = null;
      entrySignal = null;
    };

    const openPosition = (index, signalLabel) => {
      const candle = candles[index];
      const price = fillPrice("buy", candle.close, slippagePct);
      let qty = fixedQty;
      if (qtyMode === "equity") {
        qty = Math.floor((cash * (equityPct / 100)) / price);
      }
      if (qty <= 0 || cash < qty * price + commission) return;
      cash -= qty * price + commission;
      shares = qty;
      entryPrice = price;
      entryTime = candle.time;
      entrySignal = signalLabel;
    };

    signals.forEach((signal) => {
      if (signal.side === "buy") {
        if (shares === 0) openPosition(signal.index, signal.label);
      } else if (shares > 0) {
        closePosition(signal.index, signal.side, signal.label);
      }
    });

    candles.forEach((candle, index) => {
      const equity = cash + shares * candle.close;
      equityCurve.push({ time: candle.time, equity });
      if (index === candles.length - 1 && shares > 0) {
        closePosition(index, "sell", "Close at end");
      }
    });

    const finalEquity = cash;
    const metrics = computeMetrics(trades, equityCurve, initialCapital, finalEquity);
    const markers = buildMarkers(trades);

    return {
      strategy: strategy.name,
      trades,
      equityCurve,
      metrics,
      markers,
      signalCount: signals.length
    };
  }

  function computeMetrics(trades, equityCurve, initialCapital, finalEquity) {
    const netProfit = finalEquity - initialCapital;
    const netProfitPct = (netProfit / initialCapital) * 100;
    const winners = trades.filter((t) => t.profit > 0);
    const losers = trades.filter((t) => t.profit <= 0);
    const grossProfit = winners.reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.profit, 0));
    const winRate = trades.length ? (winners.length / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const avgTrade = trades.length ? trades.reduce((s, t) => s + t.profit, 0) / trades.length : 0;
    const largestWin = winners.length ? Math.max(...winners.map((t) => t.profit)) : 0;
    const largestLoss = losers.length ? Math.min(...losers.map((t) => t.profit)) : 0;

    let peak = initialCapital;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    equityCurve.forEach((point) => {
      if (point.equity > peak) peak = point.equity;
      const dd = peak - point.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    });

    const returns = [];
    for (let i = 1; i < equityCurve.length; i += 1) {
      const prev = equityCurve[i - 1].equity;
      const curr = equityCurve[i].equity;
      if (prev > 0) returns.push((curr - prev) / prev);
    }
    const mean = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const variance = returns.length
      ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
      : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    return {
      netProfit,
      netProfitPct,
      totalTrades: trades.length,
      winRate,
      profitFactor,
      maxDrawdown,
      maxDrawdownPct,
      avgTrade,
      largestWin,
      largestLoss,
      grossProfit,
      grossLoss,
      sharpe,
      finalEquity
    };
  }

  function buildMarkers(trades) {
    const markers = [];
    trades.forEach((trade) => {
      markers.push({
        time: trade.entryTime,
        position: "belowBar",
        color: "#26a69a",
        shape: "arrowUp",
        text: "Buy"
      });
      markers.push({
        time: trade.exitTime,
        position: "aboveBar",
        color: "#ef5350",
        shape: "arrowDown",
        text: "Sell"
      });
    });
    return markers.sort((a, b) => {
      const ta = typeof a.time === "number" ? a.time : Date.parse(`${a.time}T00:00:00Z`) / 1000;
      const tb = typeof b.time === "number" ? b.time : Date.parse(`${b.time}T00:00:00Z`) / 1000;
      return ta - tb;
    });
  }

  return { STRATEGIES, runBacktest };
})();

window.StrategyEngine = StrategyEngine;