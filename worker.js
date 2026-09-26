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

// Rupee string from paise, for emails/receipts.
function rupees(paise) { return "₹" + (Math.round(paise) / 100).toLocaleString("en-IN"); }

// Upsert one verified payment into Supabase (idempotent on razorpay_payment_id).
// Used by BOTH the verify endpoint (immediate, has the signed-in email) and the
// Razorpay webhook (authoritative), so a payment is recorded even if one path
// is delayed or fails. Safe no-op when Supabase isn't configured.
async function recordPayment(env, row) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  try {
    await fetch(base + "/rest/v1/payments?on_conflict=razorpay_payment_id", {
      method: "POST",
      headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(row),
    });
  } catch (e) { /* best effort — the webhook retries the canonical write */ }
}

// ---- Branded email system (Resend) -----------------------------------------
const SUPPORT_EMAIL = "chintasmoney@gmail.com";
const LOGO_URL = "https://chintasmoney.com/assets/logo-full.png";
const APP_URL = "https://chintasmoney.com/app/";
const SITE_URL = "https://chintasmoney.com";

// What each product really is — for a professional B2C receipt.
function productDesc(product) {
  const M = {
    plus:    { name: "Go Plus", service: "Full trading-behaviour analytics, unlimited journaling & the AI Discipline Coach", duration: "1 month (renews monthly)" },
    pro:     { name: "Platinum", service: "Everything in Go Plus, plus unlimited AI analyses, broker import, setup performance & weekly reports", duration: "1 month (renews monthly)" },
    diamond: { name: "Diamond", service: "Everything in Platinum, plus priority AI, a monthly 1:1 discipline review & multi-year backtesting", duration: "1 month (renews monthly)" },
    tok20:   { name: "Analysis Token Pack", service: "20 deep Trade Replay analyses of your own trades", duration: "No expiry — use anytime" },
    tok60:   { name: "Analysis Token Pack", service: "60 deep Trade Replay analyses of your own trades", duration: "No expiry — use anytime" },
    tok150:  { name: "Analysis Token Pack", service: "150 deep Trade Replay analyses of your own trades", duration: "No expiry — use anytime" },
  };
  return M[product] || { name: "ChintasMoney subscription", service: "Trading-behaviour analytics service", duration: "1 month" };
}

// Shared branded shell: logo header + warm footer with support + links.
function emailShell(inner) {
  return '<div style="background:#f4f6fb;padding:24px 0;font-family:system-ui,Segoe UI,Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebf5">' +
    '<div style="background:linear-gradient(135deg,#0b1533,#1e2a5a);padding:22px 24px;text-align:center">' +
    '<img src="' + LOGO_URL + '" alt="ChintasMoney" style="height:38px;max-width:220px" />' +
    '<div style="color:#a9b6da;font-size:11px;letter-spacing:.14em;margin-top:6px">TRADER REPORT CARD</div></div>' +
    '<div style="padding:26px 24px;color:#0f1730">' + inner + '</div>' +
    '<div style="background:#0b1533;padding:18px 24px;color:#a9b6da;font-size:12px;line-height:1.7">' +
    '<b style="color:#fff">ChintasMoney</b> · reduce your losses by understanding your behaviour.<br>' +
    'Support: <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#7cc7ff">' + SUPPORT_EMAIL + '</a> · ' +
    '<a href="' + SITE_URL + '" style="color:#7cc7ff">chintasmoney.com</a> · ' +
    '<a href="' + SITE_URL + '/refund.html" style="color:#7cc7ff">Refund policy</a><br>' +
    '<span style="color:#6f83ab">Behaviour analysis of your own trades. Not investment advice — no buy/sell tips. F&amp;O is risky.</span>' +
    '</div></div></div>';
}

async function sendEmail(env, o) {
  if (!env.RESEND_API_KEY || !env.RECEIPT_FROM || !o || !o.to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: env.RECEIPT_FROM, to: [o.to], subject: o.subject, html: o.html, reply_to: SUPPORT_EMAIL }),
    });
  } catch (e) { /* best-effort */ }
}

// Professional invoice + warm welcome, in one email, on every purchase.
async function sendReceiptEmail(env, o) {
  if (!env.RESEND_API_KEY || !env.RECEIPT_FROM || !o || !o.email) return;
  const d = new Date();
  const when = d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const amt = rupees(o.amount);
  const desc = productDesc(o.product);
  const invNo = "CM-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(o.paymentId || "").slice(-6).toUpperCase();
  const row = function (k, v) { return '<tr><td style="padding:9px 0;color:#5b6b8c;border-bottom:1px solid #eef2f7">' + k + '</td><td style="padding:9px 0;text-align:right;font-weight:600;border-bottom:1px solid #eef2f7">' + v + '</td></tr>'; };
  const inner =
    '<h2 style="margin:0 0 4px;font-size:1.35rem">Thank you for your purchase 🎉</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 6px">You just took a real step toward mastering your trading behaviour — and we\'re honoured to be part of that journey. Welcome aboard. You\'re officially a <b style="color:#0f1730">ChintasMoney star customer</b> ⭐</p>' +
    '<p style="color:#5b6b8c;margin:0 0 20px">Here is your official receipt.</p>' +
    '<div style="border:1px solid #e6ebf5;border-radius:12px;padding:4px 18px 10px">' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    row("Invoice number", esc(invNo)) +
    row("Date", esc(when)) +
    row("Billed to", esc(o.email)) +
    row("Plan / product", '<b>' + esc(desc.name) + '</b>') +
    row("Service", esc(desc.service)) +
    row("Duration", esc(desc.duration)) +
    row("Payment reference", esc(o.paymentId || "—")) +
    '<tr><td style="padding:12px 0 4px;font-size:1.05rem;font-weight:800">Total paid</td><td style="padding:12px 0 4px;text-align:right;font-size:1.15rem;font-weight:800;color:#16a34a">' + amt + '</td></tr>' +
    '</table></div>' +
    '<div style="text-align:center;margin:22px 0 8px">' +
    '<a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Open your app →</a></div>' +
    '<p style="color:#5b6b8c;font-size:13px;text-align:center;margin:6px 0 0">Your account: <b>' + esc(o.email) + '</b> · sign in any time at <a href="' + APP_URL + '" style="color:#12b39a">chintasmoney.com/app</a></p>' +
    '<p style="color:#5b6b8c;font-size:14px;margin:22px 0 0">Thank you for investing in your own discipline. This is the first step of a calmer, clearer trading journey — we\'re cheering you on. 💚<br><br>— Team ChintasMoney</p>';
  await sendEmail(env, { to: o.email, subject: "Your ChintasMoney receipt — " + desc.name + " (" + amt + ")", html: emailShell(inner) });
}

// Warm welcome email on first sign-up / sign-in.
async function sendWelcomeEmail(env, email) {
  if (!email) return;
  const inner =
    '<h2 style="margin:0 0 6px;font-size:1.35rem">Welcome to ChintasMoney 👋</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">We\'re so glad you\'re here. You\'ve just taken the first step most traders never take — choosing to understand <b style="color:#0f1730">why</b> you trade the way you do, not just what the market did.</p>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">ChintasMoney is your honest mirror: a Discipline Score, your Trader Personality, the exact habits costing you money, and a coach that keeps you accountable. No tips, no noise — just you, getting better.</p>' +
    '<div style="text-align:center;margin:22px 0 10px">' +
    '<a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Start your report card →</a></div>' +
    '<p style="color:#5b6b8c;font-size:13px;text-align:center;margin:6px 0 0">Your account: <b>' + esc(email) + '</b></p>' +
    '<p style="color:#5b6b8c;font-size:14px;margin:22px 0 0">You are our star ⭐ — thank you for supporting yourself on this trading-behaviour journey. We can\'t wait to see your discipline grow.<br><br>— Team ChintasMoney</p>';
  await sendEmail(env, { to: email, subject: "Welcome to ChintasMoney ⭐ — your journey starts now", html: emailShell(inner) });
}

// Minimal HTML escape for email fields (worker has no shared esc for this).
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

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
  // Record the verified payment immediately (fallback to the webhook) and email
  // the buyer a receipt. Both are best-effort and never block the grant.
  const email = (b && typeof b.email === "string") ? b.email.trim() : "";
  await recordPayment(env, {
    razorpay_payment_id: paymentId, razorpay_order_id: orderId,
    email: email, product: product, plan: product,
    amount: p.amount, currency: "INR", method: "Razorpay",
    status: "paid", created_at: new Date().toISOString(),
  });
  await sendReceiptEmail(env, { email: email, product: product, label: p.label, amount: p.amount, paymentId: paymentId });
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
      id: u.id,
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

// ---- Admin write actions (all require a valid admin session token) ---------
async function requireAdmin(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return { err: aRes({ error: "not_configured" }, 501) };
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(env.ADMIN_SESSION_SECRET, token);
  if (!payload) return { err: aRes({ error: "unauthorized" }, 401) };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { err: aRes({ error: "supabase_not_configured" }, 501) };
  return { base: env.SUPABASE_URL.replace(/\/$/, "") };
}

// Refund a payment through Razorpay, then record it. body: { payment_id, amount? (paise, optional = full) }
async function handleAdminRefund(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return aRes({ error: "payments_not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const paymentId = b && b.payment_id;
  if (!paymentId) return aRes({ error: "missing_payment_id" }, 400);
  const auth = "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
  const payload = {}; if (b.amount) payload.amount = b.amount; // partial refund if amount given
  const rr = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/refund", {
    method: "POST", headers: { Authorization: auth, "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const rj = await rr.json().catch(function () { return {}; });
  if (!rr.ok) return aRes({ error: "refund_failed", detail: (rj && rj.error && rj.error.description) || "Razorpay rejected the refund" }, 400);
  // Record the refund and mark the payment refunded (idempotent).
  const base = gate.base;
  try {
    // Copy email/product from the original payment onto the refund row.
    let email = "", product = null;
    const pr = await fetch(base + "/rest/v1/payments?razorpay_payment_id=eq." + encodeURIComponent(paymentId) + "&select=email,product", { headers: await sbHeaders(env) });
    if (pr.ok) { const arr = await pr.json(); if (arr && arr[0]) { email = arr[0].email || ""; product = arr[0].product || null; } }
    await recordRefund(env, {
      razorpay_refund_id: rj.id, razorpay_payment_id: paymentId, email: email, product: product,
      amount: rj.amount, reason: (b.reason || "admin refund"), status: rj.status || "refunded", created_at: new Date().toISOString(),
    });
    await fetch(base + "/rest/v1/payments?razorpay_payment_id=eq." + encodeURIComponent(paymentId), {
      method: "PATCH", headers: await sbHeaders(env, { "content-type": "application/json" }), body: JSON.stringify({ status: "refunded" }),
    });
  } catch (e) { /* refund already succeeded at Razorpay; recording is best-effort */ }
  return aRes({ ok: true, refund: { id: rj.id, amount: rj.amount, status: rj.status } }, 200);
}

async function recordRefund(env, row) {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  try {
    await fetch(base + "/rest/v1/refunds?on_conflict=razorpay_refund_id", {
      method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }), body: JSON.stringify(row),
    });
  } catch (e) {}
}

// Edit a user's profile (name / plan) and optionally grant tokens.
// body: { user_id, name?, plan?, tokensDelta? }
async function handleAdminUpdateUser(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const userId = b && b.user_id;
  if (!userId) return aRes({ error: "missing_user_id" }, 400);
  const base = gate.base;
  // Read the current state row (if any).
  let data = { profile: {} };
  const sr = await fetch(base + "/rest/v1/user_state?user_id=eq." + encodeURIComponent(userId) + "&select=data", { headers: await sbHeaders(env) });
  if (sr.ok) { const arr = await sr.json(); if (arr && arr[0] && arr[0].data) data = arr[0].data; }
  if (!data.profile || typeof data.profile !== "object") data.profile = {};
  if (typeof b.name === "string") data.profile.name = b.name;
  if (typeof b.plan === "string" && ["free", "plus", "pro", "diamond"].indexOf(b.plan) !== -1) {
    data.profile.plan = b.plan; data.profile.plan_since = new Date().toISOString();
  }
  if (b.tokensDelta) data.profile.tokens = Math.max(0, (data.profile.tokens || 0) + Number(b.tokensDelta));
  // Upsert the row (create if the user has never synced).
  const up = await fetch(base + "/rest/v1/user_state?on_conflict=user_id", {
    method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: userId, data: data, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return aRes({ error: "update_failed" }, 400);
  return aRes({ ok: true, profile: data.profile }, 200);
}

// Email an invoice/receipt for an existing payment. body: { payment_id }
async function handleAdminSendInvoice(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const paymentId = b && b.payment_id;
  if (!paymentId) return aRes({ error: "missing_payment_id" }, 400);
  if (!env.RESEND_API_KEY || !env.RECEIPT_FROM) return aRes({ error: "email_not_configured", detail: "Set RESEND_API_KEY and RECEIPT_FROM in Cloudflare to email invoices." }, 501);
  const base = gate.base;
  const pr = await fetch(base + "/rest/v1/payments?razorpay_payment_id=eq." + encodeURIComponent(paymentId) + "&select=*", { headers: await sbHeaders(env) });
  if (!pr.ok) return aRes({ error: "lookup_failed" }, 400);
  const arr = await pr.json(); const p = arr && arr[0];
  if (!p) return aRes({ error: "payment_not_found" }, 404);
  const email = (b.email && String(b.email)) || p.email || "";
  if (!email) return aRes({ error: "no_email", detail: "This payment has no customer email on record." }, 400);
  await sendReceiptEmail(env, { email: email, product: p.product || p.plan, label: p.product || p.plan, amount: p.amount, paymentId: paymentId });
  return aRes({ ok: true, sentTo: email }, 200);
}

// Live Razorpay mirror — read straight from Razorpay so the admin always
// matches Razorpay exactly. GET /api/admin/razorpay?resource=payments|refunds|settlements|disputes
async function handleAdminRazorpay(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return aRes({ error: "payments_not_configured" }, 501);
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "payments";
  const allowed = { payments: "payments", refunds: "refunds", settlements: "settlements", disputes: "disputes" };
  const path = allowed[resource];
  if (!path) return aRes({ error: "bad_resource" }, 400);
  const auth = "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
  const r = await fetch("https://api.razorpay.com/v1/" + path + "?count=100", { headers: { Authorization: auth } });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) return aRes({ error: "razorpay_error", detail: (j && j.error && j.error.description) || "Razorpay request failed" }, 400);
  return aRes({ ok: true, resource: resource, items: j.items || [], count: j.count || 0 }, 200);
}

// ---- Weekly email report (Platinum/Diamond) --------------------------------
// Runs on the cron trigger. Emails each paid user a short discipline summary of
// their own last-7-days trades. Best-effort; needs Resend + Supabase configured.
function tradePnl(t) { var dir = /sell/i.test(t.side || "") ? -1 : 1; return dir * ((+t.exit || 0) - (+t.entry || 0)) * (+t.qty || 0); }
function tradeDisc(t) {
  var s = 100;
  if (t.plannedSL == null || t.plannedSL === "") s -= 40;
  if (!/target|stop-loss/i.test(t.exit_reason || "")) s -= 25;
  if (/revenge|fomo|fear|greed|bored/i.test((t.exit_reason || "") + (t.emotion || ""))) s -= 25;
  return Math.max(0, s);
}
function weekStats(trades) {
  var now = Date.now(), wk = 7 * 864e5;
  var recent = (trades || []).filter(function (t) { var tm = new Date(t.date).getTime(); return isFinite(tm) && tm >= now - wk; });
  if (!recent.length) return null;
  var wins = recent.filter(function (t) { return tradePnl(t) > 0; }).length;
  var disc = Math.round(recent.reduce(function (a, t) { return a + tradeDisc(t); }, 0) / recent.length);
  var noSL = recent.filter(function (t) { return t.plannedSL == null || t.plannedSL === ""; }).length;
  var pnl = recent.reduce(function (a, t) { return a + tradePnl(t); }, 0);
  return { n: recent.length, wins: wins, winRate: Math.round(wins / recent.length * 100), disc: disc, noSL: noSL, pnl: Math.round(pnl) };
}
async function sendWeeklyEmail(env, o) {
  if (!env.RESEND_API_KEY || !env.RECEIPT_FROM || !o.email) return;
  var s = o.stats;
  var rw = function (k, v) { return '<tr><td style="padding:9px 0;color:#5b6b8c;border-bottom:1px solid #eef2f7">' + k + '</td><td style="padding:9px 0;text-align:right;font-weight:700;border-bottom:1px solid #eef2f7">' + v + '</td></tr>'; };
  var inner =
    '<h2 style="margin:0 0 4px;font-size:1.3rem">Your week in trading 📊</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 18px">Hi ' + esc(o.name || "trader") + ', here\'s your discipline summary for the last 7 days.</p>' +
    '<div style="border:1px solid #e6ebf5;border-radius:12px;padding:4px 18px 10px"><table style="width:100%;border-collapse:collapse;font-size:14px">' +
    rw("Discipline score", '<span style="font-size:1.05rem">' + s.disc + ' / 100</span>') +
    rw("Trades logged", s.n) + rw("Win rate", s.winRate + "%") + rw("Trades without a stop-loss", s.noSL) +
    '</table></div>' +
    '<div style="text-align:center;margin:22px 0 6px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Open your full report →</a></div>' +
    '<p style="color:#5b6b8c;font-size:13px;margin:18px 0 0">Keep showing up — discipline compounds. We\'re proud of you. 💚<br>— Team ChintasMoney</p>';
  await sendEmail(env, { to: o.email, subject: "Your weekly discipline report — score " + s.disc + "/100", html: emailShell(inner) });
}
async function sendWeeklyReports(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  // Map user_id -> email from auth.
  const emails = {};
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break;
      const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break;
      batch.forEach(function (u) { emails[u.id] = u.email; });
      if (batch.length < 200) break;
    }
  } catch (e) {}
  // Paid users' state → weekly stats → email.
  try {
    const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h });
    if (!sr.ok) return;
    const rows = await sr.json();
    for (const row of rows) {
      const data = row.data || {}; const prof = data.profile || {};
      if (prof.plan !== "pro" && prof.plan !== "diamond") continue;
      const stats = weekStats(data.trades || []);
      if (!stats) continue; // nothing logged this week
      const email = emails[row.user_id];
      if (!email) continue;
      await sendWeeklyEmail(env, { email: email, name: prof.name, stats: stats });
    }
  } catch (e) {}
}

// Welcome email on first sign-in. Client calls this once per new account.
async function handleWelcome(request, env) {
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const email = b && typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.indexOf("@") === -1) return aRes({ error: "bad_email" }, 400);
  await sendWelcomeEmail(env, email);
  return aRes({ ok: true }, 200);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendWeeklyReports(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/razorpay/webhook") return handleRzpWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/api/welcome") return handleWelcome(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/razorpay") return handleAdminRazorpay(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/login") return handleAdminLogin(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/data") return handleAdminData(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/refund") return handleAdminRefund(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/update-user") return handleAdminUpdateUser(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/send-invoice") return handleAdminSendInvoice(request, env);
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
