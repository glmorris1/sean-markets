let MARKETS = [];

const state = {
  active: null,
  chartType: "candles",
  interval: "D",
  indicators: true,
  candles: [],
  rawCandles: [],
  meta: null,
  range: { from: "", to: "" },
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
  return value > 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value.toFixed(2);
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
  const priceEl = document.getElementById("chartContainer");
  const volEl = document.getElementById("volumeContainer");
  const theme = chartTheme();

  priceChart = LightweightCharts.createChart(priceEl, {
    ...theme,
    width: priceEl.clientWidth,
    height: priceEl.clientHeight,
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  volumeChart = LightweightCharts.createChart(volEl, {
    ...theme,
    width: volEl.clientWidth,
    height: volEl.clientHeight,
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
  priceChart.timeScale().fitContent();
  volumeChart.timeScale().fitContent();
  updateQuoteUI();
  drawSpark();
  renderWatchlist();
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
      state.range = DataService.defaultRange(state.rawCandles);
      document.getElementById("rangeFrom").value = state.range.from;
      document.getElementById("rangeTo").value = state.range.to;
    }

    state.active.name = payload.name || state.active.name;
    state.active.exchange = payload.exchange || state.active.exchange;

    applyFilteredCandles();

    const fetched = new Date(payload.fetchedAt).toLocaleDateString();
    const fallback = DataService.usesHourlyFallback(state.interval) ? " (hourly fallback)" : "";
    setStatus(
      `${payload.source} · ${DataService.intervalLabel(state.interval)}${fallback} · ${state.candles.length} bars · updated ${fetched}`
    );
  } catch (error) {
    setStatus(error.message || "Failed to load market data.", true);
  } finally {
    state.loading = false;
  }
}

function updateQuoteUI() {
  if (!state.candles.length) return;
  const first = state.candles[0];
  const high = Math.max(...state.candles.map((c) => c.high));
  const low = Math.min(...state.candles.map((c) => c.low));
  const last = state.candles.at(-1);
  const change = ((last.close - first.open) / first.open) * 100;

  document.getElementById("symbolTitle").textContent = state.active.symbol;
  document.getElementById("symbolSubtitle").textContent = `${state.active.name} · ${state.active.exchange}`;
  document.getElementById("detailsSymbol").textContent = state.active.symbol;
  document.getElementById("lastPrice").textContent = money(last.close);
  document.getElementById("lastChange").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  document.getElementById("lastChange").className = change >= 0 ? "positive" : "negative";
  document.getElementById("statOpen").textContent = money(first.open);
  document.getElementById("statHigh").textContent = money(high);
  document.getElementById("statLow").textContent = money(low);
  document.getElementById("statVolume").textContent = DataService.formatVolume(last.volume);
  document.getElementById("volVal").textContent = DataService.formatVolume(last.volume);
  document.getElementById("limitPrice").value = last.close.toFixed(2);
  document.title = `Sean Chart — ${state.active.symbol}`;
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

function bindEvents() {
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
    loadMarketData();
  });

  document.getElementById("applyRange").addEventListener("click", () => {
    state.range.from = document.getElementById("rangeFrom").value;
    state.range.to = document.getElementById("rangeTo").value;
    applyFilteredCandles();
  });

  document.getElementById("resetRange").addEventListener("click", () => {
    state.range = DataService.defaultRange(state.rawCandles);
    document.getElementById("rangeFrom").value = state.range.from;
    document.getElementById("rangeTo").value = state.range.to;
    applyFilteredCandles();
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
    const priceEl = document.getElementById("chartContainer");
    const volEl = document.getElementById("volumeContainer");
    priceChart.applyOptions({ width: priceEl.clientWidth, height: priceEl.clientHeight });
    volumeChart.applyOptions({ width: volEl.clientWidth, height: volEl.clientHeight });
    drawSpark();
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

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) window.lucide.createIcons();

  const manifest = await DataService.loadManifest();
  MARKETS = manifest.symbols;
  state.active = MARKETS[0];

  document.querySelectorAll("#intervals button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.interval === state.interval);
  });

  readSymbolFromQuery();
  initCharts();
  bindEvents();
  await loadMarketData();
});