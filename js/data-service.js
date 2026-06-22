const DataService = (() => {
  const INTERVALS = {
    2: { file: "2m", yahoo: "2m", range: "5d", label: "2m", intraday: true, minBars: 30 },
    5: { file: "5m", yahoo: "5m", range: "5d", label: "5m", intraday: true, minBars: 40 },
    15: { file: "15m", yahoo: "15m", range: "5d", label: "15m", intraday: true, minBars: 50 },
    60: { file: "1h", yahoo: "1h", range: "2y", label: "1h", intraday: true, minBars: 60 },
    D: { file: "1d", yahoo: "1d", range: "5y", label: "1D", intraday: false, minBars: 60 },
    W: { file: "1wk", yahoo: "1wk", range: "10y", label: "1W", intraday: false, minBars: 60 }
  };

  const cache = new Map();
  let manifestPromise = null;

  function getConfig(uiInterval) {
    return INTERVALS[uiInterval] || INTERVALS.D;
  }

  function fileInterval(uiInterval) {
    return getConfig(uiInterval).file;
  }

  function isIntraday(uiInterval) {
    return getConfig(uiInterval).intraday;
  }

  function minBacktestBars(uiInterval) {
    return getConfig(uiInterval).minBars;
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
    const key = `${symbol}_${uiInterval}`;
    if (cache.has(key)) return cache.get(key);

    let bundled = null;
    try {
      bundled = await loadBundledHistory(symbol, uiInterval);
    } catch {
      bundled = null;
    }

    if (preferLive && window.YahooClient) {
      try {
        const live = await YahooClient.fetchChart(symbol, uiInterval);
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
    const hasTime = String(value).includes("T");
    const stamp = hasTime
      ? Date.parse(value)
      : Date.parse(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
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

  function toRangeInput(time, uiInterval) {
    if (typeof time === "number") {
      if (isIntraday(uiInterval)) {
        const d = new Date(time * 1000);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      return new Date(time * 1000).toISOString().slice(0, 10);
    }
    return time;
  }

  function findCandleIndex(candles, time) {
    const target = String(time);
    let idx = candles.findIndex((c) => String(c.time) === target);
    if (idx >= 0) return idx;
    const epoch = typeof time === "number" ? time : Math.floor(Date.parse(`${time}T12:00:00`) / 1000);
    idx = candles.findIndex((c) => candleEpoch(c) >= epoch);
    return idx >= 0 ? idx : candles.length - 1;
  }

  function defaultRange(candles, uiInterval = "D") {
    if (!candles.length) return { from: "", to: "" };
    const last = candles.at(-1).time;
    const cfg = getConfig(uiInterval);

    if (cfg.intraday) {
      const lookbackBars = { 2: 390, 5: 234, 15: 156, 60: 480 }[uiInterval] || 240;
      const fromIdx = Math.max(0, candles.length - lookbackBars);
      return {
        from: toRangeInput(candles[fromIdx].time, uiInterval),
        to: toRangeInput(last, uiInterval)
      };
    }

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

  function formatAsOf(candle, uiInterval = "D") {
    if (!candle) return "";
    if (typeof candle.time === "number") {
      const d = new Date(candle.time * 1000);
      if (isIntraday(uiInterval)) {
        return d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
      }
      return d.toISOString().slice(0, 10);
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
    return getConfig(uiInterval).label;
  }

  function rangeHint(uiInterval) {
    const cfg = getConfig(uiInterval);
    if (uiInterval === "2") return "2m bars · up to 5 days history (Yahoo max)";
    if (cfg.intraday) return `${cfg.label} bars · ${cfg.range} history`;
    return `${cfg.label} bars · multi-year history`;
  }

  function clearCache() {
    cache.clear();
  }

  return {
    INTERVALS,
    getConfig,
    loadManifest,
    loadHistory,
    filterByDateRange,
    defaultRange,
    toRangeInput,
    formatVolume,
    formatAsOf,
    dailyChange,
    intervalLabel,
    rangeHint,
    isIntraday,
    minBacktestBars,
    clearCache,
    fileInterval,
    findCandleIndex,
    candleEpoch
  };
})();

window.DataService = DataService;