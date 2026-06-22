# Sean Markets

Sean is a static clone of [TradingView](https://www.tradingview.com/) — rebranded as **Sean** — with a marketing homepage and a charting workspace backed by **real historical market data**.

## Data

Historical OHLCV bars are downloaded from **Yahoo Finance** and stored in `data/history/` as JSON. This is ideal for backtesting: the chart loads real past prices, not simulated data.

Supported intervals (bundled):

| UI | File suffix | History |
|----|-------------|---------|
| D  | `_1d`       | ~5 years daily |
| 1h | `_1h`       | ~2 years hourly |
| W  | `_1wk`      | ~10 years weekly |

Symbols: AAPL, MSFT, TSLA, NVDA, META, SPY, BTCUSD, ETHUSD

### Refresh data

```sh
python3 scripts/fetch_history.py
```

Re-run this script whenever you want updated historical bars, then commit and push.

## Pages

- `index.html` — Landing page with live quotes from `data/manifest.json`
- `chart.html` — Chart terminal with date-range filtering for backtests

## Run locally

```sh
python3 -m http.server 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## GitHub Pages

`https://glmorris1.github.io/sean-markets/`