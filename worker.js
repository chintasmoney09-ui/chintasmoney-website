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

// ---- Admin: server-side login + cross-user data (Supabase service-role) -----
// Auth is a signed, expiring token (HMAC-SHA256). Secrets are Worker env vars
// set in the Cloudflare dashboard — never committed:
//   ADMIN_USER (optional, default "chintasmoney")
//   ADMIN_PASSWORD           — the owner's admin password
//   ADMIN_SESSION_SECRET     — random string used to sign session tokens
//   SUPABASE_URL             — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Supabase "service_role" key (server-only!)
function aRes(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
function ctEq(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64url(s) { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function ub64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return atob(s); }
async function signToken(secret, payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacHex(secret, body);
  return body + "." + sig;
}
async function verifyToken(secret, token) {
  if (!token || token.indexOf(".") === -1) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = await hmacHex(secret, parts[0]);
  if (!ctEq(expected, parts[1])) return null;
  let payload; try { payload = JSON.parse(ub64url(parts[0])); } catch (e) { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

async function handleAdminLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return aRes({ error: "not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const wantUser = env.ADMIN_USER || "chintasmoney";
  const okUser = ctEq(b && b.user, wantUser);
  const okPass = ctEq(b && b.password, env.ADMIN_PASSWORD);
  if (!okUser || !okPass) return aRes({ error: "invalid_credentials" }, 401);
  const token = await signToken(env.ADMIN_SESSION_SECRET, { sub: "admin", exp: Date.now() + 12 * 3600 * 1000 });
  return aRes({ token: token }, 200);
}

function emailFor(id, users) {
  for (let i = 0; i < users.length; i++) if (users[i].id === id) return users[i].email || "";
  return "";
}
async function handleAdminData(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return aRes({ error: "not_configured" }, 501);
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(env.ADMIN_SESSION_SECRET, token);
  if (!payload) return aRes({ error: "unauthorized" }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ error: "supabase_not_configured" }, 501);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };

  // 1) All auth users (email, created_at, last_sign_in_at). GoTrue caps page
  //    size (~50), so page through until a short/empty page. Bounded for safety.
  let users = [];
  try {
    for (let page = 1; page <= 200; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break;
      const uj = await ur.json();
      const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break;
      users = users.concat(batch);
      if (batch.length < 50) break; // last (partial) page reached
    }
  } catch (e) {}

  // 2) Per-user app state (plan, persona, AI usage) from user_state.
  const states = {};
  try {
    const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data,updated_at", { headers: h });
    if (sr.ok) (await sr.json()).forEach(function (row) { states[row.user_id] = row; });
  } catch (e) {}

  // 3) Verified payments (invoices) + refunds, if the tables are populated.
  let payments = [];
  try {
    const pr = await fetch(base + "/rest/v1/payments?select=*&order=created_at.desc", { headers: h });
    if (pr.ok) payments = await pr.json();
  } catch (e) {}
  let refundRows = [];
  try {
    const rr = await fetch(base + "/rest/v1/refunds?select=*&order=created_at.desc", { headers: h });
    if (rr.ok) refundRows = await rr.json();
  } catch (e) {}

  const outUsers = users.map(function (u) {
    const st = (states[u.id] && states[u.id].data) || {};
    const prof = st.profile || {};
    return {
      name: prof.name || (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || "").split("@")[0] || "User",
      email: u.email || u.phone || "",
      plan: prof.plan || "free",
      persona: prof.persona || "—",
      joined: (u.created_at || "").slice(0, 10),
      last: (u.last_sign_in_at || "").slice(0, 10),
      ai: (st.usage && st.usage.aiQuestions) || 0,
      status: "active",
    };
  });
  const invoices = payments.map(function (p) {
    return { id: p.razorpay_payment_id || ("PAY-" + p.id), email: p.email || emailFor(p.user_id, users),
      product: p.product || p.plan || "plan", amount: Math.round((p.amount || 0) / 100),
      date: (p.created_at || "").slice(0, 10), status: p.status || "paid", method: p.method || "Razorpay" };
  });
  const refunds = refundRows.map(function (r) {
    return { id: r.razorpay_refund_id || ("RF-" + r.id), invoice: r.razorpay_payment_id || "",
      email: r.email || "", product: r.product || "", amount: Math.round((r.amount || 0) / 100),
      reason: r.reason || "", date: (r.created_at || "").slice(0, 10) };
  });
  return aRes({ users: outUsers, invoices: invoices, refunds: refunds, totalUsers: outUsers.length }, 200);
}

// ---- Razorpay webhook: record verified payments/refunds into Supabase -------
// Configure in Razorpay → Settings → Webhooks: URL https://<site>/api/razorpay/webhook,
// events payment.captured, refund.created, refund.processed. The secret you set
// there must match the Worker secret RAZORPAY_WEBHOOK_SECRET. Signature = HMAC
// SHA-256 of the RAW request body with that secret (compared to x-razorpay-signature).
async function sbHeaders(env, extra) {
  return Object.assign({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }, extra || {});
}
async function handleRzpWebhook(request, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return aRes({ error: "not_configured" }, 501);
  const raw = await request.text();
  const sig = request.headers.get("x-razorpay-signature") || "";
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
  if (!ctEq(expected, sig)) return aRes({ error: "bad_signature" }, 401);
  let ev; try { ev = JSON.parse(raw); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  // Acknowledge even if storage isn't wired, so Razorpay doesn't keep retrying.
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ ok: true, stored: false }, 200);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const type = ev && ev.event;
  try {
    if (type === "payment.captured" || type === "order.paid") {
      const p = (ev.payload && ev.payload.payment && ev.payload.payment.entity) || null;
      if (p) {
        const product = (p.notes && p.notes.product) || null;
        const row = {
          razorpay_payment_id: p.id, razorpay_order_id: p.order_id || null,
          email: p.email || "", product: product, plan: product,
          amount: p.amount, currency: p.currency || "INR", method: p.method || "Razorpay",
          status: "paid", created_at: new Date((p.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        };
        await fetch(base + "/rest/v1/payments?on_conflict=razorpay_payment_id",
          { method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }), body: JSON.stringify(row) });
      }
    } else if (type === "refund.created" || type === "refund.processed") {
      const r = (ev.payload && ev.payload.refund && ev.payload.refund.entity) || null;
      if (r) {
        const row = {
          razorpay_refund_id: r.id, razorpay_payment_id: r.payment_id || "",
          email: "", product: null, amount: r.amount, reason: (r.notes && r.notes.reason) || "refund",
          status: "refunded", created_at: new Date((r.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        };
        await fetch(base + "/rest/v1/refunds?on_conflict=razorpay_refund_id",
          { method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }), body: JSON.stringify(row) });
        // Mark the original payment refunded (and copy email/product onto the refund).
        if (r.payment_id) {
          const pr = await fetch(base + "/rest/v1/payments?razorpay_payment_id=eq." + encodeURIComponent(r.payment_id) + "&select=email,product",
            { method: "PATCH", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "return=representation" }), body: JSON.stringify({ status: "refunded" }) });
          if (pr.ok) { const arr = await pr.json(); if (arr && arr[0]) {
            await fetch(base + "/rest/v1/refunds?razorpay_refund_id=eq." + encodeURIComponent(r.id),
              { method: "PATCH", headers: await sbHeaders(env, { "content-type": "application/json" }), body: JSON.stringify({ email: arr[0].email || "", product: arr[0].product || null }) });
          } }
        }
      }
    }
  } catch (e) { /* acknowledged; a failed write is retried by Razorpay */ }
  return aRes({ ok: true }, 200);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/razorpay/webhook") return handleRzpWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/login") return handleAdminLogin(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/data") return handleAdminData(request, env);
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
