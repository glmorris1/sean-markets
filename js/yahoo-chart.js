const YahooChart = (() => {
  const COLORS = {
    dark: {
      bg: "#131722",
      grid: "#363a45",
      text: "#787b86",
      up: "#26a69a",
      down: "#ef5350",
      ma20: "#f5c85c",
      ema50: "#2962ff",
      line: "#2962ff",
      area: "rgba(41,98,255,0.25)",
      start: "#f5c85c",
      buy: "#26a69a",
      sell: "#ef5350"
    },
    light: {
      bg: "#ffffff",
      grid: "#e0e3eb",
      text: "#787b86",
      up: "#26a69a",
      down: "#ef5350",
      ma20: "#f5c85c",
      ema50: "#2962ff",
      line: "#2962ff",
      area: "rgba(41,98,255,0.2)",
      start: "#f5c85c",
      buy: "#26a69a",
      sell: "#ef5350"
    }
  };

  let priceWrap = null;
  let volWrap = null;
  let priceCanvas = null;
  let volCanvas = null;
  let candles = [];
  let markers = [];
  let ma20 = [];
  let ema50 = [];
  let chartType = "candles";
  let showIndicators = true;
  let theme = "dark";
  let viewFrom = 0;
  let viewTo = 0;

  function colors() {
    return COLORS[theme] || COLORS.dark;
  }

  function init(priceEl, volEl) {
    priceWrap = priceEl;
    volWrap = volEl;
    priceWrap.innerHTML = "";
    volWrap.innerHTML = "";
    priceCanvas = document.createElement("canvas");
    volCanvas = document.createElement("canvas");
    priceCanvas.className = "yahoo-price-canvas";
    volCanvas.className = "yahoo-vol-canvas";
    priceWrap.appendChild(priceCanvas);
    volWrap.appendChild(volCanvas);
    priceWrap.insertAdjacentHTML(
      "beforeend",
      '<div class="yahoo-chart-badge">Yahoo Finance</div>'
    );
  }

  function findIndex(time) {
    const key = String(time);
    let idx = candles.findIndex((c) => String(c.time) === key);
    if (idx >= 0) return idx;
    const epoch = typeof time === "number" ? time : Date.parse(`${time}T12:00:00`) / 1000;
    idx = candles.findIndex((c) => {
      const ce = typeof c.time === "number" ? c.time : Date.parse(`${c.time}T12:00:00`) / 1000;
      return ce >= epoch;
    });
    return idx >= 0 ? idx : 0;
  }

  function setData(data, indicators = {}) {
    candles = data || [];
    ma20 = indicators.ma20 || [];
    ema50 = indicators.ema50 || [];
    if (!candles.length) {
      viewFrom = 0;
      viewTo = 0;
      draw();
      return;
    }
    fitContent();
  }

  function setMarkers(list) {
    markers = list || [];
    draw();
  }

  function setChartType(type) {
    chartType = type;
    draw();
  }

  function setIndicators(on) {
    showIndicators = on;
    draw();
  }

  function setTheme(mode) {
    theme = mode === "light" ? "light" : "dark";
    draw();
  }

  function fitContent() {
    if (!candles.length) return;
    const span = Math.min(140, candles.length);
    viewFrom = Math.max(0, candles.length - span);
    viewTo = candles.length - 1;
    draw();
  }

  function scrollToTime(time) {
    if (!candles.length) return;
    const anchor = findIndex(time);
    const span = Math.min(120, candles.length);
    viewFrom = Math.max(0, Math.min(anchor - 2, candles.length - span));
    viewTo = Math.min(candles.length - 1, viewFrom + span);
    draw();
  }

  function visibleCandles() {
    if (!candles.length) return [];
    const from = Math.max(0, Math.min(viewFrom, candles.length - 1));
    const to = Math.max(from, Math.min(viewTo, candles.length - 1));
    return candles.slice(from, to + 1);
  }

  function formatLabel(time) {
    if (typeof time === "number") {
      const d = new Date(time * 1000);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    return String(time).slice(5);
  }

  function setupCanvas(canvas, wrap) {
    const rect = wrap.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function draw() {
    if (!priceCanvas || !volCanvas) return;
    const c = colors();
    const vis = visibleCandles();
    const { ctx: pctx, w: pw, h: ph } = setupCanvas(priceCanvas, priceWrap);
    const { ctx: vctx, w: vw, h: vh } = setupCanvas(volCanvas, volWrap);

    pctx.fillStyle = c.bg;
    pctx.fillRect(0, 0, pw, ph);
    vctx.fillStyle = c.bg;
    vctx.fillRect(0, 0, vw, vh);

    if (!vis.length) {
      pctx.fillStyle = c.text;
      pctx.font = "13px Inter, sans-serif";
      pctx.fillText("No Yahoo data in range", 14, 24);
      return;
    }

    const pad = { l: 56, r: 12, t: 12, b: 22 };
    const plotW = pw - pad.l - pad.r;
    const plotH = ph - pad.t - pad.b;
    const barW = plotW / vis.length;
    const bodyW = Math.max(1, barW * 0.6);

    let min = Infinity;
    let max = -Infinity;
    vis.forEach((bar) => {
      min = Math.min(min, bar.low);
      max = Math.max(max, bar.high);
    });
    if (showIndicators) {
      const offset = viewFrom;
      vis.forEach((_, i) => {
        const gi = offset + i;
        if (ma20[gi] != null) { min = Math.min(min, ma20[gi]); max = Math.max(max, ma20[gi]); }
        if (ema50[gi] != null) { min = Math.min(min, ema50[gi]); max = Math.max(max, ema50[gi]); }
      });
    }
    const range = max - min || 1;
    const y = (v) => pad.t + ((max - v) / range) * plotH;
    const x = (i) => pad.l + i * barW + barW / 2;

    for (let g = 0; g <= 4; g += 1) {
      const val = min + (range * g) / 4;
      const gy = y(val);
      pctx.strokeStyle = c.grid;
      pctx.beginPath();
      pctx.moveTo(pad.l, gy);
      pctx.lineTo(pw - pad.r, gy);
      pctx.stroke();
      pctx.fillStyle = c.text;
      pctx.font = "10px Inter, sans-serif";
      pctx.textAlign = "right";
      pctx.fillText(val.toFixed(2), pad.l - 6, gy + 3);
    }

    if (chartType === "area" || chartType === "line") {
      pctx.beginPath();
      vis.forEach((bar, i) => {
        const px = x(i);
        const py = y(bar.close);
        if (i === 0) pctx.moveTo(px, py);
        else pctx.lineTo(px, py);
      });
      if (chartType === "area") {
        pctx.lineTo(x(vis.length - 1), pad.t + plotH);
        pctx.lineTo(x(0), pad.t + plotH);
        pctx.closePath();
        pctx.fillStyle = c.area;
        pctx.fill();
        pctx.beginPath();
        vis.forEach((bar, i) => {
          const px = x(i);
          const py = y(bar.close);
          if (i === 0) pctx.moveTo(px, py);
          else pctx.lineTo(px, py);
        });
      }
      pctx.strokeStyle = c.line;
      pctx.lineWidth = 2;
      pctx.stroke();
    } else {
      vis.forEach((bar, i) => {
        const up = bar.close >= bar.open;
        const col = up ? c.up : c.down;
        const cx = x(i);
        pctx.strokeStyle = col;
        pctx.fillStyle = col;
        pctx.lineWidth = 1;
        pctx.beginPath();
        pctx.moveTo(cx, y(bar.high));
        pctx.lineTo(cx, y(bar.low));
        pctx.stroke();
        const top = y(Math.max(bar.open, bar.close));
        const bot = y(Math.min(bar.open, bar.close));
        pctx.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
      });
    }

    if (showIndicators) {
      const drawLine = (series, color) => {
        pctx.strokeStyle = color;
        pctx.lineWidth = 1;
        pctx.beginPath();
        let started = false;
        vis.forEach((_, i) => {
          const gi = viewFrom + i;
          const val = series[gi];
          if (val == null) return;
          const px = x(i);
          const py = y(val);
          if (!started) { pctx.moveTo(px, py); started = true; }
          else pctx.lineTo(px, py);
        });
        pctx.stroke();
      };
      drawLine(ma20, c.ma20);
      drawLine(ema50, c.ema50);
    }

    markers.forEach((m) => {
      const idx = vis.findIndex((bar) => String(bar.time) === String(m.time));
      if (idx < 0) return;
      const cx = x(idx);
      const bar = vis[idx];
      const isBuy = m.text === "Buy";
      const isSell = m.text === "Sell";
      const isStart = m.text === "BT Start" || m.text === "Start";
      if (isStart) {
        pctx.fillStyle = c.start;
        pctx.beginPath();
        pctx.arc(cx, y(bar.high) - 8, 4, 0, Math.PI * 2);
        pctx.fill();
        return;
      }
      const col = isBuy ? c.buy : isSell ? c.sell : c.start;
      const baseY = isBuy ? y(bar.low) + 10 : y(bar.high) - 10;
      pctx.fillStyle = col;
      pctx.beginPath();
      if (isBuy) {
        pctx.moveTo(cx, baseY - 8);
        pctx.lineTo(cx - 5, baseY);
        pctx.lineTo(cx + 5, baseY);
      } else {
        pctx.moveTo(cx, baseY + 8);
        pctx.lineTo(cx - 5, baseY);
        pctx.lineTo(cx + 5, baseY);
      }
      pctx.closePath();
      pctx.fill();
    });

    pctx.fillStyle = c.text;
    pctx.font = "10px Inter, sans-serif";
    pctx.textAlign = "center";
    const labelEvery = Math.max(1, Math.floor(vis.length / 6));
    vis.forEach((bar, i) => {
      if (i % labelEvery !== 0 && i !== vis.length - 1) return;
      pctx.fillText(formatLabel(bar.time), x(i), ph - 6);
    });

    const vmax = Math.max(...vis.map((b) => b.volume));
    const vpad = { l: 56, r: 12, t: 4, b: 14 };
    const vplotH = vh - vpad.t - vpad.b;
    vis.forEach((bar, i) => {
      const up = bar.close >= bar.open;
      const bh = vmax > 0 ? (bar.volume / vmax) * vplotH : 0;
      const bx = vpad.l + i * (vw - vpad.l - vpad.r) / vis.length;
      const bw = Math.max(1, ((vw - vpad.l - vpad.r) / vis.length) * 0.7);
      vctx.fillStyle = up ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)";
      vctx.fillRect(bx, vpad.t + vplotH - bh, bw, bh);
    });
  }

  function resize() {
    draw();
  }

  return {
    init,
    setData,
    setMarkers,
    setChartType,
    setIndicators,
    setTheme,
    fitContent,
    scrollToTime,
    resize,
    draw
  };
})();

window.YahooChart = YahooChart;