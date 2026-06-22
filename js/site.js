let MARKETS = [];

const IDEAS = [
  { symbol: "AAPL", title: "Apple holding key support ahead of earnings", bias: "Long", author: "ChartCraft" },
  { symbol: "BTCUSD", title: "Bitcoin range breakout setup on 4H", bias: "Long", author: "CryptoPulse" },
  { symbol: "NVDA", title: "Semiconductor pullback into demand zone", bias: "Long", author: "TechTrends" },
  { symbol: "TSLA", title: "Cup-and-handle measured move to $765", bias: "Long", author: "MomentumLab" },
  { symbol: "SPY", title: "Index breadth improving into month-end", bias: "Long", author: "MacroView" },
  { symbol: "ETHUSD", title: "ETH losing momentum at resistance cluster", bias: "Short", author: "ChainSignals" },
  { symbol: "ES", title: "E-mini S&P holding above overnight VWAP", bias: "Long", author: "FuturesDesk" }
];

function money(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const fixed = num.toFixed(2);
  const [whole, fraction] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function changeClass(change) {
  return change >= 0 ? "positive" : "negative";
}

function formatChange(change) {
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function drawSparkFromCloses(canvas, closes, bullish = true) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const series = closes.slice(-80);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const step = w / Math.max(1, series.length - 1);
  const scaleY = (v) => 12 + ((max - v) / (max - min)) * (h - 24);
  const color = bullish ? "#26a69a" : "#ef5350";

  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bullish ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.2)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  series.forEach((close, i) => {
    const x = i * step;
    const y = scaleY(close);
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
  series.forEach((close, i) => {
    const x = i * step;
    const y = scaleY(close);
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
  grid.innerHTML = MARKETS.map((m) => `
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
  grid.innerHTML = IDEAS.map((idea) => {
    const market = MARKETS.find((m) => m.symbol === idea.symbol);
    const bullish = idea.bias === "Long";
    return `
      <article class="idea-card">
        <div class="idea-thumb"><canvas data-symbol="${idea.symbol}" data-bullish="${bullish}"></canvas></div>
        <div class="idea-body">
          <div class="idea-meta">
            <span>${idea.symbol}</span>
            <span class="idea-badge">${idea.bias}</span>
          </div>
          <h3>${idea.title}</h3>
          <p>by ${idea.author}${market ? ` · ${formatChange(market.change)}` : ""}</p>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("canvas").forEach(async (canvas) => {
    try {
      const response = await fetch(`data/history/${canvas.dataset.symbol}_1d.json`);
      const payload = await response.json();
      const closes = payload.candles.map((c) => c.close);
      drawSparkFromCloses(canvas, closes, canvas.dataset.bullish === "true");
    } catch {
      drawSparkFromCloses(canvas, [1, 1.02, 1.01, 1.04, 1.03], true);
    }
  });
}

async function drawHeroChart() {
  const canvas = document.getElementById("heroChart");
  if (!canvas) return;
  try {
    const response = await fetch("data/history/AAPL_1d.json");
    const payload = await response.json();
    drawSparkFromCloses(canvas, payload.candles.map((c) => c.close), true);
    const aapl = MARKETS.find((m) => m.symbol === "AAPL");
    if (aapl) {
      const card = document.querySelector(".orbit-card.main .orbit-header");
      if (card) {
        card.innerHTML = `<span>AAPL</span><strong class="${changeClass(aapl.change)}">${formatChange(aapl.change)}</strong>`;
      }
    }
  } catch {
    drawSparkFromCloses(canvas, [1, 1.02, 1.01, 1.04, 1.03], true);
  }
}

function setupSearch() {
  const dialog = document.getElementById("searchDialog");
  const openBtn = document.getElementById("openSearch");
  const closeBtn = document.getElementById("closeSearch");
  const input = document.getElementById("globalSearch");
  const results = document.getElementById("searchResults");

  const renderResults = (query = "") => {
    const hits = MARKETS.filter((m) =>
      `${m.symbol} ${m.name} ${m.yahoo || ""} ${m.assetClass || ""}`.toLowerCase().includes(query.toLowerCase())
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

function updateHeroSideCards() {
  const btc = MARKETS.find((m) => m.symbol === "BTCUSD");
  const spy = MARKETS.find((m) => m.symbol === "SPY");
  const cards = document.querySelectorAll(".orbit-card.side");
  if (btc && cards[0]) {
    cards[0].innerHTML = `<span>BTCUSD</span><strong>${money(btc.price)}</strong><em class="${changeClass(btc.change)}">${formatChange(btc.change)}</em>`;
  }
  if (spy && cards[1]) {
    cards[1].innerHTML = `<span>SPY</span><strong>${money(spy.price)}</strong><em class="${changeClass(spy.change)}">${formatChange(spy.change)}</em>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) window.lucide.createIcons();

  try {
    const response = await fetch("data/manifest.json");
    const manifest = await response.json();
    MARKETS = manifest.symbols;
  } catch {
    MARKETS = [];
  }

  renderTicker();
  renderMarkets();
  renderIdeas();
  updateHeroSideCards();
  await drawHeroChart();
  setupSearch();
  window.addEventListener("resize", drawHeroChart);
});