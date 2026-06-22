const StrategyTester = (() => {
  let hooks = {};
  let result = null;
  let activeTab = "overview";
  let settings = {
    initialCapital: 10000,
    commission: 0,
    slippagePct: 0.05,
    qtyMode: "equity",
    fixedQty: 10,
    equityPct: 95
  };
  let params = {};

  function init(h) {
    hooks = h;
    buildStrategySelect();
    buildParamFields();
    bindEvents();
    selectTab("overview");
  }

  function buildStrategySelect() {
    const sel = document.getElementById("strategySelect");
    if (!sel) return;
    sel.innerHTML = Object.values(StrategyEngine.STRATEGIES)
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");
    params = { ...StrategyEngine.STRATEGIES.ma_cross.defaults };
  }

  function buildParamFields() {
    const wrap = document.getElementById("strategyParams");
    if (!wrap) return;
    const strategyId = document.getElementById("strategySelect")?.value || "ma_cross";
    const strategy = StrategyEngine.STRATEGIES[strategyId];
    params = { ...strategy.defaults, ...params };

    wrap.innerHTML = strategy.fields
      .map(
        (f) => `
        <label>
          <span>${f.label}</span>
          <input type="${f.type}" data-param="${f.key}"
            value="${params[f.key] ?? strategy.defaults[f.key]}"
            min="${f.min ?? ""}" max="${f.max ?? ""}" />
        </label>`
      )
      .join("");
  }

  function readParams() {
    document.querySelectorAll("[data-param]").forEach((el) => {
      params[el.dataset.param] = el.type === "number" ? Number(el.value) : el.value;
    });
    return params;
  }

  function readSettings() {
    const cap = document.getElementById("stInitialCapital");
    const comm = document.getElementById("stCommission");
    const slip = document.getElementById("stSlippage");
    const qtyMode = document.getElementById("stQtyMode");
    const fixedQty = document.getElementById("stFixedQty");
    const equityPct = document.getElementById("stEquityPct");

    settings = {
      initialCapital: Number(cap?.value) || 10000,
      commission: Number(comm?.value) || 0,
      slippagePct: Number(slip?.value) || 0.05,
      qtyMode: qtyMode?.value || "equity",
      fixedQty: Number(fixedQty?.value) || 10,
      equityPct: Number(equityPct?.value) || 95
    };
    return settings;
  }

  function bindEvents() {
    document.getElementById("strategySelect")?.addEventListener("change", () => {
      const id = document.getElementById("strategySelect").value;
      params = { ...StrategyEngine.STRATEGIES[id].defaults };
      buildParamFields();
      run();
    });

    document.getElementById("runBacktest")?.addEventListener("click", run);

    ["stInitialCapital", "stCommission", "stSlippage", "stQtyMode", "stFixedQty", "stEquityPct"].forEach(
      (id) => {
        document.getElementById(id)?.addEventListener("change", run);
      }
    );

    document.getElementById("strategyParams")?.addEventListener("change", run);
  }

  function selectTab(tab) {
    activeTab = tab;
    document.querySelectorAll("[data-st-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.stTab === tab);
    });
    document.querySelectorAll("[data-st-pane]").forEach((el) => {
      el.classList.toggle("active", el.dataset.stPane === tab);
    });
    if (tab === "overview") drawEquityCurve();
  }

  function run() {
    const candles = hooks.getCandles?.() || [];
    if (candles.length < 10) {
      renderEmpty("Not enough bars in range to backtest.");
      return;
    }

    const strategyId = document.getElementById("strategySelect")?.value || "ma_cross";
    result = StrategyEngine.runBacktest(candles, strategyId, readParams(), readSettings());
    hooks.setMarkers?.(result.markers);
    render();
  }

  function update() {
    const symbol = hooks.getSymbol?.() || "";
    const candles = hooks.getCandles?.() || [];
    const label = document.getElementById("stRangeLabel");
    if (label && candles.length) {
      const from = formatDate(candles[0].time);
      const to = formatDate(candles.at(-1).time);
      label.textContent = `${symbol} · ${from} — ${to} · ${candles.length} bars`;
    }
    run();
  }

  function formatDate(time) {
    if (typeof time === "number") return new Date(time * 1000).toLocaleDateString();
    return new Date(`${time}T12:00:00`).toLocaleDateString();
  }

  function fmtMoney(v, signed = false) {
    const fn = hooks.formatMoney || ((n) => n.toFixed(2));
    const s = fn(v);
    if (!signed) return s;
    return v >= 0 ? `+${s}` : s;
  }

  function fmtPct(v, signed = false) {
    const s = `${v.toFixed(2)}%`;
    return signed && v >= 0 ? `+${s}` : s;
  }

  function fmtPF(v) {
    if (!Number.isFinite(v)) return "∞";
    return v.toFixed(2);
  }

  function renderEmpty(msg) {
    document.getElementById("stMetricsOverview")?.replaceChildren();
    document.getElementById("stMetricsPerf")?.replaceChildren();
    document.getElementById("stTradesBody")?.replaceChildren();
    const status = document.getElementById("stStatus");
    if (status) status.textContent = msg;
    hooks.setMarkers?.([]);
  }

  function render() {
    if (!result) return;
    const m = result.metrics;
    const status = document.getElementById("stStatus");
    if (status) {
      status.textContent = `${result.strategy} · ${result.trades.length} trades · ${result.signalCount} signals`;
    }

    renderMetricGrid("stMetricsOverview", [
      { label: "Net Profit", value: fmtMoney(m.netProfit, true), cls: m.netProfit >= 0 ? "positive" : "negative" },
      { label: "Net Profit %", value: fmtPct(m.netProfitPct, true), cls: m.netProfitPct >= 0 ? "positive" : "negative" },
      { label: "Total Trades", value: String(m.totalTrades) },
      { label: "Win Rate", value: fmtPct(m.winRate) },
      { label: "Profit Factor", value: fmtPF(m.profitFactor) },
      { label: "Max Drawdown", value: fmtPct(m.maxDrawdownPct) },
      { label: "Sharpe Ratio", value: m.sharpe.toFixed(2) },
      { label: "Final Equity", value: fmtMoney(m.finalEquity) }
    ]);

    renderMetricGrid("stMetricsPerf", [
      { label: "Gross Profit", value: fmtMoney(m.grossProfit), cls: "positive" },
      { label: "Gross Loss", value: fmtMoney(m.grossLoss), cls: "negative" },
      { label: "Avg Trade", value: fmtMoney(m.avgTrade, true), cls: m.avgTrade >= 0 ? "positive" : "negative" },
      { label: "Largest Win", value: fmtMoney(m.largestWin), cls: "positive" },
      { label: "Largest Loss", value: fmtMoney(m.largestLoss), cls: "negative" },
      { label: "Max Drawdown $", value: fmtMoney(m.maxDrawdown), cls: "negative" },
      { label: "Initial Capital", value: fmtMoney(settings.initialCapital) },
      { label: "Commission / trade", value: fmtMoney(settings.commission) }
    ]);

    renderTrades();
    drawEquityCurve();
  }

  function renderMetricGrid(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items
      .map(
        (item) => `
      <div class="st-metric">
        <span>${item.label}</span>
        <strong class="${item.cls || ""}">${item.value}</strong>
      </div>`
      )
      .join("");
  }

  function renderTrades() {
    const body = document.getElementById("stTradesBody");
    if (!body) return;
    if (!result.trades.length) {
      body.innerHTML = `<tr><td colspan="9" class="st-empty">No trades in this range.</td></tr>`;
      return;
    }
    body.innerHTML = result.trades
      .map(
        (t) => `
      <tr>
        <td>${t.id}</td>
        <td>${formatDate(t.entryTime)}</td>
        <td>${formatDate(t.exitTime)}</td>
        <td>${t.signal || "—"}</td>
        <td>${hooks.formatMoney(t.entryPrice)}</td>
        <td>${hooks.formatMoney(t.exitPrice)}</td>
        <td>${t.qty}</td>
        <td class="${t.profit >= 0 ? "positive" : "negative"}">${fmtMoney(t.profit, true)}</td>
        <td class="${t.profitPct >= 0 ? "positive" : "negative"}">${fmtPct(t.profitPct, true)}</td>
      </tr>`
      )
      .join("");
  }

  function drawEquityCurve() {
    const canvas = document.getElementById("equityCurve");
    if (!canvas || !result?.equityCurve?.length) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 12, right: 12, bottom: 22, left: 56 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const points = result.equityCurve;
    const equities = points.map((p) => p.equity);
    const min = Math.min(...equities);
    const max = Math.max(...equities);
    const range = max - min || 1;

    const isLight = document.querySelector(".app")?.dataset.theme === "light";
    const gridColor = isLight ? "#e0e3eb" : "#363a45";
    const textColor = isLight ? "#787b86" : "#787b86";
    const lineColor = "#2962ff";
    const fillColor = isLight ? "rgba(41,98,255,0.12)" : "rgba(41,98,255,0.2)";
    const baseline = settings.initialCapital;

    ctx.clearRect(0, 0, w, h);

    const yScale = (v) => pad.top + ((max - v) / range) * plotH;
    const xScale = (i) => pad.left + (i / Math.max(1, points.length - 1)) * plotW;

    for (let i = 0; i <= 4; i += 1) {
      const v = min + (range * i) / 4;
      const y = yScale(v);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(hooks.formatMoney(v), pad.left - 6, y + 3);
    }

    const baseY = yScale(baseline);
    ctx.strokeStyle = isLight ? "#d1d4dc" : "#4a4e59";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, baseY);
    ctx.lineTo(w - pad.right, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xScale(i);
      const y = yScale(p.equity);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(xScale(points.length - 1), pad.top + plotH);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.fillStyle = textColor;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Equity curve", pad.left, h - 6);

    const final = equities.at(-1);
    const profit = final - settings.initialCapital;
    ctx.textAlign = "right";
    ctx.fillStyle = profit >= 0 ? "#26a69a" : "#ef5350";
    ctx.fillText(`${fmtMoney(profit, true)} (${fmtPct((profit / settings.initialCapital) * 100, true)})`, w - pad.right, h - 6);
  }

  function onResize() {
    if (activeTab === "overview") drawEquityCurve();
  }

  return { init, update, run, onResize, selectTab };
})();