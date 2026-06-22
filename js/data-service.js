const DataService = (() => {
  const INTERVAL_FILES = {
    1: "1h",
    5: "1h",
    15: "1h",
    60: "1h",
    240: "1h",
    D: "1d",
    W: "1wk"
  };

  const cache = new Map();
  let manifestPromise = null;

  function fileInterval(uiInterval) {
    return INTERVAL_FILES[uiInterval] || "1d";
  }

  function historyPath(symbol, uiInterval) {
    return `data/history/${symbol}_${fileInterval(uiInterval)}.json`;
  }

  async function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch("data/manifest.json")
        .then((res) => {
          if (!res.ok) throw new Error("Manifest unavailable");
          return res.json();
        });
    }
    return manifestPromise;
  }

  async function loadBundledHistory(symbol, uiInterval) {
    const response = await fetch(historyPath(symbol, uiInterval));
    if (!response.ok) throw new Error(`No bundled data for ${symbol}`);
    return response.json();
  }

  async function loadHistory(symbol, uiInterval, { preferLive = true } = {}) {
    const key = `${symbol}_${fileInterval(uiInterval)}`;
    if (cache.has(key)) return cache.get(key);

    let bundled = null;
    try {
      bundled = await loadBundledHistory(symbol, uiInterval);
    } catch {
      bundled = null;
    }

    if (preferLive && window.YahooClient) {
      try {
        const live = await YahooClient.fetchChart(symbol, fileInterval(uiInterval));
        const payload = live.candles.length >= (bundled?.candles?.length || 0) * 0.9 ? live : mergePayload(live, bundled);
        cache.set(key, payload);
        return payload;
      } catch (error) {
        if (bundled) {
          bundled.sourceNote = `Bundled fallback (${error.message})`;
          cache.set(key, bundled);
          return bundled;
        }
        throw error;
      }
    }

    if (!bundled) throw new Error(`No historical data for ${symbol}`);
    cache.set(key, bundled);
    return bundled;
  }

  function mergePayload(live, bundled) {
    if (!bundled?.candles?.length) return live;
    const byTime = new Map(bundled.candles.map((c) => [String(c.time), c]));
    live.candles.forEach((c) => byTime.set(String(c.time), c));
    return {
      ...live,
      candles: [...byTime.values()].sort((a, b) => candleEpoch(a) - candleEpoch(b))
    };
  }

  function parseBoundary(value, endOfDay = false) {
    if (!value) return null;
    if (typeof value === "number") return value;
    const stamp = Date.parse(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
    return Number.isNaN(stamp) ? null : Math.floor(stamp / 1000);
  }

  function candleEpoch(candle) {
    if (typeof candle.time === "number") return candle.time;
    return Math.floor(Date.parse(`${candle.time}T00:00:00Z`) / 1000);
  }

  function filterByDateRange(candles, fromValue, toValue) {
    const from = parseBoundary(fromValue, false);
    const to = parseBoundary(toValue, true);
    return candles.filter((candle) => {
      const epoch = candleEpoch(candle);
      if (from != null && epoch < from) return false;
      if (to != null && epoch > to) return false;
      return true;
    });
  }

  function defaultRange(candles) {
    if (!candles.length) return { from: "", to: "" };
    const last = candles.at(-1).time;
    const toStr = typeof last === "number"
      ? new Date(last * 1000).toISOString().slice(0, 10)
      : last;
    const fromDate = new Date(`${toStr}T00:00:00Z`);
    fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toStr
    };
  }

  function formatVolume(value) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
  }

  function formatAsOf(candle) {
    if (!candle) return "";
    if (typeof candle.time === "number") {
      return new Date(candle.time * 1000).toISOString().slice(0, 10);
    }
    return candle.time;
  }

  function dailyChange(candles) {
    if (candles.length < 2) return { change: 0, pct: 0 };
    const last = candles.at(-1);
    const prev = candles.at(-2);
    const change = last.close - prev.close;
    const pct = (change / prev.close) * 100;
    return { change, pct };
  }

  function intervalLabel(uiInterval) {
    const map = { 1: "1m*", 5: "5m*", 15: "15m*", 60: "1h", 240: "4h*", D: "1D", W: "1W" };
    return map[uiInterval] || uiInterval;
  }

  function clearCache() {
    cache.clear();
  }

  return {
    loadManifest,
    loadHistory,
    filterByDateRange,
    defaultRange,
    formatVolume,
    formatAsOf,
    dailyChange,
    intervalLabel,
    clearCache,
    fileInterval
  };
})();