/**
 * ChintasMoney Worker.
 * Serves the static site (via the ASSETS binding) and adds a small
 * /api/quotes endpoint that fetches real NSE quotes server-side (no CORS),
 * so the homepage ticker can show actual figures. Results are edge-cached ~60s.
 */

const SYMBOLS = [
  { y: "^NSEI", name: "NIFTY 50" },
  { y: "^NSEBANK", name: "BANK NIFTY" },
  { y: "RELIANCE.NS", name: "RELIANCE" },
  { y: "TCS.NS", name: "TCS" },
  { y: "HDFCBANK.NS", name: "HDFC BANK" },
  { y: "INFY.NS", name: "INFY" },
  { y: "TATAMOTORS.NS", name: "TATA MOTORS" },
];

// Broader large/mid-cap universe for the "top movers" strip.
const MOVERS = [
  ["RELIANCE.NS", "RELIANCE"], ["TCS.NS", "TCS"], ["HDFCBANK.NS", "HDFC BANK"], ["INFY.NS", "INFOSYS"],
  ["ICICIBANK.NS", "ICICI BANK"], ["SBIN.NS", "SBI"], ["AXISBANK.NS", "AXIS BANK"], ["KOTAKBANK.NS", "KOTAK"],
  ["ITC.NS", "ITC"], ["LT.NS", "L&T"], ["BHARTIARTL.NS", "AIRTEL"], ["HINDUNILVR.NS", "HUL"],
  ["MARUTI.NS", "MARUTI"], ["SUNPHARMA.NS", "SUN PHARMA"], ["TATAMOTORS.NS", "TATA MOTORS"],
  ["TATASTEEL.NS", "TATA STEEL"], ["ADANIENT.NS", "ADANI ENT"], ["BAJFINANCE.NS", "BAJAJ FIN"],
  ["WIPRO.NS", "WIPRO"], ["ZOMATO.NS", "ZOMATO"],
];

function fmtIN(n) {
  if (n == null || isNaN(n)) return "—";
  const x = Number(n).toFixed(2);
  const parts = x.split(".");
  let int = parts[0];
  const neg = int.startsWith("-");
  if (neg) int = int.slice(1);
  let lastThree = int.slice(-3);
  let other = int.slice(0, -3);
  if (other) lastThree = "," + lastThree;
  other = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg ? "-" : "") + other + lastThree + "." + parts[1];
}

async function oneQuote(s) {
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(s.y) +
      "?interval=1d&range=1d";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
    if (!m) return null;
    const price = m.regularMarketPrice;
    const prev = m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose;
    if (price == null || prev == null) return null;
    const change = price - prev;
    const pct = prev ? (change / prev) * 100 : 0;
    return { name: s.name, price: fmtIN(price), change: change, changePct: pct.toFixed(2) };
  } catch (e) {
    return null;
  }
}

function jsonRes(obj, maxAge) {
  // maxAge === 0 → do not cache (used for transient upstream errors).
  return new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge === 0 ? "no-store" : "public, max-age=" + (maxAge || 60),
      "access-control-allow-origin": "*",
    },
  });
}

async function handleQuotes() {
  const results = (await Promise.all(SYMBOLS.map(oneQuote))).filter(Boolean);
  return jsonRes({ quotes: results, at: Date.now() });
}

// OHLC candles for a symbol, fetched server-side from Yahoo (works for NSE
// indices ^NSEI/^NSEBANK, ^BSESN, and .NS stocks) so charts don't depend on
// TradingView's gated embeds. Powers the live trade-preview chart.
async function handleCandles(url) {
  const raw = (url.searchParams.get("symbol") || "").trim();
  if (!raw || raw.length > 24 || !/^[\^A-Za-z0-9.\-=]+$/.test(raw)) return jsonRes({ error: "bad symbol" }, 0);
  const range = /^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|max)$/.test(url.searchParams.get("range") || "") ? url.searchParams.get("range") : "3mo";
  const interval = range === "1d" || range === "5d" ? "15m" : "1d";
  try {
    const y = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(raw) +
      "?interval=" + interval + "&range=" + range;
    const r = await fetch(y, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!r.ok) return jsonRes({ error: "fetch failed" }, 0);
    const j = await r.json();
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    const ts = res && res.timestamp, q = res && res.indicators && res.indicators.quote && res.indicators.quote[0];
    if (!ts || !q) return jsonRes({ error: "no data" }, 0);
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
      candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
    }
    return jsonRes({ symbol: raw, candles: candles, at: Date.now() }, 120);
  } catch (e) { return jsonRes({ error: "error" }, 0); }
}

async function handleMovers() {
  const all = (await Promise.all(MOVERS.map(function (m) {
    return oneQuote({ y: m[0], name: m[1] });
  }))).filter(Boolean).map(function (q) {
    return { name: q.name, price: q.price, changePct: Number(q.changePct) };
  });
  all.sort(function (a, b) { return b.changePct - a.changePct; });
  const gainers = all.filter(function (q) { return q.changePct >= 0; }).slice(0, 5);
  const losers = all.filter(function (q) { return q.changePct < 0; }).slice(-5).reverse();
  return jsonRes({ gainers: gainers, losers: losers, at: Date.now() }, 120);
}

// ---- Razorpay: server-side order creation + signature verification --------
// Prices are authoritative HERE (in paise) so the browser can never change the
// amount. Secrets come from Worker env vars (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET),
// set in the Cloudflare dashboard — never committed to the repo.
const RZP_PRODUCTS = {
  plus:    { amount: 19900, type: "plan",   plan: "plus",    label: "ChintasMoney · Go Plus (monthly)" },
  pro:     { amount: 49900, type: "plan",   plan: "pro",     label: "ChintasMoney · Platinum (monthly)" },
  diamond: { amount: 99900, type: "plan",   plan: "diamond", label: "ChintasMoney · Diamond (monthly)" },
  tok20:   { amount: 4900,  type: "tokens", tokens: 20,      label: "ChintasMoney · 20 analysis tokens" },
  tok60:   { amount: 9900,  type: "tokens", tokens: 60,      label: "ChintasMoney · 60 analysis tokens" },
  tok150:  { amount: 19900, type: "tokens", tokens: 150,     label: "ChintasMoney · 150 analysis tokens" },
};

async function handleRzpOrder(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return jsonRes({ error: "payments not configured" }, 0);
  let body; try { body = await request.json(); } catch (e) { return jsonRes({ error: "bad request" }, 0); }
  const p = RZP_PRODUCTS[body && body.product];
  if (!p) return jsonRes({ error: "unknown product" }, 0);
  const auth = "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
  const r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: p.amount, currency: "INR", receipt: "cm_" + Date.now(), notes: { product: body.product } }),
  });
  if (!r.ok) return jsonRes({ error: "order failed" }, 0);
  const order = await r.json();
  return jsonRes({ orderId: order.id, amount: p.amount, currency: "INR", keyId: env.RAZORPAY_KEY_ID, product: body.product, label: p.label }, 0);
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

async function handleRzpVerify(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return jsonRes({ error: "payments not configured" }, 0);
  let b; try { b = await request.json(); } catch (e) { return jsonRes({ error: "bad request" }, 0); }
  const orderId = b && b.order_id, paymentId = b && b.payment_id, sig = b && b.signature;
  if (!orderId || !paymentId || !sig) return jsonRes({ valid: false }, 0);
  // 1) Verify the payment signature (proves the payment belongs to this order).
  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, orderId + "|" + paymentId);
  if (expected.length !== sig.length) return jsonRes({ valid: false }, 0);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return jsonRes({ valid: false }, 0);
  // 2) Re-read the order from Razorpay and trust ITS product + amount — never
  // the client's, so a cheap order can't claim an expensive grant.
  const auth = "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
  const r = await fetch("https://api.razorpay.com/v1/orders/" + encodeURIComponent(orderId), { headers: { Authorization: auth } });
  if (!r.ok) return jsonRes({ valid: false }, 0);
  const order = await r.json();
  const product = order && order.notes && order.notes.product;
  const p = RZP_PRODUCTS[product];
  if (!p || order.amount !== p.amount) return jsonRes({ valid: false }, 0);
  const grant = p.type === "plan" ? { plan: p.plan } : { tokens: p.tokens };
  return jsonRes({ valid: true, product: product, grant: grant }, 0);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/razorpay/order") return handleRzpOrder(request, env);
    if (request.method === "POST" && url.pathname === "/api/razorpay/verify") return handleRzpVerify(request, env);
    if (url.pathname === "/api/quotes" || url.pathname === "/api/movers" || url.pathname === "/api/candles") {
      const cache = caches.default;
      let res = await cache.match(request);
      if (!res) {
        res = url.pathname === "/api/movers" ? await handleMovers()
            : url.pathname === "/api/candles" ? await handleCandles(url)
            : await handleQuotes();
        // Don't cache transient error responses (they carry no-store).
        if (!/no-store/.test(res.headers.get("cache-control") || "")) ctx.waitUntil(cache.put(request, res.clone()));
      }
      return res;
    }
    return env.ASSETS.fetch(request);
  },
};
