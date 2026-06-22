const ForexFactory = (() => {
  const LIVE_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
  const BUNDLED_URL = "data/ff_calendar.json";
  const PROXY = "https://api.allorigins.win/raw?url=";
  const IMPACT_RANK = { High: 0, Medium: 1, Low: 2 };

  const DEFAULT_PROFILE = { newsCurrencies: ["USD"], newsKeywords: [] };

  let calendarPromise = null;
  let calendarCache = [];
  let profileMap = null;

  async function loadProfiles() {
    if (profileMap) return profileMap;
    profileMap = new Map();
    try {
      const response = await fetch("data/symbols.json");
      if (response.ok) {
        const list = await response.json();
        list.forEach((entry) => profileMap.set(entry.symbol, entry));
      }
    } catch {
      /* optional catalog */
    }
    return profileMap;
  }

  function profileFor(symbol, market = null) {
    const catalog = profileMap?.get(symbol);
    const source = market?.newsCurrencies || market?.newsKeywords ? market : catalog || market;
    if (source?.newsCurrencies || source?.newsKeywords) {
      return {
        newsCurrencies: source.newsCurrencies || DEFAULT_PROFILE.newsCurrencies,
        newsKeywords: source.newsKeywords || []
      };
    }
    return DEFAULT_PROFILE;
  }

  async function fetchLive() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${PROXY}${encodeURIComponent(LIVE_URL)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("Invalid calendar payload");
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchBundled() {
    const response = await fetch(BUNDLED_URL);
    if (!response.ok) throw new Error("Bundled calendar unavailable");
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.events || [];
  }

  async function loadCalendar({ preferLive = true } = {}) {
    if (calendarCache.length) return calendarCache;
    if (!calendarPromise) {
      calendarPromise = (async () => {
        try {
          const bundled = await fetchBundled();
          calendarCache = bundled;
          if (preferLive) {
            try {
              calendarCache = await fetchLive();
            } catch {
              /* keep bundled */
            }
          }
          return calendarCache;
        } catch (error) {
          if (preferLive) {
            calendarCache = await fetchLive();
            return calendarCache;
          }
          throw error;
        }
      })();
    }
    return calendarPromise;
  }

  function eventMatches(event, profile) {
    const currencies = profile.newsCurrencies || DEFAULT_PROFILE.newsCurrencies;
    const keywords = (profile.newsKeywords || []).map((k) => k.toLowerCase());
    const title = String(event.title || "").toLowerCase();
    if (keywords.length && keywords.some((k) => title.includes(k))) return true;
    if (!currencies.includes(event.country)) return false;
    if (!keywords.length) return true;
    return event.impact === "High";
  }

  function inRelevantWindow(dateValue) {
    const ts = new Date(dateValue).getTime();
    if (Number.isNaN(ts)) return false;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return ts >= now - day && ts <= now + 7 * day;
  }

  function filterForSymbol(symbol, market = null, events = calendarCache) {
    const profile = profileFor(symbol, market);
    return events
      .filter((event) => inRelevantWindow(event.date) && eventMatches(event, profile))
      .sort((a, b) => {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        const ia = IMPACT_RANK[a.impact] ?? 3;
        const ib = IMPACT_RANK[b.impact] ?? 3;
        if (ia !== ib) return ia - ib;
        return ta - tb;
      })
      .slice(0, 8);
  }

  function formatEventTime(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function impactClass(impact) {
    if (impact === "High") return "ff-impact-high";
    if (impact === "Medium") return "ff-impact-medium";
    return "ff-impact-low";
  }

  function renderFeed(symbol, market = null, events) {
    const feed = document.getElementById("newsFeed");
    const label = document.getElementById("newsFeedLabel");
    if (!feed) return;

    const profile = profileFor(symbol, market);
    const currencies = profile.newsCurrencies.join(", ");
    const keywords = profile.newsKeywords.length ? ` · ${profile.newsKeywords.join(", ")}` : "";
    if (label) {
      label.textContent = `Forex Factory · ${symbol} · ${currencies}${keywords}`;
    }

    if (!events.length) {
      feed.innerHTML = `<p class="news-empty">No matching Forex Factory events this week for ${symbol}.</p>`;
      return;
    }

    feed.innerHTML = events
      .map(
        (event) => `
        <article>
          <div class="news-meta">
            <time>${formatEventTime(event.date)}</time>
            <span class="ff-impact ${impactClass(event.impact)}">${event.impact}</span>
            <span class="ff-currency">${event.country}</span>
          </div>
          <p><strong>${event.title}</strong></p>
          <p class="news-detail">${[event.forecast && `Forecast ${event.forecast}`, event.previous && `Prev ${event.previous}`]
            .filter(Boolean)
            .join(" · ") || "Economic calendar event"}</p>
        </article>`
      )
      .join("");
  }

  async function updateForSymbol(symbol, market = null) {
    const feed = document.getElementById("newsFeed");
    if (!feed) return;
    feed.innerHTML = `<p class="news-empty">Loading Forex Factory calendar…</p>`;
    try {
      await loadProfiles();
      const events = await loadCalendar();
      const matched = filterForSymbol(symbol, market, events);
      renderFeed(symbol, market, matched);
    } catch (error) {
      feed.innerHTML = `<p class="news-empty">Forex Factory calendar unavailable (${error.message}).</p>`;
    }
  }

  function clearCache() {
    calendarPromise = null;
    calendarCache = [];
  }

  return {
    loadCalendar,
    filterForSymbol,
    updateForSymbol,
    clearCache
  };
})();

window.ForexFactory = ForexFactory;