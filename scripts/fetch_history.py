#!/usr/bin/env python3
"""Download historical OHLCV bars from Yahoo Finance into data/history/."""

from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "history"
MANIFEST_PATH = ROOT / "data" / "manifest.json"

SYMBOLS_PATH = ROOT / "data" / "symbols.json"


def load_symbols() -> list[dict]:
    return json.loads(SYMBOLS_PATH.read_text(encoding="utf-8"))

INTERVALS = {
    "2m": {"interval": "2m", "range": "5d"},
    "5m": {"interval": "5m", "range": "5d"},
    "15m": {"interval": "15m", "range": "5d"},
    "1h": {"interval": "1h", "range": "2y"},
    "1d": {"interval": "1d", "range": "5y"},
    "1wk": {"interval": "1wk", "range": "10y"},
}

USER_AGENT = "Mozilla/5.0 (compatible; SeanMarkets/1.0; +https://github.com/glmorris1/sean-markets)"


def fetch_chart(yahoo_symbol: str, interval: str, range_: str) -> dict:
    query = urllib.parse.urlencode({"interval": interval, "range": range_})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(yahoo_symbol)}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, context=context, timeout=30) as response:
        payload = json.load(response)
    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    timestamps = result["timestamp"] or []
    candles = []
    for index, ts in enumerate(timestamps):
        open_ = quote["open"][index]
        high = quote["high"][index]
        low = quote["low"][index]
        close = quote["close"][index]
        volume = quote["volume"][index]
        if None in (open_, high, low, close):
            continue
        is_intraday = interval not in {"1d", "1wk", "1mo", "5d"}
        bar_time: int | str = ts if is_intraday else datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        candles.append(
            {
                "time": bar_time,
                "open": round(open_, 4),
                "high": round(high, 4),
                "low": round(low, 4),
                "close": round(close, 4),
                "volume": int(volume or 0),
            }
        )
    return {
        "candles": candles,
        "currency": result["meta"].get("currency"),
        "exchangeName": result["meta"].get("exchangeName"),
    }


def format_volume(value: int) -> str:
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return str(value)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()
    manifest = {"fetchedAt": fetched_at, "source": "Yahoo Finance", "symbols": []}

    for entry in load_symbols():
        daily_key = f"{entry['symbol']}_1d"
        daily_path = OUT_DIR / f"{daily_key}.json"
        daily = fetch_chart(entry["yahoo"], INTERVALS["1d"]["interval"], INTERVALS["1d"]["range"])
        daily_payload = {
            "symbol": entry["symbol"],
            "name": entry["name"],
            "exchange": entry["exchange"],
            "interval": "1d",
            "source": "Yahoo Finance",
            "fetchedAt": fetched_at,
            "candles": daily["candles"],
        }
        daily_path.write_text(json.dumps(daily_payload, indent=2), encoding="utf-8")
        print(f"Wrote {daily_path.name} ({len(daily['candles'])} bars)")

        for key, cfg in INTERVALS.items():
            if key == "1d":
                continue
            file_key = f"{entry['symbol']}_{key}"
            path = OUT_DIR / f"{file_key}.json"
            chart = fetch_chart(entry["yahoo"], cfg["interval"], cfg["range"])
            payload = {
                "symbol": entry["symbol"],
                "name": entry["name"],
                "exchange": entry["exchange"],
                "interval": key,
                "source": "Yahoo Finance",
                "fetchedAt": fetched_at,
                "candles": chart["candles"],
            }
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(f"Wrote {path.name} ({len(chart['candles'])} bars)")

        last = daily["candles"][-1]
        prev = daily["candles"][-2]
        change = ((last["close"] - prev["close"]) / prev["close"]) * 100
        manifest["symbols"].append(
            {
                "symbol": entry["symbol"],
                "name": entry["name"],
                "exchange": entry["exchange"],
                "yahoo": entry["yahoo"],
                "assetClass": entry.get("assetClass", "stock"),
                "price": last["close"],
                "change": round(change, 2),
                "volume": format_volume(last["volume"]),
            }
        )

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote manifest with {len(manifest['symbols'])} symbols")


if __name__ == "__main__":
    main()