const MARKETS = [
  { symbol: "SPX", name: "S&P 500", price: 5432.18, change: 0.28 },
  { symbol: "NDX", name: "Nasdaq 100", price: 19844.52, change: 0.41 },
  { symbol: "BTCUSD", name: "Bitcoin", price: 64642.12, change: 1.48 },
  { symbol: "ETHUSD", name: "Ethereum", price: 3184.8, change: -0.36 },
  { symbol: "AAPL", name: "Apple Inc.", price: 201.22, change: 0.74 },
  { symbol: "NVDA", name: "NVIDIA", price: 168.44, change: -1.21 },
  { symbol: "TSLA", name: "Tesla", price: 322.16, change: 1.88 },
  { symbol: "GC1!", name: "Gold", price: 2348.6, change: 0.52 },
  { symbol: "CL1!", name: "Crude Oil", price: 78.42, change: -0.84 },
  { symbol: "DXY", name: "US Dollar Index", price: 104.82, change: 0.12 }
];

const IDEAS = [
  { symbol: "AAPL", title: "Apple holding key support ahead of earnings", bias: "Long", author: "ChartCraft" },
  { symbol: "BTCUSD", title: "Bitcoin range breakout setup on 4H", bias: "Long", author: "CryptoPulse" },
  { symbol: "NVDA", title: "Semiconductor pullback into demand zone", bias: "Long", author: "TechTrends" },
  { symbol: "TSLA", title: "Cup-and-handle measured move to $765", bias: "Long", author: "MomentumLab" },
  { symbol: "SPX", title: "Index breadth improving into month-end", bias: "Long", author: "MacroView" },
  { symbol: "ETHUSD", title: "ETH losing momentum at resistance cluster", bias: "Short", author: "ChainSignals" }
];

function money(value) {
  return value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value.toFixed(2);
}

function changeClass(change) {
  return change >= 0 ? "positive" : "negative";
}

function formatChange(change) {
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function seededNoise(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function drawMiniChart(canvas, seed, bullish = true) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const points = 48;
  const values = [];
  let cursor = h * 0.55;
  for (let i = 0; i < points; i += 1) {
    const drift = bullish ? -0.35 : 0.25;
    const wave = Math.sin(i / 4 + seed) * 8;
    const noise = (seededNoise(seed + i * 3) - 0.5) * 10;
    cursor += drift + wave * 0.08 + noise * 0.12;
    values.push(cursor);
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scaleY = (v) => 12 + ((max - v) / (max - min)) * (h - 24);
  const step = w / (points - 1);
  const color = bullish ? "#26a69a" : "#ef5350";

  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bullish ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.2)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = scaleY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = scaleY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderTicker() {
  const track = document.getElementById("tickerTrack");
  const items = [...MARKETS, ...MARKETS].map((m) => `
    <div class="ticker-item">
      <strong>${m.symbol}</strong>
      <span>${money(m.price)}</span>
      <span class="${changeClass(m.change)}">${formatChange(m.change)}</span>
    </div>
  `).join("");
  track.innerHTML = items;
}

function renderMarkets() {
  const grid = document.getElementById("marketGrid");
  grid.innerHTML = MARKETS.slice(0, 8).map((m) => `
    <a class="market-card" href="chart.html?symbol=${m.symbol}">
      <h3>${m.symbol}</h3>
      <p>${m.name}</p>
      <div class="price">${money(m.price)}</div>
      <div class="${changeClass(m.change)}">${formatChange(m.change)}</div>
    </a>
  `).join("");
}

function renderIdeas() {
  const grid = document.getElementById("ideasGrid");
  grid.innerHTML = IDEAS.map((idea, index) => `
    <article class="idea-card">
      <div class="idea-thumb"><canvas data-seed="${index + 11}" data-bullish="${idea.bias === "Long"}"></canvas></div>
      <div class="idea-body">
        <div class="idea-meta">
          <span>${idea.symbol}</span>
          <span class="idea-badge">${idea.bias}</span>
        </div>
        <h3>${idea.title}</h3>
        <p>by ${idea.author}</p>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("canvas").forEach((canvas) => {
    drawMiniChart(canvas, Number(canvas.dataset.seed), canvas.dataset.bullish === "true");
  });
}

function drawHeroChart() {
  const canvas = document.getElementById("heroChart");
  if (!canvas) return;
  drawMiniChart(canvas, 42, true);
}

function setupSearch() {
  const dialog = document.getElementById("searchDialog");
  const openBtn = document.getElementById("openSearch");
  const closeBtn = document.getElementById("closeSearch");
  const input = document.getElementById("globalSearch");
  const results = document.getElementById("searchResults");

  const renderResults = (query = "") => {
    const hits = MARKETS.filter((m) =>
      `${m.symbol} ${m.name}`.toLowerCase().includes(query.toLowerCase())
    );
    results.innerHTML = hits.map((m) => `
      <a class="search-hit" href="chart.html?symbol=${m.symbol}">
        <span><strong>${m.symbol}</strong> · ${m.name}</span>
        <span class="${changeClass(m.change)}">${formatChange(m.change)}</span>
      </a>
    `).join("") || `<p style="padding:12px;color:var(--muted)">No matches</p>`;
  };

  openBtn?.addEventListener("click", () => {
    dialog.showModal();
    renderResults();
    input?.focus();
  });

  closeBtn?.addEventListener("click", () => dialog.close());
  input?.addEventListener("input", () => renderResults(input.value));
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
  renderTicker();
  renderMarkets();
  renderIdeas();
  drawHeroChart();
  setupSearch();
  window.addEventListener("resize", drawHeroChart);
});