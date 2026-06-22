const MARKETS = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", price: 201.22, change: 0.74, volume: "48.1M" },
  { symbol: "MSFT", name: "Microsoft Corp.", exchange: "NASDAQ", price: 478.88, change: 0.51, volume: "22.7M" },
  { symbol: "TSLA", name: "Tesla Inc.", exchange: "NASDAQ", price: 322.16, change: 1.88, volume: "94.3M" },
  { symbol: "NVDA", name: "NVIDIA Corp.", exchange: "NASDAQ", price: 168.44, change: -1.21, volume: "62.8M" },
  { symbol: "META", name: "Meta Platforms", exchange: "NASDAQ", price: 711.44, change: -0.42, volume: "16.9M" },
  { symbol: "BTCUSD", name: "Bitcoin", exchange: "CRYPTO", price: 64642.12, change: 1.48, volume: "31.4B" },
  { symbol: "ETHUSD", name: "Ethereum", exchange: "CRYPTO", price: 3184.8, change: -0.36, volume: "14.7B" },
  { symbol: "SPY", name: "S&P 500 ETF", exchange: "NYSE Arca", price: 612.22, change: 0.28, volume: "71.5M" }
];

const state = {
  active: MARKETS[0],
  chartType: "candles",
  interval: "60",
  indicators: true,
  candles: []
};

let priceChart = null;
let volumeChart = null;
let candleSeries = null;
let lineSeries = null;
let areaSeries = null;
let volumeSeries = null;
let ma20Series = null;
let ema50Series = null;

const els = {};

function money(value) {
  return value > 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value.toFixed(2);
}

function seededNoise(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function buildCandles(market, count = 120) {
  const base = market.price / (1 + market.change / 100);
  let cursor = base;
  const seedBase = market.symbol.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const now = Math.floor(Date.now() / 1000);
  const step = 3600;

  return Array.from({ length: count }, (_, index) => {
    const drift = market.change / 100 / count;
    const wave = Math.sin(index / 5 + seedBase) * 0.12;
    const noise = (seededNoise(seedBase + index * 7) - 0.45) * 0.55;
    const open = cursor;
    const close = Math.max(1, open * (1 + drift + (wave + noise) / 100));
    const spread = Math.abs(close - open) + market.price * (0.004 + seededNoise(seedBase + index) * 0.014);
    const high = Math.max(open, close) + spread * (0.45 + seededNoise(seedBase + index * 3));
    const low = Math.min(open, close) - spread * (0.35 + seededNoise(seedBase + index * 5));
    cursor = close;
    return {
      time: now - (count - index) * step,
      open,
      high,
      low,
      close,
      value: Math.round(spread * market.price * 0.02)
    };
  });
}

function movingAverage(values, period) {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    return slice.reduce((sum, v) => sum + v, 0) / period;
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

function updateSeries() {
  state.candles = buildCandles(state.active);
  const closes = state.candles.map((c) => c.close);
  const ma20 = movingAverage(closes, 20);
  const ema50 = movingAverage(closes, 50);

  candleSeries.setData(state.candles);
  lineSeries.setData(state.candles.map((c) => ({ time: c.time, value: c.close })));
  areaSeries.setData(state.candles.map((c) => ({ time: c.time, value: c.close })));
  volumeSeries.setData(state.candles.map((c) => ({
    time: c.time,
    value: c.value,
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

function updateQuoteUI() {
  const first = state.candles[0];
  const high = Math.max(...state.candles.map((c) => c.high));
  const low = Math.min(...state.candles.map((c) => c.low));
  const last = state.candles.at(-1).close;
  const change = ((last - first.open) / first.open) * 100;

  document.getElementById("symbolTitle").textContent = state.active.symbol;
  document.getElementById("symbolSubtitle").textContent = `${state.active.name} · ${state.active.exchange}`;
  document.getElementById("detailsSymbol").textContent = state.active.symbol;
  document.getElementById("lastPrice").textContent = money(last);
  document.getElementById("lastChange").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  document.getElementById("lastChange").className = change >= 0 ? "positive" : "negative";
  document.getElementById("statOpen").textContent = money(first.open);
  document.getElementById("statHigh").textContent = money(high);
  document.getElementById("statLow").textContent = money(low);
  document.getElementById("statVolume").textContent = state.active.volume;
  document.getElementById("volVal").textContent = state.active.volume;
  document.getElementById("limitPrice").value = last.toFixed(2);
  document.title = `Sean Chart — ${state.active.symbol}`;
}

function renderWatchlist(filter = "") {
  const list = document.getElementById("watchlist");
  const visible = MARKETS.filter((m) =>
    `${m.symbol} ${m.name}`.toLowerCase().includes(filter.toLowerCase())
  );
  list.innerHTML = visible.map((m) => `
    <button class="watch-row ${m.symbol === state.active.symbol ? "active" : ""}" type="button" data-symbol="${m.symbol}">
      <span><strong>${m.symbol}</strong><span>${m.name}</span></span>
      <span><strong>${money(m.price)}</strong><span class="${m.change >= 0 ? "positive" : "negative"}">${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%</span></span>
    </button>
  `).join("");
}

function drawSpark() {
  const canvas = document.getElementById("sparkCanvas");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const closes = state.candles.map((c) => c.close);
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
    updateSeries();
  });

  document.getElementById("symbolSearch").addEventListener("input", (e) => {
    renderWatchlist(e.target.value);
    const hit = MARKETS.find((m) => m.symbol.toLowerCase() === e.target.value.toLowerCase());
    if (hit) {
      state.active = hit;
      updateSeries();
    }
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
    updateSeries();
  });

  document.getElementById("indicatorBtn").addEventListener("click", () => {
    state.indicators = !state.indicators;
    document.getElementById("indicatorBtn").classList.toggle("active", state.indicators);
    document.getElementById("indicatorRow").style.opacity = state.indicators ? "1" : "0.45";
    updateSeries();
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

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
  readSymbolFromQuery();
  initCharts();
  bindEvents();
  updateSeries();
  setInterval(() => {
    const jitter = (Math.random() - 0.48) * state.active.price * 0.001;
    state.active.price = Math.max(1, state.active.price + jitter);
    updateSeries();
  }, 8000);
});