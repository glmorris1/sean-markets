const YahooClient = (() => {
  const SYMBOL_MAP = {
    BTCUSD: "BTC-USD",
    ETHUSD: "ETH-USD"
  };

  const INTERVAL_CONFIG = {
    "1d": { interval: "1d", range: "5y" },
    "1h": { interval: "1h", range: "2y" },
    "1wk": { interval: "1wk", range: "10y" }
  };

  const PROXY = "https://api.allorigins.win/raw?url=";

  function yahooSymbol(symbol) {
    return SYMBOL_MAP[symbol] || symbol;
  }

  function barTime(timestamp, interval) {
    const isIntraday = interval === "1h";
    return isIntraday ? timestamp : new Date(timestamp * 1000).toISOString().slice(0, 10);
  }

  async function fetchChart(symbol, fileInterval) {
    const cfg = INTERVAL_CONFIG[fileInterval] || INTERVAL_CONFIG["1d"];
    const target = yahooSymbol(symbol);
    const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(target)}?interval=${cfg.interval}&range=${cfg.range}`;
    const response = await fetch(`${PROXY}${encodeURIComponent(endpoint)}`);
    if (!response.ok) throw new Error(`Yahoo Finance request failed (${response.status})`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error("Yahoo Finance returned no chart data");

    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp || [];
    const candles = [];

    timestamps.forEach((ts, index) => {
      const open = quote.open[index];
      const high = quote.high[index];
      const low = quote.low[index];
      const close = quote.close[index];
      const volume = quote.volume[index];
      if ([open, high, low, close].some((v) => v == null)) return;
      candles.push({
        time: barTime(ts, cfg.interval),
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        close: Number(close.toFixed(4)),
        volume: Number(volume || 0)
      });
    });

    if (!candles.length) throw new Error("Yahoo Finance returned no candles");

    return {
      symbol: symbol.toUpperCase(),
      name: result.meta?.longName || result.meta?.shortName || symbol,
      exchange: result.meta?.exchangeName || result.meta?.fullExchangeName || "NASDAQ",
      interval: fileInterval,
      source: "Yahoo Finance",
      fetchedAt: new Date().toISOString(),
      candles
    };
  }

  return { fetchChart, yahooSymbol };
})();