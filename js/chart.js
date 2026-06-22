let MARKETS = [];

function minBacktestBars() {
  return DataService.minBacktestBars(state.interval);
}

const state = {
  active: null,
  chartType: "candles",
  interval: "D",
  indicators: true,
  candles: [],
  rawCandles: [],
  meta: null,
  range: { from: "", to: "" },
  backtestStart: null,
  suppressAutoBacktest: false,
  strategyReady: false,
  loading: false
};

let priceChart = null;
let volumeChart = null;
let candleSeries = null;
let lineSeries = null;
let areaSeries = null;
let volumeSeries = null;
let ma20Series = null;
let ema50Series = null;

function money(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const fixed = num.toFixed(2);
  const [whole, fraction] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function movingAverage(values, period) {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function chartTheme() {
  const light = document.querySelector(".app").dataset.theme === "light";
  return {
    layout: {
      background: { color: light ? "#ffffff" : "#131722" },
      textColor: light ? "#131722" : "#d1d4dc"
    },
    grid: {
      vertLines: { color: light ? "#e0e3eb" : "#363a45" },
      horzLines: { color: light ? "#e0e3eb" : "#363a45" }
    },
    rightPriceScale: { borderColor: light ? "#d1d4dc" : "#363a45" },
    timeScale: { borderColor: light ? "#d1d4dc" : "#363a45" }
  };
}

function initCharts() {
  if (!window.LightweightCharts) {
    throw new Error("Chart library failed to load. Check your network or ad blocker.");
  }

  const priceEl = document.getElementById("chartContainer");
  const volEl = document.getElementById("volumeContainer");
  const theme = chartTheme();
  const priceHeight = Math.max(priceEl.clientHeight, 200);
  const volHeight = Math.max(volEl.clientHeight, 80);

  priceChart = LightweightCharts.createChart(priceEl, {
    ...theme,
    width: Math.max(priceEl.clientWidth, 100),
    height: priceHeight,
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  volumeChart = LightweightCharts.createChart(volEl, {
    ...theme,
    width: Math.max(volEl.clientWidth, 100),
    height: volHeight,
    rightPriceScale: { scaleMargins: { top: 0.8, bottom: 0 } },
    timeScale: { visible: false }
  });

  candleSeries = priceChart.addCandlestickSeries({
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350"
  });

  lineSeries = priceChart.addLineSeries({ color: "#2962ff", lineWidth: 2, visible: false });
  areaSeries = priceChart.addAreaSeries({
    lineColor: "#2962ff",
    topColor: "rgba(41,98,255,0.35)",
    bottomColor: "rgba(41,98,255,0)",
    visible: false
  });

  ma20Series = priceChart.addLineSeries({ color: "#f5c85c", lineWidth: 1 });
  ema50Series = priceChart.addLineSeries({ color: "#2962ff", lineWidth: 1 });

  volumeSeries = volumeChart.addHistogramSeries({
    color: "#26a69a",
    priceFormat: { type: "volume" },
    priceScaleId: ""
  });

  priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) volumeChart.timeScale().setVisibleLogicalRange(range);
  });
}

function applyChartType() {
  const showCandles = state.chartType === "candles";
  candleSeries.applyOptions({ visible: showCandles });
  lineSeries.applyOptions({ visible: state.chartType === "line" });
  areaSeries.applyOptions({ visible: state.chartType === "area" });
}

function setStatus(message, isError = false) {
  const el = document.getElementById("dataStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function applyFilteredCandles() {
  state.candles = DataService.filterByDateRange(state.rawCandles, state.range.from, state.range.to);
  if (!state.candles.length) {
    setStatus("No bars in selected backtest range.", true);
    return;
  }
  renderSeries();
}

function renderSeries() {
  if (!candleSeries || !volumeSeries || !state.candles.length) return;

  const closes = state.candles.map((c) => c.close);
  const ma20 = movingAverage(closes, 20);
  const ema50 = movingAverage(closes, 50);

  candleSeries.setData(state.candles);
  lineSeries.setData(state.candles.map((c) => ({ time: c.time, value: c.close })));
  areaSeries.setData(state.candles.map((c) => ({ time: c.time, value: c.close })));
  volumeSeries.setData(state.candles.map((c) => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)"
  })));

  if (state.indicators) {
    ma20Series.setData(state.candles.map((c, i) => ma20[i] == null ? null : { time: c.time, value: ma20[i] }).filter(Boolean));
    ema50Series.setData(state.candles.map((c, i) => ema50[i] == null ? null : { time: c.time, value: ema50[i] }).filter(Boolean));
    document.getElementById("ma20Val").textContent = money(ma20.at(-1) || 0);
    document.getElementById("ema50Val").textContent = money(ema50.at(-1) || 0);
  } else {
    ma20Series.setData([]);
    ema50Series.setData([]);
  }

  applyChartType();
  if (state.backtestStart != null) {
    scrollChartToTime(state.backtestStart);
  } else {
    priceChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
  }
  updateQuoteUI();
  drawSpark();
  renderWatchlist();
  renderScreener();
  if (state.strategyReady && !state.suppressAutoBacktest) StrategyTester.update();
}

async function loadMarketData() {
  if (!state.active || state.loading) return;
  state.loading = true;
  setStatus("Loading historical data…");

  try {
    const payload = await DataService.loadHistory(state.active.symbol, state.interval);
    state.meta = payload;
    state.rawCandles = payload.candles;

    if (!state.range.from && !state.range.to) {
      state.range = DataService.defaultRange(state.rawCandles, state.interval);
      document.getElementById("rangeFrom").value = state.range.from;
      document.getElementById("rangeTo").value = state.range.to;
    }

    state.active.name = payload.name || state.active.name;
    state.active.exchange = payload.exchange || state.active.exchange;

    applyFilteredCandles();

    const latest = state.rawCandles.at(-1);
    const fetched = new Date(payload.fetchedAt).toLocaleDateString();
    const note = payload.sourceNote ? ` · ${payload.sourceNote}` : "";
    setStatus(
      `${payload.source} · ${DataService.intervalLabel(state.interval)} · latest ${DataService.formatAsOf(latest, state.interval)} · ${state.candles.length} bars in range${note}`
    );
    syncWatchlistQuote(state.active.symbol, latest);
  } catch (error) {
    setStatus(error.message || "Failed to load market data.", true);
  } finally {
    state.loading = false;
  }
}

function updateQuoteUI() {
  const latest = state.rawCandles.at(-1);
  if (!latest || !state.candles.length) return;

  const rangeFirst = state.candles[0];
  const rangeHigh = Math.max(...state.candles.map((c) => c.high));
  const rangeLow = Math.min(...state.candles.map((c) => c.low));
  const { pct } = DataService.dailyChange(state.rawCandles);

  document.getElementById("symbolTitle").textContent = state.active.symbol;
  document.getElementById("symbolSubtitle").textContent = `${state.active.name} · ${state.active.exchange}`;
  document.getElementById("detailsSymbol").textContent = state.active.symbol;
  document.getElementById("lastPrice").textContent = money(latest.close);
  document.getElementById("lastChange").textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  document.getElementById("lastChange").className = pct >= 0 ? "positive" : "negative";
  document.getElementById("asOfDate").textContent = DataService.isIntraday(state.interval)
    ? `As of ${DataService.formatAsOf(latest, state.interval)}`
    : `As of ${DataService.formatAsOf(latest, state.interval)} · prior close`;
  document.getElementById("statOpen").textContent = money(rangeFirst.open);
  document.getElementById("statHigh").textContent = money(rangeHigh);
  document.getElementById("statLow").textContent = money(rangeLow);
  document.getElementById("statVolume").textContent = DataService.formatVolume(latest.volume);
  document.getElementById("volVal").textContent = DataService.formatVolume(latest.volume);
  document.getElementById("limitPrice").value = latest.close.toFixed(2);
  document.title = `Sean Chart — ${state.active.symbol}`;
}

function syncWatchlistQuote(symbol, latest) {
  const market = MARKETS.find((m) => m.symbol === symbol);
  if (!market || !latest) return;
  market.price = latest.close;
  const { pct } = DataService.dailyChange(state.rawCandles);
  market.change = Number(pct.toFixed(2));
}

function renderScreener() {
  const table = document.getElementById("screenerTable");
  if (!table) return;
  const signals = ["MA cross", "Pullback", "Breakout", "RSI OS", "EMA cross"];
  const rows = MARKETS.slice(0, 8).map((m, i) => `
    <strong>${m.symbol}</strong>
    <strong>${money(m.price)}</strong>
    <strong class="${m.change >= 0 ? "positive" : "negative"}">${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%</strong>
    <strong>${m.volume || "—"}</strong>
    <strong>${signals[i % signals.length]}</strong>
  `).join("");
  table.innerHTML = `
    <span>Symbol</span><span>Last</span><span>Chg%</span><span>Volume</span><span>Signal</span>
    ${rows}
  `;
}

function renderWatchlist(filter = "") {
  const list = document.getElementById("watchlist");
  const visible = MARKETS.filter((m) =>
    `${m.symbol} ${m.name}`.toLowerCase().includes(filter.toLowerCase())
  );
  list.innerHTML = visible.map((m) => `
    <button class="watch-row ${state.active?.symbol === m.symbol ? "active" : ""}" type="button" data-symbol="${m.symbol}">
      <span><strong>${m.symbol}</strong><span>${m.name}</span></span>
      <span><strong>${money(m.price)}</strong><span class="${m.change >= 0 ? "positive" : "negative"}">${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%</span></span>
    </button>
  `).join("");
}

function drawSpark() {
  const canvas = document.getElementById("sparkCanvas");
  if (!canvas || !state.candles.length) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const closes = state.candles.slice(-80).map((c) => c.close);
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  const w = rect.width;
  const h = rect.height;
  const step = w / Math.max(1, closes.length - 1);
  const y = (v) => 10 + ((max - v) / (max - min)) * (h - 20);

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2962ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  closes.forEach((close, i) => {
    const x = i * step;
    if (i === 0) ctx.moveTo(x, y(close));
    else ctx.lineTo(x, y(close));
  });
  ctx.stroke();
}

function safeSetMarkers(markers) {
  if (!candleSeries) return;
  try {
    candleSeries.setMarkers(markers || []);
  } catch (error) {
    console.warn("Chart markers skipped:", error);
  }
}

function candleToDateValue(time) {
  return DataService.toRangeInput(time, state.interval);
}

function formatCandleLabel(time) {
  if (typeof time === "number") {
    return new Date(time * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }
  return new Date(`${time}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function showStrategyTester() {
  document.querySelectorAll(".bottom-tabs [data-panel]").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === "tester");
  });
  document.querySelectorAll(".panel-content").forEach((el) => {
    el.classList.toggle("active", el.dataset.panel === "tester");
  });
  StrategyTester?.selectTab?.("overview");
  StrategyTester?.onResize?.();
}

function updateBacktestStartLabel() {
  const el = document.getElementById("backtestStartLabel");
  if (!el) return;
  if (!state.backtestStart) {
    el.textContent = "";
    return;
  }
  el.textContent = `Start: ${formatCandleLabel(state.backtestStart)}`;
}

function updateRangeInputs() {
  const intraday = DataService.isIntraday(state.interval);
  const fromEl = document.getElementById("rangeFrom");
  const toEl = document.getElementById("rangeTo");
  const inputType = intraday ? "datetime-local" : "date";
  if (fromEl.type !== inputType) {
    fromEl.type = inputType;
    toEl.type = inputType;
    state.range = { from: "", to: "" };
  }
  const hint = document.getElementById("rangeHint");
  if (hint) hint.textContent = DataService.rangeHint(state.interval);
}

function setBacktestRange(from, to, startTime = null) {
  state.suppressAutoBacktest = true;
  state.range = { from, to };
  state.backtestStart = startTime;
  document.getElementById("rangeFrom").value = from;
  document.getElementById("rangeTo").value = to;
  updateBacktestStartLabel();
  applyFilteredCandles();
  state.suppressAutoBacktest = false;
}

function scrollChartToTime(time) {
  if (!priceChart || !state.candles.length) return;
  const anchor = DataService.findCandleIndex(state.candles, time);
  const span = Math.min(160, state.candles.length - anchor);
  const range = {
    from: Math.max(0, anchor - 3),
    to: Math.min(state.candles.length - 1, anchor + Math.max(span, 40))
  };
  priceChart.timeScale().setVisibleLogicalRange(range);
  volumeChart.timeScale().setVisibleLogicalRange(range);
}

function resolveBacktestStartIndex(random = false) {
  const raw = state.rawCandles;
  const minBars = minBacktestBars();
  if (raw.length < minBars + 5) return -1;

  const maxStart = raw.length - minBars - 1;
  if (random) return Math.floor(Math.random() * (maxStart + 1));

  const fromInput = document.getElementById("rangeFrom")?.value;
  if (fromInput) {
    const idx = DataService.findCandleIndex(raw, fromInput);
    return Math.min(idx, maxStart);
  }

  // Default: jump ~40% back in full history so we simulate from the past forward
  return Math.min(Math.floor(raw.length * 0.4), maxStart);
}

function prepareHistoricalBacktest({ random = false } = {}) {
  if (!state.rawCandles.length) {
    setStatus("Load chart data first.", true);
    return null;
  }

  const startIdx = resolveBacktestStartIndex(random);
  if (startIdx < 0) {
    setStatus("Not enough history to backtest.", true);
    return null;
  }

  const startCandle = state.rawCandles[startIdx];
  const endCandle = state.rawCandles.at(-1);
  const from = candleToDateValue(startCandle.time);
  const to = candleToDateValue(endCandle.time);

  setBacktestRange(from, to, startCandle.time);

  if (state.candles.length < minBacktestBars()) {
    setStatus("Backtest window too small — try a wider timeframe or daily bars.", true);
    return null;
  }

  return startCandle;
}

function flashButton(btn) {
  if (!btn) return;
  btn.classList.add("running");
  btn.disabled = true;
  window.setTimeout(() => {
    btn.classList.remove("running");
    btn.classList.add("success");
    btn.disabled = false;
    window.setTimeout(() => btn.classList.remove("success"), 700);
  }, 250);
}

function executeBacktest(triggerBtn = null, { random = false, keepRange = false } = {}) {
  if (!state.rawCandles.length) {
    setStatus("No chart data loaded yet.", true);
    return false;
  }

  if (!state.strategyReady) initStrategyTester();
  if (!state.strategyReady || typeof StrategyTester?.run !== "function") {
    setStatus("Strategy tester not ready — wait for data to load, then try again.", true);
    return false;
  }

  let startCandle = null;
  if (keepRange && state.candles.length >= minBacktestBars()) {
    startCandle = state.candles[0];
    state.backtestStart = startCandle.time;
    updateBacktestStartLabel();
    scrollChartToTime(startCandle.time);
  } else {
    startCandle = prepareHistoricalBacktest({ random });
    if (!startCandle) return false;
  }

  showStrategyTester();
  StrategyTester.selectTab("overview");

  const ok = StrategyTester.run({ force: true });
  if (ok) {
    flashButton(triggerBtn || document.getElementById("runBacktest") || document.getElementById("headerRunBacktest"));
    const startLabel = formatCandleLabel(startCandle.time);
    const endLabel = formatCandleLabel(state.candles.at(-1).time);
    setStatus(
      `Backtest from ${startLabel} → ${endLabel} · ${state.candles.length} bars · ${state.active.symbol}`
    );
  } else {
    setStatus("Backtest ran but produced no results — try a different strategy or range.", true);
  }
  return ok;
}

function randomBacktestStart(triggerBtn = null) {
  executeBacktest(triggerBtn, { random: true });
}

function bindEvents() {
  document.querySelectorAll(".bottom-tabs [data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel;
      document.querySelectorAll(".bottom-tabs [data-panel]").forEach((b) => {
        b.classList.toggle("active", b.dataset.panel === panel);
      });
      document.querySelectorAll(".panel-content").forEach((el) => {
        el.classList.toggle("active", el.dataset.panel === panel);
      });
      StrategyTester?.onResize?.();
    });
  });

  document.getElementById("strategyTester")?.addEventListener("click", (e) => {
    if (e.target.closest("#runBacktest")) {
      executeBacktest(e.target.closest("#runBacktest"));
      return;
    }
    const tabBtn = e.target.closest("[data-st-tab]");
    if (!tabBtn) return;
    StrategyTester?.selectTab?.(tabBtn.dataset.stTab);
  });

  document.getElementById("headerRunBacktest")?.addEventListener("click", (e) => {
    executeBacktest(e.currentTarget);
  });

  document.getElementById("randomStart")?.addEventListener("click", (e) => {
    randomBacktestStart(e.currentTarget);
  });

  document.getElementById("watchlist").addEventListener("click", (e) => {
    const row = e.target.closest(".watch-row");
    if (!row) return;
    state.active = MARKETS.find((m) => m.symbol === row.dataset.symbol) || state.active;
    document.getElementById("symbolSearch").value = state.active.symbol;
    state.range = { from: "", to: "" };
    loadMarketData();
  });

  document.getElementById("symbolSearch").addEventListener("change", (e) => {
    const hit = MARKETS.find((m) => m.symbol.toLowerCase() === e.target.value.toLowerCase());
    if (hit) {
      state.active = hit;
      state.range = { from: "", to: "" };
      loadMarketData();
    }
    renderWatchlist(e.target.value);
  });

  document.getElementById("symbolSearch").addEventListener("input", (e) => {
    renderWatchlist(e.target.value);
  });

  document.getElementById("chartTypes").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    state.chartType = btn.dataset.type;
    document.querySelectorAll("#chartTypes button").forEach((b) => b.classList.toggle("selected", b === btn));
    applyChartType();
  });

  document.getElementById("intervals").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-interval]");
    if (!btn) return;
    state.interval = btn.dataset.interval;
    document.querySelectorAll("#intervals button").forEach((b) => b.classList.toggle("selected", b === btn));
    state.range = { from: "", to: "" };
    updateRangeInputs();
    loadMarketData();
  });

  document.getElementById("applyRange").addEventListener("click", () => {
    const from = document.getElementById("rangeFrom").value;
    const to = document.getElementById("rangeTo").value;
    const startIdx = from ? DataService.findCandleIndex(state.rawCandles, from) : 0;
    const startTime = state.rawCandles[startIdx]?.time ?? null;
    setBacktestRange(from, to, startTime);
    executeBacktest(document.getElementById("applyRange"), { keepRange: true });
  });

  document.getElementById("resetRange").addEventListener("click", () => {
    state.backtestStart = null;
    const range = DataService.defaultRange(state.rawCandles, state.interval);
    setBacktestRange(range.from, range.to, null);
    updateBacktestStartLabel();
    safeSetMarkers([]);
  });

  document.getElementById("refreshData").addEventListener("click", async () => {
    DataService.clearCache();
    state.range = { from: "", to: "" };
    await loadMarketData();
  });

  document.getElementById("indicatorBtn").addEventListener("click", () => {
    state.indicators = !state.indicators;
    document.getElementById("indicatorBtn").classList.toggle("active", state.indicators);
    document.getElementById("indicatorRow").style.opacity = state.indicators ? "1" : "0.45";
    renderSeries();
  });

  document.getElementById("themeBtn").addEventListener("click", () => {
    const app = document.querySelector(".app");
    app.dataset.theme = app.dataset.theme === "dark" ? "light" : "dark";
    if (!priceChart || !volumeChart) return;
    const theme = chartTheme();
    priceChart.applyOptions(theme);
    volumeChart.applyOptions(theme);
  });

  document.querySelectorAll(".tool").forEach((tool) => {
    tool.addEventListener("click", () => {
      document.querySelectorAll(".tool").forEach((t) => t.classList.toggle("active", t === tool));
    });
  });

  document.querySelectorAll(".side-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".side-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  window.addEventListener("resize", () => {
    resizeCharts();
    drawSpark();
    StrategyTester?.onResize?.();
  });
}

function resizeCharts() {
  if (!priceChart || !volumeChart) return;
  const priceEl = document.getElementById("chartContainer");
  const volEl = document.getElementById("volumeContainer");
  priceChart.applyOptions({
    width: Math.max(priceEl.clientWidth, 100),
    height: Math.max(priceEl.clientHeight, 200)
  });
  volumeChart.applyOptions({
    width: Math.max(volEl.clientWidth, 100),
    height: Math.max(volEl.clientHeight, 80)
  });
}

function readSymbolFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get("symbol");
  if (!symbol) return;
  const hit = MARKETS.find((m) => m.symbol.toUpperCase() === symbol.toUpperCase());
  if (hit) {
    state.active = hit;
    document.getElementById("symbolSearch").value = hit.symbol;
  }
}

function initStrategyTester() {
  if (state.strategyReady || typeof StrategyTester === "undefined" || typeof StrategyEngine === "undefined") {
    return;
  }
  StrategyTester.init({
    getCandles: () => state.candles,
    getSymbol: () => state.active?.symbol || "",
    getBacktestStart: () => state.backtestStart,
    getMinBars: minBacktestBars,
    setMarkers: safeSetMarkers,
    formatMoney: money
  });
  state.strategyReady = true;
}

async function bootstrap() {
  bindEvents();
  initStrategyTester();

  try {
    if (window.lucide) window.lucide.createIcons();

    const manifest = await DataService.loadManifest();
    MARKETS = manifest.symbols || [];
    if (!MARKETS.length) throw new Error("No symbols in manifest.");
    state.active = MARKETS[0];

    document.querySelectorAll("#intervals button").forEach((b) => {
      b.classList.toggle("selected", b.dataset.interval === state.interval);
    });

    readSymbolFromQuery();
    renderWatchlist();
    updateRangeInputs();

    try {
      initCharts();
      initStrategyTester();
      await loadMarketData();
      resizeCharts();
      requestAnimationFrame(resizeCharts);
    } catch (error) {
      setStatus(error.message || "Chart failed to initialize.", true);
      console.error(error);
    }
  } catch (error) {
    setStatus(error.message || "Failed to start chart workspace.", true);
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
window.addEventListener("error", (event) => {
  if (!document.getElementById("dataStatus")?.classList.contains("error")) {
    setStatus(event.message || "Unexpected error — try refreshing.", true);
  }
});