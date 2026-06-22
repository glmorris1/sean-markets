let MARKETS = [];
let BASE_MARKETS = [];
const BASE_SYMBOLS = new Set();
const CUSTOM_WATCHLIST_KEY = "sean-custom-watchlist";

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

let chartReady = false;
let loadToken = 0;

function money(value, symbol = state.active?.symbol) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const decimals = 2;
  const fixed = num.toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function findMarket(query) {
  return DataService.resolveSymbol?.(query) || MARKETS.find((m) => m.symbol.toLowerCase() === String(query).toLowerCase()) || null;
}

function loadCustomMarkets() {
  try {
    const raw = localStorage.getItem(CUSTOM_WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomMarkets(markets) {
  localStorage.setItem(CUSTOM_WATCHLIST_KEY, JSON.stringify(markets));
}

function mergeWatchlist(base, custom) {
  const seen = new Set(base.map((m) => m.symbol));
  const merged = [...base];
  custom.forEach((m) => {
    if (!m?.symbol || seen.has(m.symbol)) return;
    const entry = { ...m, custom: true };
    merged.push(entry);
    DataService.registerMarket?.(entry);
    seen.add(m.symbol);
  });
  return merged;
}

function rebuildMarkets() {
  MARKETS = mergeWatchlist(BASE_MARKETS, loadCustomMarkets());
}

function persistCustomQuote(market) {
  if (!market?.custom) return;
  const custom = loadCustomMarkets();
  const idx = custom.findIndex((m) => m.symbol === market.symbol);
  if (idx < 0) return;
  custom[idx] = {
    ...custom[idx],
    price: market.price,
    change: market.change,
    volume: market.volume,
    name: market.name,
    exchange: market.exchange
  };
  saveCustomMarkets(custom);
}

async function addSymbolToWatchlist(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) throw new Error("Enter a symbol.");

  const existing = MARKETS.find((m) => m.symbol.toUpperCase() === raw.toUpperCase());
  if (existing) {
    state.active = existing;
    document.getElementById("symbolSearch").value = existing.symbol;
    state.range = { from: "", to: "" };
    renderWatchlist();
    await loadMarketData();
    return existing;
  }

  setStatus(`Looking up ${raw.toUpperCase()} on Yahoo Finance…`);
  const entry = await DataService.lookupSymbol(raw);
  const market = { ...entry, custom: true };
  const custom = loadCustomMarkets();
  if (!custom.some((m) => m.symbol === market.symbol)) {
    custom.push(market);
    saveCustomMarkets(custom);
  }
  rebuildMarkets();
  state.active = MARKETS.find((m) => m.symbol === market.symbol) || market;
  document.getElementById("symbolSearch").value = state.active.symbol;
  state.range = { from: "", to: "" };
  renderWatchlist();
  await loadMarketData();
  setStatus(`Added ${state.active.symbol} to watchlist`);
  return state.active;
}

function removeSymbolFromWatchlist(symbol) {
  if (BASE_SYMBOLS.has(symbol)) return;
  saveCustomMarkets(loadCustomMarkets().filter((m) => m.symbol !== symbol));
  rebuildMarkets();
  if (state.active?.symbol === symbol) {
    state.active = MARKETS[0] || null;
    if (state.active) {
      document.getElementById("symbolSearch").value = state.active.symbol;
      state.range = { from: "", to: "" };
      loadMarketData();
    }
  }
  renderWatchlist(document.getElementById("symbolSearch")?.value || "");
}

function openAddSymbolDialog() {
  const dialog = document.getElementById("addSymbolDialog");
  const input = document.getElementById("addSymbolInput");
  const error = document.getElementById("addSymbolError");
  if (!dialog || !input) return;
  error.textContent = "";
  input.value = document.getElementById("symbolSearch")?.value?.trim() || "";
  dialog.showModal();
  input.focus();
  input.select();
}

function bindAddSymbolDialog() {
  const dialog = document.getElementById("addSymbolDialog");
  const form = document.getElementById("addSymbolForm");
  const input = document.getElementById("addSymbolInput");
  const error = document.getElementById("addSymbolError");
  const cancelBtn = document.getElementById("cancelAddSymbol");

  document.getElementById("addSymbolBtn")?.addEventListener("click", openAddSymbolDialog);
  cancelBtn?.addEventListener("click", () => dialog?.close());

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submitBtn = document.getElementById("confirmAddSymbol");
    submitBtn.disabled = true;
    try {
      await addSymbolToWatchlist(input.value);
      dialog?.close();
      form.reset();
    } catch (err) {
      error.textContent = err.message || "Could not add symbol.";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function movingAverage(values, period) {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function initCharts() {
  const chart = window.YahooChart;
  if (!chart) throw new Error("Yahoo chart module failed to load.");
  chart.init(
    document.getElementById("chartContainer"),
    document.getElementById("volumeContainer")
  );
  chart.setTheme(document.querySelector(".app")?.dataset.theme || "dark");
  chartReady = true;
}

function applyChartType() {
  if (!chartReady) return;
  window.YahooChart?.setChartType(state.chartType);
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
  if (!chartReady || !state.candles.length) return;

  const closes = state.candles.map((c) => c.close);
  const ma20 = movingAverage(closes, 20);
  const ema50 = movingAverage(closes, 50);

  window.YahooChart?.setIndicators(state.indicators);
  window.YahooChart?.setData(state.candles, { ma20, ema50 });
  applyChartType();

  if (state.indicators) {
    document.getElementById("ma20Val").textContent = money(ma20.at(-1) || 0);
    document.getElementById("ema50Val").textContent = money(ema50.at(-1) || 0);
  } else {
    document.getElementById("ma20Val").textContent = "—";
    document.getElementById("ema50Val").textContent = "—";
  }

  if (state.backtestStart != null) {
    scrollChartToTime(state.backtestStart);
  } else {
    window.YahooChart?.fitContent();
  }
  updateQuoteUI();
  drawSpark();
  renderWatchlist();
  renderScreener();
  if (state.strategyReady && !state.suppressAutoBacktest) window.StrategyTester?.update?.();
}

function applyHistoryPayload(payload) {
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
  const note = payload.sourceNote ? ` · ${payload.sourceNote}` : "";
  setStatus(
    `${payload.source} · ${DataService.intervalLabel(state.interval)} · latest ${DataService.formatAsOf(latest, state.interval)} · ${state.candles.length} bars in range${note}`
  );
  syncWatchlistQuote(state.active.symbol, latest);
}

async function loadMarketData() {
  if (!state.active) return;
  const token = ++loadToken;
  state.loading = true;
  setStatus("Loading historical data…");

  try {
    const bundled = await DataService.loadHistory(state.active.symbol, state.interval, { preferLive: false });
    if (token !== loadToken) return;
    applyHistoryPayload(bundled);

    try {
      const live = await DataService.loadHistory(state.active.symbol, state.interval, {
        preferLive: true,
        bypassCache: true
      });
      if (token !== loadToken) return;
      applyHistoryPayload(live);
    } catch (error) {
      if (!state.rawCandles.length) throw error;
    }
  } catch (error) {
    if (token === loadToken) setStatus(error.message || "Failed to load market data.", true);
  } finally {
    if (token === loadToken) state.loading = false;
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
  window.ForexFactory?.updateForSymbol?.(state.active.symbol, state.active);
}

function syncWatchlistQuote(symbol, latest) {
  const market = MARKETS.find((m) => m.symbol === symbol);
  if (!market || !latest) return;
  market.price = latest.close;
  const { pct } = DataService.dailyChange(state.rawCandles);
  market.change = Number(pct.toFixed(2));
  persistCustomQuote(market);
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

function watchlistRow(m) {
  const removeBtn = m.custom
    ? `<button type="button" class="watch-remove" data-remove-symbol="${m.symbol}" aria-label="Remove ${m.symbol}">×</button>`
    : "";
  return `
    <button class="watch-row ${state.active?.symbol === m.symbol ? "active" : ""}" type="button" data-symbol="${m.symbol}">
      <span><strong>${m.symbol}</strong><span>${m.name}</span></span>
      <span class="watch-side">
        <span><strong>${money(m.price, m.symbol)}</strong><span class="${m.change >= 0 ? "positive" : "negative"}">${m.change >= 0 ? "+" : ""}${m.change.toFixed(2)}%</span></span>
        ${removeBtn}
      </span>
    </button>`;
}

function renderWatchlist(filter = "") {
  const list = document.getElementById("watchlist");
  const needle = filter.toLowerCase();
  const visible = MARKETS.filter((m) => `${m.symbol} ${m.name}`.toLowerCase().includes(needle));
  const custom = visible.filter((m) => m.custom);
  const futures = visible.filter((m) => m.assetClass === "futures" && !m.custom);
  const other = visible.filter((m) => m.assetClass !== "futures" && !m.custom);
  const sections = [];

  if (custom.length) {
    sections.push(`<div class="watch-section-label">Your watchlist</div>${custom.map(watchlistRow).join("")}`);
  }
  if (other.length) {
    sections.push(`<div class="watch-section-label">Markets</div>${other.map(watchlistRow).join("")}`);
  }
  if (futures.length) {
    sections.push(`<div class="watch-section-label">Futures</div>${futures.map(watchlistRow).join("")}`);
  }

  list.innerHTML = sections.join("") || `<p class="watch-empty">No symbols match "${filter}"</p>`;
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
  if (!chartReady) return;
  window.YahooChart?.setMarkers(markers || []);
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
  window.StrategyTester?.selectTab?.("overview");
  window.StrategyTester?.onResize?.();
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
  if (!chartReady || !state.candles.length) return;
  window.YahooChart?.scrollToTime(time);
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

  initStrategyTester();
  if (!state.strategyReady || typeof window.StrategyTester?.run !== "function") {
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
  window.StrategyTester.selectTab("overview");

  const ok = window.StrategyTester.run({ force: true });
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
  document.addEventListener("click", (e) => {
    const target = e.target.closest("button");
    if (!target) return;

    if (target.id === "headerRunBacktest") {
      executeBacktest(target);
      return;
    }
    if (target.id === "randomStart") {
      randomBacktestStart(target);
      return;
    }
    if (target.id === "applyRange") {
      const from = document.getElementById("rangeFrom")?.value || "";
      const to = document.getElementById("rangeTo")?.value || "";
      const startIdx = from ? DataService.findCandleIndex(state.rawCandles, from) : 0;
      const startTime = state.rawCandles[startIdx]?.time ?? null;
      setBacktestRange(from, to, startTime);
      executeBacktest(target, { keepRange: true });
      return;
    }
    if (target.id === "resetRange") {
      state.backtestStart = null;
      const range = DataService.defaultRange(state.rawCandles, state.interval);
      setBacktestRange(range.from, range.to, null);
      updateBacktestStartLabel();
      safeSetMarkers([]);
      return;
    }
    if (target.id === "refreshData") {
      DataService.clearCache();
      window.ForexFactory?.clearCache?.();
      state.range = { from: "", to: "" };
      loadMarketData();
      return;
    }
    if (target.id === "indicatorBtn") {
      state.indicators = !state.indicators;
      target.classList.toggle("active", state.indicators);
      const row = document.getElementById("indicatorRow");
      if (row) row.style.opacity = state.indicators ? "1" : "0.45";
      renderSeries();
      return;
    }
    if (target.id === "themeBtn") {
      const app = document.querySelector(".app");
      if (!app) return;
      app.dataset.theme = app.dataset.theme === "dark" ? "light" : "dark";
      if (chartReady) window.YahooChart?.setTheme(app.dataset.theme);
      return;
    }
    if (target.id === "runBacktest") {
      executeBacktest(target);
      return;
    }

    const panelBtn = target.closest(".bottom-tabs [data-panel]");
    if (panelBtn) {
      const panel = panelBtn.dataset.panel;
      document.querySelectorAll(".bottom-tabs [data-panel]").forEach((b) => {
        b.classList.toggle("active", b.dataset.panel === panel);
      });
      document.querySelectorAll(".panel-content").forEach((el) => {
        el.classList.toggle("active", el.dataset.panel === panel);
      });
      window.StrategyTester?.onResize?.();
      return;
    }

    const tabBtn = target.closest("[data-st-tab]");
    if (tabBtn) {
      window.StrategyTester?.selectTab?.(tabBtn.dataset.stTab);
      return;
    }

    const removeBtn = target.closest("[data-remove-symbol]");
    if (removeBtn) {
      removeSymbolFromWatchlist(removeBtn.dataset.removeSymbol);
      return;
    }

    const watchRow = target.closest(".watch-row");
    if (watchRow) {
      state.active = MARKETS.find((m) => m.symbol === watchRow.dataset.symbol) || state.active;
      const search = document.getElementById("symbolSearch");
      if (search) search.value = state.active.symbol;
      state.range = { from: "", to: "" };
      loadMarketData();
      return;
    }

    const typeBtn = target.closest("#chartTypes button[data-type]");
    if (typeBtn) {
      state.chartType = typeBtn.dataset.type;
      document.querySelectorAll("#chartTypes button").forEach((b) => b.classList.toggle("selected", b === typeBtn));
      applyChartType();
      return;
    }

    const intervalBtn = target.closest("#intervals button[data-interval]");
    if (intervalBtn) {
      state.interval = intervalBtn.dataset.interval;
      document.querySelectorAll("#intervals button").forEach((b) => b.classList.toggle("selected", b === intervalBtn));
      state.range = { from: "", to: "" };
      updateRangeInputs();
      loadMarketData();
      return;
    }

    if (target.classList.contains("tool")) {
      document.querySelectorAll(".tool").forEach((t) => t.classList.toggle("active", t === target));
      return;
    }

    if (target.closest(".side-toggle")) {
      document.querySelectorAll(".side-toggle button").forEach((b) => b.classList.remove("active"));
      target.classList.add("active");
    }
  });

  document.getElementById("symbolSearch")?.addEventListener("change", async (e) => {
    const query = e.target.value.trim();
    if (!query) return;
    let hit = findMarket(query);
    if (!hit) {
      try {
        hit = await addSymbolToWatchlist(query);
      } catch (error) {
        setStatus(error.message || "Symbol not found.", true);
        renderWatchlist(query);
        return;
      }
    }
    state.active = hit;
    e.target.value = hit.symbol;
    state.range = { from: "", to: "" };
    loadMarketData();
    renderWatchlist(e.target.value);
  });

  document.getElementById("symbolSearch")?.addEventListener("input", (e) => {
    renderWatchlist(e.target.value);
  });

  window.addEventListener("resize", () => {
    resizeCharts();
    drawSpark();
    window.StrategyTester?.onResize?.();
  });
}

function resizeCharts() {
  if (!chartReady) return;
  window.YahooChart?.resize();
}

function initStrategyTester() {
  const tester = window.StrategyTester;
  const engine = window.StrategyEngine;
  if (state.strategyReady || !tester || !engine) return;
  tester.init({
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
  bindAddSymbolDialog();
  initStrategyTester();

  try {
    if (window.lucide) window.lucide.createIcons();

    const manifest = await DataService.loadManifest();
    BASE_MARKETS = manifest.symbols || [];
    BASE_SYMBOLS.clear();
    BASE_MARKETS.forEach((m) => BASE_SYMBOLS.add(m.symbol));
    MARKETS = mergeWatchlist(BASE_MARKETS, loadCustomMarkets());
    if (!MARKETS.length) throw new Error("No symbols in manifest.");
    state.active = MARKETS[0];

    document.querySelectorAll("#intervals button").forEach((b) => {
      b.classList.toggle("selected", b.dataset.interval === state.interval);
    });

    const querySymbol = new URLSearchParams(window.location.search).get("symbol");
    if (querySymbol) {
      const hit = findMarket(querySymbol);
      if (hit) {
        state.active = hit;
        document.getElementById("symbolSearch").value = hit.symbol;
      } else {
        try {
          await addSymbolToWatchlist(querySymbol);
        } catch (error) {
          setStatus(error.message || `Could not load ${querySymbol}.`, true);
        }
      }
    }
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