/**
 * ChintasMoney Worker.
 * Serves the static site (via the ASSETS binding) and adds a small
 * /api/quotes endpoint that fetches real NSE quotes server-side (no CORS),
 * so the homepage ticker can show actual figures. Results are edge-cached ~60s.
 */

const SYMBOLS = [
  { y: "^NSEI", name: "NIFTY 50" },
  { y: "^NSEBANK", name: "BANK NIFTY" },
  { y: "^BSESN", name: "SENSEX" },
  { y: "GC=F", name: "GOLD" },
  { y: "CL=F", name: "CRUDE OIL" },
  { y: "INR=X", name: "USD/INR" },
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
  plus:    { amount: 19900, type: "plan",   plan: "plus",    months: 1,  label: "ChintasMoney · Go Plus (monthly)" },
  pro:     { amount: 49900, type: "plan",   plan: "pro",     months: 1,  label: "ChintasMoney · Platinum (monthly)" },
  diamond: { amount: 99900, type: "plan",   plan: "diamond", months: 1,  label: "ChintasMoney · Diamond (monthly)" },
  // Yearly plans — pay for 10 months, get 12 (2 months free). Higher LTV + cash.
  plus_yr:    { amount: 199000, type: "plan", plan: "plus",    months: 12, label: "ChintasMoney · Go Plus (yearly)" },
  pro_yr:     { amount: 499000, type: "plan", plan: "pro",     months: 12, label: "ChintasMoney · Platinum (yearly)" },
  diamond_yr: { amount: 999000, type: "plan", plan: "diamond", months: 12, label: "ChintasMoney · Diamond (yearly)" },
  // Token top-up packs (valid 2 months). Prices per the token model.
  tok400:  { amount: 19900,  type: "tokens", tokens: 400,   label: "ChintasMoney · 400 tokens (₹199)" },
  tok700:  { amount: 49900,  type: "tokens", tokens: 700,   label: "ChintasMoney · 700 tokens (₹499)" },
  tok1600: { amount: 99900,  type: "tokens", tokens: 1600,  label: "ChintasMoney · 1600 tokens (₹999)" },
  tok3000: { amount: 200000, type: "tokens", tokens: 3000,  label: "ChintasMoney · 3000 tokens (₹2000)" },
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
const OWNER_EMAIL = "chintasmoney@gmail.com"; // where owner alerts go (override with env.OWNER_EMAIL)
const LOGO_URL = "https://chintasmoney.com/assets/logo-full.png";
const WELCOME_BANNER = "https://chintasmoney.com/assets/email-welcome-banner.png";
const MILESTONE_BANNER = "https://chintasmoney.com/assets/email-milestone-banner.png";
// Branded plan badge (pro maps to the Platinum badge art).
function planBadgeUrl(plan) {
  var f = plan === "pro" ? "platinum" : (plan === "diamond" ? "diamond" : "plus");
  return "https://chintasmoney.com/assets/badge-" + f + ".png";
}
// A full-width banner image row for the top of an email.
function emailBanner(url) {
  return '<div style="margin:0 0 16px"><img src="' + url + '" alt="ChintasMoney" width="536" style="width:100%;max-width:536px;height:auto;border-radius:12px;display:block"/></div>';
}
const APP_URL = "https://chintasmoney.com/app/";
const SITE_URL = "https://chintasmoney.com";

// Alert the owner (you) by email — new signups, new payments — so you never
// have to check the admin panel. No-op unless Resend is configured.
async function sendOwnerAlert(env, subject, innerHtml) {
  var to = (env && env.OWNER_EMAIL) || OWNER_EMAIL;
  await sendEmail(env, { to: to, subject: subject, html: emailShell(innerHtml) });
}

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
// The full, accurate list of what each plan unlocks — for the welcome email so
// customers see everything they get (trades, tokens, every premium feature).
function planFeatureLines(plan) {
  const F = {
    plus: [
      "🎟️ 600 tokens every month (~20 trade logs) + a free 30-token daily bonus",
      "✅ Unlimited journal history",
      "💸 Money Leak Report — where your money quietly bleeds",
      "🔍 Full mistake analysis",
      "🔥 Streaks & badges + Pro shareable card",
    ],
    pro: [
      "✅ Everything in Go Plus",
      "🎟️ 1200 tokens every month (~40 trade logs)",
      "🕐 Time & Day edge",
      "📊 Setup / strategy performance",
      "🎓 Trade Grades (A–F on every trade)",
      "📐 Edge & Expectancy",
      "📏 Rules & Adherence tracking",
      "🎬 Trade Replay on real charts",
      "📥 Broker CSV import/export",
      "📧 Weekly email + monthly deep-dive report",
    ],
    diamond: [
      "✅ Everything in Platinum",
      "🎟️ 3000 tokens every month (~100 trade logs)",
      "🤖 AI Discipline Coach — available only on Diamond",
      "🔮 What-If Simulator + 📖 Personal Trading Playbook",
      "👑 Priority AI + a monthly 1:1 discipline review",
      "🗄️ Multi-year backtesting + 🚀 early access",
    ],
  };
  return F[plan] || null;
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
    '<a href="' + SITE_URL + '/refund" style="color:#7cc7ff">Refund policy</a><br>' +
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
    emailBanner(WELCOME_BANNER) +
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

// Warm welcome-to-premium email, sent automatically when someone buys a plan.
async function sendSubWelcomeEmail(env, o) {
  if (!o || !o.email || !o.plan) return;
  var d = productDesc(o.plan);
  var feats = planFeatureLines(o.plan) || ["Full mistake analysis", "Your AI trading coach", "Deeper analytics & history"];
  var firstName = o.name ? String(o.name).trim().split(/\s+/)[0] : "";
  var greet = firstName ? "Hi " + esc(firstName) + " 👋" : "Welcome aboard 👋";
  var inner =
    '<div style="text-align:center;margin:0 0 10px"><img src="' + planBadgeUrl(o.plan) + '" alt="' + esc(d ? d.name : o.plan) + '" width="150" style="width:150px;max-width:60%;height:auto"/></div>' +
    '<p style="color:#0f1730;font-weight:700;font-size:1.05rem;margin:0 0 6px">' + greet + '</p>' +
    '<h2 style="margin:0 0 6px;font-size:1.4rem">You\'re now on ' + esc(d ? d.name : o.plan) + ' 🎉</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Thank you for subscribing — and welcome to the ChintasMoney family. You\'ve just given your trading the one edge that actually compounds: <b>discipline</b>. We\'re honoured to be part of your journey. 💚</p>' +
    '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 16px;margin:0 0 16px">' +
    '<div style="font-weight:800;color:#166534;margin-bottom:8px">What\'s unlocked for you now:</div>' +
    '<ul style="margin:0;padding-left:18px;color:#166534;line-height:1.8">' + feats.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + '</ul></div>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Here\'s the best first move: open the app, log your recent trades honestly, and let your Discipline Score show you exactly what to fix first.</p>' +
    '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Open your app →</a></div>' +
    '<p style="color:#5b6b8c;font-size:14px;margin:20px 0 0">Any question at all, just reply to this email — a real person reads every one.<br>To calmer, sharper trading. 💚<br>— Team ChintasMoney</p>';
  await sendEmail(env, { to: o.email, subject: "🎉 Welcome to ChintasMoney " + (d ? d.name : "Premium") + " — you're all set!", html: emailShell(inner) });
}

// ===========================================================================
//  LIFECYCLE EMAILS — the right message at the right moment, sent once each.
//  Milestone-based (never one-per-click) so it builds trust, not spam.
// ===========================================================================
function lifeCta(txt) {
  return '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">' + txt + ' →</a></div>';
}
function lifeSign() {
  return '<p style="color:#5b6b8c;font-size:14px;margin:20px 0 0">We\'re rooting for you. Reply anytime — a real person reads every email. 💚<br>— Team ChintasMoney</p>';
}
// Returns {subject, inner} for a milestone, or null.
function lifecycleEmail(kind, firstName) {
  var hi = firstName ? "Hi " + esc(firstName) + " 👋" : "Hey 👋";
  var head = '<p style="color:#0f1730;font-weight:700;font-size:1.05rem;margin:0 0 6px">' + hi + '</p>';
  var T = {
    firstTrade: {
      subject: "🎯 Your first trade is logged — here's what happens next",
      inner: head + '<h2 style="margin:0 0 6px;font-size:1.35rem">Nice — your first trade is in! 🎯</h2>' +
        '<p style="color:#5b6b8c;margin:0 0 14px">That\'s the hardest step, and you took it. Every trade you log makes your Discipline Score smarter about <b>your</b> patterns — where you size too big, hold losers, or jump in without a stop.</p>' +
        '<p style="color:#5b6b8c;margin:0 0 14px">Log 5 and your first real insights unlock. Keep going. 💪</p>' + lifeCta("Log another trade") + lifeSign()
    },
    fiveTrades: {
      subject: "🔥 5 trades in — your patterns are showing",
      inner: emailBanner(MILESTONE_BANNER) + head + '<h2 style="margin:0 0 6px;font-size:1.35rem">5 trades logged — you\'re building the habit 🔥</h2>' +
        '<p style="color:#5b6b8c;margin:0 0 14px">This is where it gets interesting. Open your <b>Insights</b> and <b>Trade Grades</b> to see exactly where your money leaks — and the one fix that lifts your score the fastest.</p>' + lifeCta("See my insights") + lifeSign()
    },
    tenTrades: {
      subject: "🏆 10 trades — you're in the top few % who actually journal",
      inner: head + '<h2 style="margin:0 0 6px;font-size:1.35rem">10 trades logged — that\'s real discipline 🏆</h2>' +
        '<p style="color:#5b6b8c;margin:0 0 14px">Most traders never journal a single trade. You\'ve done ten. Your report is now rich enough for the AI coach to spot your biggest edge and your costliest habit. Go ask it: "what should I fix first?"</p>' + lifeCta("Ask my AI coach") + lifeSign()
    },
    firstDream: {
      subject: "💭 Your money dream is set — now let's protect it",
      inner: head + '<h2 style="margin:0 0 6px;font-size:1.35rem">Love it — your dream is in the planner 💭</h2>' +
        '<p style="color:#5b6b8c;margin:0 0 14px">A goal you can see is a goal you protect. The traders who hit theirs are the disciplined ones — and that\'s exactly what ChintasMoney trains. Keep logging, keep your risk small, and let it compound.</p>' + lifeCta("Open my dream plan") + lifeSign()
    }
  };
  return T[kind] || null;
}
async function sendLifecycleEmail(env, kind, o) {
  var t = lifecycleEmail(kind, o && o.name ? String(o.name).trim().split(/\s+/)[0] : "");
  if (!t || !o || !o.email) return;
  await sendEmail(env, { to: o.email, subject: t.subject, html: emailShell(t.inner) });
}
// Thank-you when someone buys an analysis token pack.
async function sendTokenWelcomeEmail(env, o) {
  if (!o || !o.email) return;
  var firstName = o.name ? String(o.name).trim().split(/\s+/)[0] : "";
  var hi = firstName ? "Hi " + esc(firstName) + " 👋" : "Hey 👋";
  var inner =
    '<p style="color:#0f1730;font-weight:700;font-size:1.05rem;margin:0 0 6px">' + hi + '</p>' +
    '<h2 style="margin:0 0 6px;font-size:1.35rem">Your ' + (o.tokens ? esc(String(o.tokens)) + " " : "") + 'analysis tokens are ready 🎟️</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Thank you! Each token runs a deep Trade Replay on one of your own trades — turning a gut feeling into a clear lesson. Spend them on your most confusing trades first; that\'s where the biggest breakthroughs hide.</p>' +
    lifeCta("Run an analysis") + lifeSign();
  await sendEmail(env, { to: o.email, subject: "🎟️ Your ChintasMoney tokens are ready", html: emailShell(inner) });
}
// Endpoint the app pings; sends any newly-earned milestone email, once each.
async function handleLifecycle(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ ok: false }, 200);
  const authz = request.headers.get("Authorization") || "";
  const userTok = authz.replace(/^Bearer\s+/i, "").trim();
  if (!userTok) return aRes({ ok: false }, 200);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  let user;
  try {
    const ur = await fetch(base + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + userTok } });
    if (!ur.ok) return aRes({ ok: false }, 200);
    user = await ur.json();
  } catch (e) { return aRes({ ok: false }, 200); }
  const uid = user && user.id, email = user && user.email;
  if (!uid || !email) return aRes({ ok: false }, 200);
  // Load state.
  let data = { profile: {} };
  try {
    const sr = await fetch(base + "/rest/v1/user_state?user_id=eq." + encodeURIComponent(uid) + "&select=data", { headers: await sbHeaders(env) });
    if (sr.ok) { const arr = await sr.json(); if (arr && arr[0] && arr[0].data) data = arr[0].data; }
  } catch (e) {}
  const prof = data.profile || {};
  const name = prof.name || "";
  const trades = Array.isArray(data.trades) ? data.trades.length : 0;
  const dreams = Array.isArray(data.dreams) ? data.dreams.length : 0;
  // Which milestones are reached now?
  const due = [];
  if (trades >= 1) due.push("firstTrade");
  if (trades >= 5) due.push("fiveTrades");
  if (trades >= 10) due.push("tenTrades");
  if (dreams >= 1) due.push("firstDream");
  if (!due.length) return aRes({ ok: true, sent: 0 }, 200);
  // Dedupe via email_log (one row per user+kind). Read what was already sent.
  let already = {};
  try {
    const lr = await fetch(base + "/rest/v1/email_log?user_id=eq." + encodeURIComponent(uid) + "&select=kind", { headers: await sbHeaders(env) });
    if (lr.ok) (await lr.json()).forEach(function (r) { already[r.kind] = true; });
  } catch (e) {}
  let sent = 0;
  for (const kind of due) {
    if (already[kind]) continue;
    // Claim the slot first (unique index stops duplicates across races).
    let claimed = false;
    try {
      const ins = await fetch(base + "/rest/v1/email_log?on_conflict=user_id,kind", {
        method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }),
        body: JSON.stringify({ user_id: uid, kind: kind, email: email, created_at: new Date().toISOString() }),
      });
      if (ins.ok) { const rows = await ins.json().catch(function () { return []; }); claimed = Array.isArray(rows) && rows.length > 0; }
    } catch (e) {}
    if (!claimed) continue; // someone else already claimed it — skip
    await sendLifecycleEmail(env, kind, { email: email, name: name });
    sent++;
  }
  return aRes({ ok: true, sent: sent }, 200);
}
// ---- Entitlement: the AUTHORITATIVE plan for the signed-in account ----------
// Security: a plan is granted ONLY to the exact email that paid (or an admin
// override), read server-side from the payments table — never from the client's
// local state. This stops one Google account's paid plan showing up on a
// different Google account signed in on the same device/browser.
// Fail-SAFE: `ok` is true only when we actually read the payments table, so a
// transient error can never silently downgrade a real payer (the app keeps its
// current plan when ok is false).
const PLAN_RANK_W = { free: 0, plus: 1, pro: 2, diamond: 3 };
const ENTITLEMENT_PERIOD_MS = 33 * 86400000; // a monthly plan stays active ~33 days
async function handleEntitlement(request, env) {
  const out = { ok: false, plan: "free", source: "none", paidUntil: null, email: null };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes(out, 200);
  const authz = request.headers.get("Authorization") || "";
  const userTok = authz.replace(/^Bearer\s+/i, "").trim();
  if (!userTok) return aRes(out, 200);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  let user;
  try {
    const ur = await fetch(base + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + userTok } });
    if (!ur.ok) return aRes(out, 200);
    user = await ur.json();
  } catch (e) { return aRes(out, 200); }
  const email = user && user.email; if (!email) return aRes(out, 200);
  out.email = email;
  const now = Date.now();
  // 1) Plan derived from verified payments for THIS email (last ~33 days).
  let bestPlan = "free", paidUntil = null, determined = false;
  try {
    const pr = await fetch(base + "/rest/v1/payments?select=plan,status,created_at,period_days&email=eq." + encodeURIComponent(email) + "&order=created_at.desc", { headers: await sbHeaders(env) });
    if (pr.ok) {
      determined = true;
      const rows = await pr.json();
      (rows || []).forEach(function (r) {
        if (!r || (r.status && r.status !== "paid")) return;
        const plan = r.plan; if (PLAN_RANK_W[plan] == null || plan === "free") return; // only plan rows
        const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
        const period = (r.period_days ? r.period_days : 33) * 86400000; // yearly vs monthly
        if (now - ts > period) return; // subscription period lapsed
        if (PLAN_RANK_W[plan] > PLAN_RANK_W[bestPlan]) { bestPlan = plan; paidUntil = new Date(ts + period).toISOString(); }
      });
    }
  } catch (e) { /* determined stays false → app keeps current plan */ }
  if (bestPlan !== "free") { out.plan = bestPlan; out.source = "payment"; out.paidUntil = paidUntil; }
  // 2) Admin override (optional `entitlements` table: email, plan, until, tokens).
  //    Lets the owner promote/degrade an account from the admin panel. Wins when
  //    active and at least as high as the payment-derived plan.
  try {
    const er = await fetch(base + "/rest/v1/entitlements?select=plan,until,tokens,updated_at&email=eq." + encodeURIComponent(email.toLowerCase()) + "&order=updated_at.desc&limit=1", { headers: await sbHeaders(env) });
    if (er.ok) {
      determined = true;
      const ent = (await er.json())[0];
      if (ent && ent.plan != null && PLAN_RANK_W[ent.plan] != null) {
        const active = !ent.until || new Date(ent.until).getTime() > now;
        // An active admin entitlement is AUTHORITATIVE — it can raise OR lower the
        // plan (e.g. a manual upgrade, or a downgrade after a refund).
        if (active) {
          out.plan = ent.plan; out.source = "admin"; if (ent.until) out.paidUntil = ent.until; if (ent.tokens) out.grantTokens = ent.tokens;
        }
      }
    }
  } catch (e) {}
  out.ok = determined;
  return aRes(out, 200);
}

// ---- Server-authoritative token wallet --------------------------------------
// The client meters tokens for UX; THIS is the source of truth the Worker
// enforces for server-compute actions (the AI coach), so a tampered browser
// can't drain real API spend. Mirrors the client token model.
const SV_PLAN_TOKENS = { free: 150, plus: 600, pro: 1200, diamond: 3000 };
const SV_DAILY_BONUS = 30;
const SV_WALLET_TTL_MS = 60 * 86400000;
// Resolve the authoritative plan for an email (payments + admin entitlements).
async function serverResolvePlan(env, email) {
  if (!email || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return "free";
  const base = env.SUPABASE_URL.replace(/\/$/, ""), now = Date.now();
  let plan = "free";
  try {
    const pr = await fetch(base + "/rest/v1/payments?select=plan,status,created_at,period_days&email=eq." + encodeURIComponent(email) + "&order=created_at.desc", { headers: await sbHeaders(env) });
    if (pr.ok) (await pr.json() || []).forEach(function (r) {
      if (!r || (r.status && r.status !== "paid")) return;
      if (PLAN_RANK_W[r.plan] == null || r.plan === "free") return;
      var ts = r.created_at ? new Date(r.created_at).getTime() : 0;
      var period = (r.period_days ? r.period_days : 33) * 86400000;
      if (now - ts <= period && PLAN_RANK_W[r.plan] > PLAN_RANK_W[plan]) plan = r.plan;
    });
  } catch (e) {}
  try {
    const er = await fetch(base + "/rest/v1/entitlements?select=plan,until&email=eq." + encodeURIComponent(email.toLowerCase()) + "&order=updated_at.desc&limit=1", { headers: await sbHeaders(env) });
    if (er.ok) { const ent = (await er.json())[0]; if (ent && PLAN_RANK_W[ent.plan] != null) { var active = !ent.until || new Date(ent.until).getTime() > now; if (active) plan = ent.plan; } }
  } catch (e) {}
  return plan;
}
// Load the token row, applying the monthly grant, daily bonus and wallet expiry.
// Returns { acct, total } or null if the table/DB is unavailable (caller fail-opens).
async function tokenAccountRefresh(env, uid, email, plan) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const base = env.SUPABASE_URL.replace(/\/$/, ""), now = new Date();
  var acct = null;
  try {
    const r = await fetch(base + "/rest/v1/token_accounts?user_id=eq." + encodeURIComponent(uid) + "&select=*", { headers: await sbHeaders(env) });
    if (!r.ok) return null; // table missing / error → fail-open
    acct = (await r.json())[0] || { user_id: uid, email: email, plan_month: null, plan_tokens: 0, bonus_day: null, bonus_tokens: 0, wallet: [] };
  } catch (e) { return null; }
  var grant = SV_PLAN_TOKENS[plan] != null ? SV_PLAN_TOKENS[plan] : SV_PLAN_TOKENS.free;
  var mk = now.getFullYear() + "-" + now.getMonth();
  if (acct.plan_month !== mk) { acct.plan_month = mk; acct.plan_tokens = grant; }
  else if (acct.plan_tokens < grant) { acct.plan_tokens = grant; } // mid-month upgrade top-up
  var dk = now.toISOString().slice(0, 10);
  if (acct.bonus_day !== dk) { acct.bonus_day = dk; acct.bonus_tokens = SV_DAILY_BONUS; }
  var tnow = Date.now();
  acct.wallet = (acct.wallet || []).filter(function (b) { return b && b.n > 0 && b.exp > tnow; });
  acct.email = email;
  var total = (acct.bonus_tokens || 0) + (acct.plan_tokens || 0) + acct.wallet.reduce(function (a, b) { return a + (b.n || 0); }, 0);
  return { acct: acct, total: total };
}
async function tokenAccountSave(env, acct) {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  acct.updated_at = new Date().toISOString();
  try {
    await fetch(base + "/rest/v1/token_accounts?on_conflict=user_id", {
      method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(acct),
    });
  } catch (e) {}
}
// Debit `need` tokens server-side (bonus → monthly → wallet). Returns {ok,balance}.
// Fail-OPEN: if the ledger is unavailable, allow the action (never block a payer).
async function tokenSpendServer(env, uid, email, plan, need) {
  const rr = await tokenAccountRefresh(env, uid, email, plan);
  if (!rr) return { ok: true, balance: null, failOpen: true };
  if (rr.total < need) return { ok: false, balance: rr.total };
  var a = rr.acct, rem = need;
  var b = Math.min(a.bonus_tokens || 0, rem); a.bonus_tokens -= b; rem -= b;
  if (rem > 0) { var m = Math.min(a.plan_tokens || 0, rem); a.plan_tokens -= m; rem -= m; }
  if (rem > 0) { a.wallet.sort(function (x, y) { return x.exp - y.exp; }); for (var i = 0; i < a.wallet.length && rem > 0; i++) { var t = Math.min(a.wallet[i].n, rem); a.wallet[i].n -= t; rem -= t; } a.wallet = a.wallet.filter(function (x) { return x.n > 0; }); }
  await tokenAccountSave(env, a);
  return { ok: true, balance: rr.total - need };
}
// Credit purchased top-up tokens to the server wallet (valid 2 months).
async function tokenCreditServer(env, uid, email, plan, n) {
  if (!(n > 0)) return;
  const rr = await tokenAccountRefresh(env, uid, email, plan);
  if (!rr) return;
  rr.acct.wallet.push({ n: n, exp: Date.now() + SV_WALLET_TTL_MS, at: Date.now() });
  await tokenAccountSave(env, rr.acct);
}
// GET /api/tokens — authoritative balance for the signed-in user.
async function handleTokensGet(request, env) {
  const authz = request.headers.get("Authorization") || "";
  const tok = authz.replace(/^Bearer\s+/i, "").trim();
  if (!tok || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ ok: false }, 200);
  let user;
  try {
    const ur = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + tok } });
    if (!ur.ok) return aRes({ ok: false }, 200);
    user = await ur.json();
  } catch (e) { return aRes({ ok: false }, 200); }
  if (!user || !user.id) return aRes({ ok: false }, 200);
  const plan = await serverResolvePlan(env, user.email);
  const rr = await tokenAccountRefresh(env, user.id, user.email, plan);
  if (!rr) return aRes({ ok: false }, 200);
  await tokenAccountSave(env, rr.acct);
  return aRes({ ok: true, plan: plan, total: rr.total, bonus: rr.acct.bonus_tokens, monthly: rr.acct.plan_tokens, wallet: rr.acct.wallet.reduce(function (a, b) { return a + b.n; }, 0) }, 200);
}
async function handleRzpVerify(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return jsonRes({ error: "payments not configured" }, 0);
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
    // Store the BASE plan ("plus"/"pro"/"diamond") so the entitlement resolver
    // reads it directly, plus how long this payment entitles (monthly vs yearly).
    email: email, product: product, plan: (p.type === "plan" ? p.plan : product),
    period_days: p.type === "plan" ? (p.months === 12 ? 380 : 33) : null,
    amount: p.amount, currency: "INR", method: "Razorpay",
    status: "paid", created_at: new Date().toISOString(),
  });
  // For token top-ups, credit the purchased tokens to the SERVER wallet so they
  // are spendable on server-enforced features (the AI coach). Authoritative: the
  // product + amount were just re-read from Razorpay above, so the token count is
  // trusted. We resolve the buyer's uid from their Supabase auth token (sent by
  // the client); best-effort — a failure here never blocks the client grant.
  if (p.type === "tokens" && p.tokens > 0 && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const authz = request.headers.get("Authorization") || "";
      const utok = authz.replace(/^Bearer\s+/i, "").trim();
      if (utok) {
        const ur = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + utok } });
        if (ur.ok) {
          const user = await ur.json();
          if (user && user.id) {
            const plan = await serverResolvePlan(env, user.email);
            await tokenCreditServer(env, user.id, user.email, plan, p.tokens);
          }
        }
      }
    } catch (e) { /* best-effort; client still gets the grant */ }
  }
  await sendReceiptEmail(env, { email: email, product: product, label: p.label, amount: p.amount, paymentId: paymentId });
  if (p.type === "plan" && email) await sendSubWelcomeEmail(env, { email: email, plan: p.plan });
  if (p.type === "tokens" && email) await sendTokenWelcomeEmail(env, { email: email, tokens: p.tokens });
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
  let leadRows = [];
  try {
    const lr = await fetch(base + "/rest/v1/leads?select=*&order=created_at.desc&limit=1000", { headers: h });
    if (lr.ok) leadRows = await lr.json();
  } catch (e) {}
  let pushCount = 0;
  try {
    const pr = await fetch(base + "/rest/v1/push_subscriptions?select=endpoint", { headers: Object.assign({}, h, { Prefer: "count=exact", Range: "0-0" }) });
    const cr = pr.headers.get("content-range");
    if (cr && cr.indexOf("/") !== -1) pushCount = parseInt(cr.split("/")[1], 10) || 0;
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
      referrals: prof.referrals || 0,
      referredBy: prof.referredBy || "",
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
  const leads = leadRows.map(function (l) {
    return { email: l.email || "", source: l.source || "—", note: l.note || "", date: (l.created_at || "").slice(0, 10) };
  });
  return aRes({ users: outUsers, invoices: invoices, refunds: refunds, leads: leads, pushCount: pushCount, totalUsers: outUsers.length }, 200);
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
        const pr = RZP_PRODUCTS[product];
        const row = {
          razorpay_payment_id: p.id, razorpay_order_id: p.order_id || null,
          // Store base plan + entitlement period (yearly vs monthly), matching verify.
          email: p.email || "", product: product, plan: (pr && pr.type === "plan" ? pr.plan : product),
          period_days: (pr && pr.type === "plan") ? (pr.months === 12 ? 380 : 33) : null,
          amount: p.amount, currency: p.currency || "INR", method: p.method || "Razorpay",
          status: "paid", created_at: new Date((p.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        };
        await fetch(base + "/rest/v1/payments?on_conflict=razorpay_payment_id",
          { method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }), body: JSON.stringify(row) });
        // Alert the owner instantly.
        await sendOwnerAlert(env, "💰 New payment " + rupees(p.amount) + " — ChintasMoney",
          '<h2 style="margin:0 0 6px">💰 You got paid!</h2>' +
          '<p style="color:#5b6b8c;margin:0 0 12px">A new payment just came in.</p>' +
          '<div style="border:1px solid #e6ebf5;border-radius:12px;padding:14px 16px;font-size:14px">' +
          '<b style="font-size:1.3rem;color:#16a34a">' + rupees(p.amount) + '</b><br>' +
          'Plan/product: <b>' + esc((product && productDesc(product).name) || "—") + '</b><br>' +
          'Customer: ' + esc(p.email || p.contact || "—") + '<br>Method: ' + esc(p.method || "Razorpay") + '<br>Payment ID: ' + esc(p.id) + '</div>' +
          '<p style="margin:14px 0 0"><a href="' + SITE_URL + '/app/admin" style="color:#12b39a;font-weight:700">Open admin →</a></p>');
        // Warm welcome-to-premium email on a plan purchase (best-effort).
        try { const pd = product && RZP_PRODUCTS[product]; if (pd && pd.type === "plan" && p.email) await sendSubWelcomeEmail(env, { email: p.email, plan: pd.plan }); } catch (e) {}
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
  const email = (typeof b.email === "string" && b.email.trim()) ? b.email.trim() : (data.profile.email || "");
  if (typeof b.plan === "string" && ["free", "plus", "pro", "diamond"].indexOf(b.plan) !== -1) {
    data.profile.plan = b.plan; data.profile.plan_since = new Date().toISOString();
    // Write the AUTHORITATIVE override to `entitlements` (keyed by email) so the
    // change survives the entitlement check on next login — otherwise the
    // payment-derived plan would overwrite it. Needs the user's email.
    if (email) {
      try {
        await fetch(base + "/rest/v1/entitlements?on_conflict=email", {
          method: "POST",
          headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify({ email: email.toLowerCase(), plan: b.plan, until: null, note: (b.note || "admin"), updated_at: new Date().toISOString() }),
        });
      } catch (e) { /* table may not exist yet; user_state.plan still updated */ }
    }
  }
  // One-time token grant: add a wallet batch valid 60 days (matches the app model).
  if (b.tokensDelta && Number(b.tokensDelta) > 0) {
    if (!Array.isArray(data.profile.wallet)) data.profile.wallet = [];
    data.profile.wallet.push({ n: Number(b.tokensDelta), exp: Date.now() + 60 * 86400000, at: Date.now() });
  }
  // Upsert the row (create if the user has never synced).
  const up = await fetch(base + "/rest/v1/user_state?on_conflict=user_id", {
    method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: userId, data: data, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return aRes({ error: "update_failed" }, 400);
  return aRes({ ok: true, profile: data.profile }, 200);
}

// Gift a plan or tokens to a user (grant + branded gift email).
// body: { user_id, email, plan?, tokens?, message? }
async function sendGiftEmail(env, o) {
  if (!o.email) return;
  var giftLine = o.plan ? "the <b>" + esc(productDesc(o.plan).name) + "</b> plan" : (o.tokens ? "<b>" + o.tokens + " analysis tokens</b>" : "a gift");
  var firstName = (o.name ? String(o.name).trim().split(/\s+/)[0] : "");
  var greet = firstName ? "Hi " + esc(firstName) + " 👋" : "Hi there 👋";
  var inner =
    '<p style="color:#0f1730;font-weight:700;font-size:1.05rem;margin:0 0 6px">' + greet + '</p>' +
    '<h2 style="margin:0 0 6px;font-size:1.4rem">A gift, just for you 🎁</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Thank you for being part of ChintasMoney — we\'re rooting for you. To power up your trading journal, we\'ve gifted you ' + giftLine + ', already active on your account. ⚡</p>' +
    (o.message ? '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px 14px;color:#475569;margin:0 0 14px">“' + esc(o.message) + '”</div>' : '') +
    '<p style="color:#5b6b8c;margin:0 0 14px">Use it to log more of your trades, spot your patterns, and build the one thing that actually grows an account: <b>discipline</b>. Every trade you journal makes your next one sharper.</p>' +
    '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Open your app &amp; use your gift →</a></div>' +
    '<p style="color:#5b6b8c;font-size:13px;text-align:center;margin:6px 0 0">Your account: <b>' + esc(o.email) + '</b></p>' +
    '<p style="color:#5b6b8c;font-size:14px;margin:20px 0 0">Here\'s to calmer, more disciplined trading. 💚<br>— Team ChintasMoney</p>';
  await sendEmail(env, { to: o.email, subject: "🎁 A gift from ChintasMoney — you're all charged up!", html: emailShell(inner) });
}
// Send a push notification to every device subscribed under a given email.
async function sendPushToEmail(env, email, payload) {
  if (!email || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.SUPABASE_URL) return 0;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  let subs = [];
  try {
    const r = await fetch(base + "/rest/v1/push_subscriptions?select=*&email=eq." + encodeURIComponent(email.toLowerCase()), { headers: await sbHeaders(env) });
    if (r.ok) subs = await r.json();
  } catch (e) { return 0; }
  let sent = 0;
  for (const s of subs) {
    try {
      const status = await sendWebPush(env, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      if (status === 200 || status === 201) sent++;
    } catch (e) {}
  }
  return sent;
}
async function handleAdminGift(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const userId = b && b.user_id;
  if (!userId) return aRes({ error: "missing_user_id" }, 400);
  const base = gate.base;
  let data = { profile: {} };
  const sr = await fetch(base + "/rest/v1/user_state?user_id=eq." + encodeURIComponent(userId) + "&select=data", { headers: await sbHeaders(env) });
  if (sr.ok) { const arr = await sr.json(); if (arr && arr[0] && arr[0].data) data = arr[0].data; }
  if (!data.profile || typeof data.profile !== "object") data.profile = {};
  if (typeof b.plan === "string" && ["free", "plus", "pro", "diamond"].indexOf(b.plan) !== -1) { data.profile.plan = b.plan; data.profile.plan_since = new Date().toISOString(); }
  if (b.tokens) data.profile.tokens = Math.max(0, (data.profile.tokens || 0) + Number(b.tokens));
  // Leave an in-app message so the user sees the gift in their notification bell.
  var giftWhat = b.plan ? (productDesc(b.plan).name + " plan") : (b.tokens ? (b.tokens + " analysis tokens") : "a gift");
  var recipName = (data.profile && data.profile.name) ? String(data.profile.name).trim() : "";
  var firstName = recipName ? recipName.split(/\s+/)[0] : "";
  data.profile.giftAt = new Date().toISOString();
  data.profile.giftMsg = (b.message && String(b.message).slice(0, 240)) || ((firstName ? firstName + ", you've" : "You've") + " received " + giftWhat + " — it's active now. Use it to journal more trades and sharpen your discipline. 💚");
  data.profile.giftWhat = giftWhat;
  const up = await fetch(base + "/rest/v1/user_state?on_conflict=user_id", {
    method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: userId, data: data, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return aRes({ error: "gift_failed" }, 400);
  if (b.email) {
    await sendGiftEmail(env, { email: b.email, plan: b.plan, tokens: b.tokens, message: b.message, name: recipName });
    await sendPushToEmail(env, b.email, { title: "🎁 " + (firstName ? firstName + ", a" : "A") + " gift for you!", body: "You got " + giftWhat + ". Open the app to use it.", url: "/app/", tag: "cm-gift" });
  }
  return aRes({ ok: true }, 200);
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
// "We miss you" re-engagement email for users who've drifted away.
async function sendReengageEmail(env, o) {
  if (!o || !o.email) return;
  var firstName = o.name ? String(o.name).trim().split(/\s+/)[0] : "";
  var hi = firstName ? "Hi " + esc(firstName) + " 👋" : "Hey 👋";
  var inner =
    '<p style="color:#0f1730;font-weight:700;font-size:1.05rem;margin:0 0 6px">' + hi + '</p>' +
    '<h2 style="margin:0 0 6px;font-size:1.35rem">Your trading journal misses you 📓</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">It\'s been a little while. The traders who actually improve aren\'t the ones with the best tips — they\'re the ones who keep showing up and journaling honestly. Two minutes today keeps your edge sharp.</p>' +
    '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px 14px;color:#475569;margin:0 0 14px">💡 Quick win: log your last trade and check what your Discipline Score says to fix first.</div>' +
    lifeCta("Pick up where I left off") + lifeSign();
  await sendEmail(env, { to: o.email, subject: "📓 Your ChintasMoney journal misses you", html: emailShell(inner) });
}
// Weekly owner digest — the business reports itself to you every Monday.
async function sendOwnerDigest(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  const weekAgo = Date.now() - 7 * 86400000;
  // Users + plans + referrers.
  let users = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break; users = users.concat(batch); if (batch.length < 200) break;
    }
  } catch (e) {}
  const states = {};
  try { const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h }); if (sr.ok) (await sr.json()).forEach(function (r) { states[r.user_id] = r.data || {}; }); } catch (e) {}
  const nUsers = users.length;
  const newUsers = users.filter(function (u) { return u.created_at && new Date(u.created_at).getTime() >= weekAgo; }).length;
  let paying = 0; const refCount = {};
  users.forEach(function (u) { const p = (states[u.id] && states[u.id].profile) || {}; if (p.plan && p.plan !== "free") paying++; if (p.referredBy) refCount[p.referredBy] = (refCount[p.referredBy] || 0) + 1; });
  // Leads.
  let nLeads = 0, newLeads = 0;
  try { const lr = await fetch(base + "/rest/v1/leads?select=created_at&limit=5000", { headers: h }); if (lr.ok) { const arr = await lr.json(); nLeads = arr.length; newLeads = arr.filter(function (r) { return r.created_at && new Date(r.created_at).getTime() >= weekAgo; }).length; } } catch (e) {}
  // Payments this week + all-time net.
  let weekRev = 0, grossAll = 0;
  try { const pr = await fetch(base + "/rest/v1/payments?select=amount,status,created_at&limit=5000", { headers: h }); if (pr.ok) (await pr.json()).forEach(function (p) { if (p.status && p.status !== "paid") return; const a = (p.amount || 0); grossAll += a; if (p.created_at && new Date(p.created_at).getTime() >= weekAgo) weekRev += a; }); } catch (e) {}
  // Top referrer name.
  let topRef = "—", topN = 0;
  Object.keys(refCount).forEach(function (id) { if (refCount[id] > topN) { topN = refCount[id]; const u = users.filter(function (x) { return x.id === id; })[0]; topRef = (u && ((states[id] && states[id].profile && states[id].profile.name) || u.email)) || id; } });
  const conv = nUsers ? Math.round(paying / nUsers * 100) : 0;
  function card(label, val, sub) { return '<td style="padding:10px;border:1px solid #e6ebf5;border-radius:10px;text-align:center;width:33%"><div style="font-size:1.5rem;font-weight:800;color:#0f1730">' + val + '</div><div style="font-size:12px;color:#5b6b8c">' + label + '</div>' + (sub ? '<div style="font-size:11px;color:#98a6c4">' + sub + '</div>' : '') + '</td>'; }
  const inner =
    '<h2 style="margin:0 0 4px;font-size:1.35rem">📊 Your ChintasMoney week</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">A quick snapshot so you always know where the business stands.</p>' +
    '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:0 0 6px"><tr>' +
    card("New signups", "+" + newUsers, nUsers + " total") + card("New leads", "+" + newLeads, nLeads + " total") + card("Revenue (7d)", rupees(weekRev), rupees(grossAll) + " all-time") +
    '</tr><tr>' +
    card("Paying users", paying, conv + "% of users") + card("Top referrer", esc(String(topRef).split(/\s+/)[0] || "—"), topN ? topN + " signups" : "none yet") + card("All-time gross", rupees(grossAll), "") +
    '</tr></table>' +
    '<div style="text-align:center;margin:18px 0 6px"><a href="' + SITE_URL + '/app/admin" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Open the Growth Cockpit →</a></div>' +
    '<p style="color:#5b6b8c;font-size:13px;margin:14px 0 0">' + (newLeads === 0 && newUsers === 0 ? "Quiet week — share your free tools and use Prospect Radar to find people to help. 💪" : "Keep the momentum — reward your top referrer and send a campaign to your leads. 🚀") + '</p>';
  await sendEmail(env, { to: (env && env.OWNER_EMAIL) || OWNER_EMAIL, subject: "📊 ChintasMoney weekly: +" + newUsers + " users, +" + newLeads + " leads, " + rupees(weekRev), html: emailShell(inner) });
}
async function sendWeeklyReports(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  try { await sendOwnerDigest(env); } catch (e) {}
  // Map user_id -> {email, last sign-in} from auth.
  const meta = {};
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break;
      const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break;
      batch.forEach(function (u) { meta[u.id] = { email: u.email, last: u.last_sign_in_at || u.created_at || "" }; });
      if (batch.length < 200) break;
    }
  } catch (e) {}
  // What months's re-engage emails already went out (dedupe).
  const monthTag = "reengage-" + new Date().toISOString().slice(0, 7); // reengage-YYYY-MM
  const reengaged = {};
  try {
    const lr = await fetch(base + "/rest/v1/email_log?kind=eq." + encodeURIComponent(monthTag) + "&select=user_id", { headers: h });
    if (lr.ok) (await lr.json()).forEach(function (r) { reengaged[r.user_id] = true; });
  } catch (e) {}
  const now = Date.now();
  try {
    const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h });
    if (!sr.ok) return;
    const rows = await sr.json();
    for (const row of rows) {
      const data = row.data || {}; const prof = data.profile || {};
      const m = meta[row.user_id]; if (!m || !m.email) continue;
      // 1) Weekly report for paid, active users.
      if (prof.plan === "pro" || prof.plan === "diamond") {
        const stats = weekStats(data.trades || []);
        if (stats) { await sendWeeklyEmail(env, { email: m.email, name: prof.name, stats: stats }); }
      }
      // 2) Re-engagement for anyone who's been away 10–90 days (once/month).
      if (!reengaged[row.user_id] && m.last) {
        const days = (now - new Date(m.last).getTime()) / 86400000;
        const hasHistory = Array.isArray(data.trades) && data.trades.length > 0;
        if (hasHistory && days >= 10 && days <= 90) {
          let claimed = false;
          try {
            const ins = await fetch(base + "/rest/v1/email_log?on_conflict=user_id,kind", {
              method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }),
              body: JSON.stringify({ user_id: row.user_id, kind: monthTag, email: m.email, created_at: new Date().toISOString() }),
            });
            if (ins.ok) { const rr = await ins.json().catch(function () { return []; }); claimed = Array.isArray(rr) && rr.length > 0; }
          } catch (e) {}
          if (claimed) await sendReengageEmail(env, { email: m.email, name: prof.name });
        }
      }
    }
  } catch (e) {}
}

// AI Discipline Coach — a real LLM coach that knows the user's own trading data.
// Requires ANTHROPIC_API_KEY (Worker secret). Verifies a Supabase session so
// only signed-in users can call it. Never gives buy/sell tips.
async function handleCoach(request, env) {
  if (!env.ANTHROPIC_API_KEY) return aRes({ error: "ai_not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  // Verify the caller is a real signed-in user (guards API spend).
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ error: "unauthorized" }, 401);
  let user;
  try {
    const ur = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } });
    if (!ur.ok) return aRes({ error: "unauthorized" }, 401);
    user = await ur.json();
  } catch (e) { return aRes({ error: "unauthorized" }, 401); }
  if (!user || !user.id) return aRes({ error: "unauthorized" }, 401);
  // SERVER-ENFORCED entitlement: the AI coach is Diamond-only AND costs tokens.
  // This protects real Anthropic API spend from a tampered client — the gate is
  // here, not in the browser. Token debit fails OPEN if the ledger is down so a
  // genuine Diamond user is never blocked by infra.
  const plan = await serverResolvePlan(env, user.email);
  if (PLAN_RANK_W[plan] < PLAN_RANK_W.diamond) return aRes({ error: "upgrade_required", plan: plan, need: "diamond" }, 403);
  const spend = await tokenSpendServer(env, user.id, user.email, plan, 30);
  if (!spend.ok) return aRes({ error: "insufficient_tokens", balance: spend.balance }, 402);
  const question = String((b && b.question) || "").slice(0, 600);
  const context = String((b && b.context) || "").slice(0, 2500);
  const history = Array.isArray(b && b.history) ? b.history.slice(-6) : [];
  if (!question) return aRes({ error: "empty" }, 400);
  const system =
    "You are Chintamani, ChintasMoney's calm, wise trading-discipline coach for Indian retail traders. " +
    "You coach BEHAVIOUR and DISCIPLINE using ONLY the trader's own data provided below. " +
    "Absolute rules: never give buy/sell calls, tips, price targets, predictions, or specific trade recommendations; " +
    "never recommend instruments or say what to trade. If asked for tips/calls, gently refuse and redirect to their discipline. " +
    "Be warm, direct, specific and encouraging. Use ₹ and Indian context. Keep replies under 130 words, plain text, no markdown headings. " +
    "Base every claim on the numbers given; if data is thin, say so and encourage more logging.";
  const msgs = [];
  history.forEach(function (h) { if (h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string") msgs.push({ role: h.role, content: h.text.slice(0, 800) }); });
  msgs.push({ role: "user", content: "MY TRADING DATA (from my own logged trades):\n" + context + "\n\nMY QUESTION: " + question });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.COACH_MODEL || "claude-haiku-4-5", max_tokens: 700, system: system, messages: msgs }),
    });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok) return aRes({ error: "ai_error", detail: (j && j.error && j.error.message) || "AI request failed" }, 400);
    var text = "";
    if (j && Array.isArray(j.content)) j.content.forEach(function (blk) { if (blk && blk.type === "text") text += blk.text; });
    return aRes({ text: text.trim() || "I couldn't put that into words just now — try asking a bit differently." }, 200);
  } catch (e) { return aRes({ error: "ai_error" }, 400); }
}

// Referral: when a new user signs in with ?ref=<referrer user id>, grant BOTH
// the new user and the referrer bonus analysis tokens (once per new account).
async function handleReferral(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ error: "not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const ref = b && typeof b.ref === "string" ? b.ref.trim() : "";
  if (!ref) return aRes({ error: "no_ref" }, 400);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return aRes({ error: "unauthorized" }, 401);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  // Identify the new user from their session token.
  let newUserId = "";
  try {
    const ur = await fetch(base + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } });
    if (!ur.ok) return aRes({ error: "unauthorized" }, 401);
    const uj = await ur.json(); newUserId = uj && uj.id;
  } catch (e) { return aRes({ error: "unauthorized" }, 401); }
  if (!newUserId || ref === newUserId) return aRes({ ok: true, granted: 0 }, 200); // no self-referral
  const BONUS = 10;
  async function loadData(uid) {
    const r = await fetch(base + "/rest/v1/user_state?user_id=eq." + encodeURIComponent(uid) + "&select=data", { headers: await sbHeaders(env) });
    if (!r.ok) return null; const arr = await r.json(); return (arr && arr[0] && arr[0].data) || { profile: {} };
  }
  async function saveData(uid, data) {
    await fetch(base + "/rest/v1/user_state?on_conflict=user_id", { method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ user_id: uid, data: data, updated_at: new Date().toISOString() }) });
  }
  const nd = await loadData(newUserId); if (!nd) return aRes({ error: "lookup_failed" }, 400);
  if (!nd.profile) nd.profile = {};
  if (nd.profile.referredBy) return aRes({ ok: true, granted: 0, already: true }, 200); // dedupe
  nd.profile.referredBy = ref;
  nd.profile.tokens = Math.max(0, (nd.profile.tokens || 0) + BONUS);
  await saveData(newUserId, nd);
  // Credit the referrer.
  const rd = await loadData(ref);
  if (rd) { if (!rd.profile) rd.profile = {}; rd.profile.tokens = Math.max(0, (rd.profile.tokens || 0) + BONUS); rd.profile.referrals = (rd.profile.referrals || 0) + 1; await saveData(ref, rd); }
  return aRes({ ok: true, granted: BONUS }, 200);
}

// Capture a lead (opted-in email from the site/free tools). Public endpoint.
async function handleLead(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ error: "not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const email = b && typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || email.indexOf("@") === -1 || email.length > 200) return aRes({ error: "bad_email" }, 400);
  const source = (b && typeof b.source === "string" ? b.source : "site").slice(0, 60);
  const note = (b && typeof b.note === "string" ? b.note : "").slice(0, 300);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  // Is this a brand-new lead? (so we welcome them exactly once)
  let isNew = false;
  try {
    const ex = await fetch(base + "/rest/v1/leads?email=eq." + encodeURIComponent(email) + "&select=email", { headers: await sbHeaders(env) });
    if (ex.ok) { const arr = await ex.json(); isNew = !(arr && arr.length); }
  } catch (e) {}
  try {
    await fetch(base + "/rest/v1/leads?on_conflict=email", {
      method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ email: email, source: source, note: note, created_at: new Date().toISOString() }),
    });
  } catch (e) {}
  // Instant welcome + the promised checklist — starts trust the moment they opt in.
  if (isNew && source !== "affiliate") { try { await sendLeadWelcomeEmail(env, email); } catch (e) {} }
  return aRes({ ok: true }, 200);
}
// Instant welcome to a newly captured lead: delivers the Trader Discipline checklist.
async function sendLeadWelcomeEmail(env, email) {
  if (!email) return;
  const inner =
    emailBanner(WELCOME_BANNER) +
    '<h2 style="margin:0 0 6px;font-size:1.35rem">Your Trader Discipline checklist 📋</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Thanks for grabbing it — here are the 5 things disciplined traders do on <b>every</b> trade:</p>' +
    '<ol style="color:#0f1730;font-size:15px;line-height:1.9;margin:0 0 14px;padding-left:20px">' +
    '<li>Risk a fixed 1–2% per trade — never a gut-feeling amount.</li>' +
    '<li>Set the stop-loss <b>before</b> entering, not after it moves against you.</li>' +
    '<li>Size the position from the stop (use our position-size calculator).</li>' +
    '<li>Write the reason for the trade. No reason = no trade.</li>' +
    '<li>Review weekly: which setups actually made money?</li></ol>' +
    '<p style="color:#5b6b8c;margin:0 0 14px">Most traders don\'t lose from bad stocks — they lose from oversizing, holding losers and never reviewing. That\'s exactly what ChintasMoney scores for you, free.</p>' +
    '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Get my free Discipline Score →</a></div>' +
    '<p style="color:#5b6b8c;font-size:14px;margin:20px 0 0">To your discipline. 💚<br>— Team ChintasMoney<br><span style="font-size:12px;color:#98a6c4">You\'re getting this because you opted in at chintasmoney.com. Reply "unsubscribe" to stop.</span></p>';
  await sendEmail(env, { to: email, subject: "📋 Your Trader Discipline checklist (as promised)", html: emailShell(inner) });
}

// Prospect Radar — LIVE search of public Reddit for people asking about
// trading discipline / risk right now, so the owner can join the conversation
// and pull them to the free tool. Public data only; no scraping of contacts.
// Extract a balanced JSON object that starts at the first "{" after `marker`.
function extractJsonAfter(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  const start = html.indexOf("{", i); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else { if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch (e) { return null; } } } }
  }
  return null;
}
async function prospectsReddit(q, sub) {
  const endpoint = sub
    ? "https://www.reddit.com/r/" + sub + "/search.json?restrict_sr=1&sort=new&limit=25&q=" + encodeURIComponent(q)
    : "https://www.reddit.com/search.json?sort=new&limit=25&q=" + encodeURIComponent(q);
  const r = await fetch(endpoint, { headers: { "User-Agent": "ChintasMoney-ProspectRadar/1.0 (+https://chintasmoney.com)" } });
  if (!r.ok) return { error: "search_failed", detail: "Reddit returned " + r.status + ". Try again in a moment." };
  const j = await r.json();
  const kids = (j && j.data && j.data.children) || [];
  const items = kids.map(function (c) {
    const d = c.data || {};
    return { platform: "reddit", title: String(d.title || "").slice(0, 200), who: "r/" + (d.subreddit || ""), url: "https://www.reddit.com" + (d.permalink || ""), meta: (d.num_comments || 0) + " comments", created: d.created_utc ? Math.floor(d.created_utc) : 0, snippet: String(d.selftext || "").replace(/\s+/g, " ").slice(0, 220), channelUrl: "" };
  }).filter(function (x) { return x.title; });
  return { ok: true, items: items };
}
async function prospectsYouTube(q) {
  const r = await fetch("https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " india trading"), {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!r.ok) return { error: "search_failed", detail: "YouTube returned " + r.status + "." };
  const html = await r.text();
  const data = extractJsonAfter(html, "ytInitialData = ") || extractJsonAfter(html, 'ytInitialData"] = ');
  if (!data) return { error: "parse_failed", detail: "Couldn't read YouTube results — try again." };
  const items = []; const seenCh = {};
  (function walk(o) {
    if (!o || typeof o !== "object" || items.length >= 24) return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) || "";
      const channel = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) || "";
      const chId = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].navigationEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId) || "";
      const views = (v.shortViewCountText && (v.shortViewCountText.simpleText || (v.shortViewCountText.runs && v.shortViewCountText.runs.map(function (x) { return x.text; }).join("")))) || "";
      if (v.videoId && title) items.push({ platform: "youtube", title: title.slice(0, 200), who: channel, url: "https://www.youtube.com/watch?v=" + v.videoId, channelUrl: chId ? "https://www.youtube.com/channel/" + chId : "", meta: views, created: 0, snippet: "" });
    }
    for (const k in o) walk(o[k]);
  })(data);
  return { ok: true, items: items };
}
async function handleAdminProspects(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "position sizing").slice(0, 120);
  const sub = (url.searchParams.get("sub") || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  const source = (url.searchParams.get("source") || "reddit").toLowerCase();
  try {
    const out = source === "youtube" ? await prospectsYouTube(q) : await prospectsReddit(q, sub);
    return aRes(out, 200);
  } catch (e) { return aRes({ error: "search_error", detail: "Couldn't reach that source right now." }, 200); }
}

// Admin email broadcast (marketing to your own users / opted-in leads).
// body: { subject, message, segment, emails? }
async function handleAdminBroadcast(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  if (!env.RESEND_API_KEY || !env.RECEIPT_FROM) return aRes({ error: "email_not_configured", detail: "Add RESEND_API_KEY and RECEIPT_FROM in Cloudflare." }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const subject = String((b && b.subject) || "").slice(0, 200);
  const message = String((b && b.message) || "");
  const segment = String((b && b.segment) || "leads");
  if (!subject || !message) return aRes({ error: "missing", detail: "Subject and message are required." }, 400);
  const base = gate.base;
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  // Build recipient list.
  let recipients = [];
  try {
    if (segment === "custom") {
      recipients = (Array.isArray(b.emails) ? b.emails : String(b.emails || "").split(/[\s,;]+/)).map(function (e) { return String(e).trim().toLowerCase(); });
    } else if (segment === "leads") {
      const lr = await fetch(base + "/rest/v1/leads?select=email&limit=2000", { headers: h });
      if (lr.ok) recipients = (await lr.json()).map(function (r) { return r.email; });
    } else {
      // users, or a plan segment (plus/pro/diamond/free): join auth users + user_state
      const states = {};
      try { const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h }); if (sr.ok) (await sr.json()).forEach(function (r) { states[r.user_id] = (r.data && r.data.profile && r.data.profile.plan) || "free"; }); } catch (e) {}
      let users = [];
      for (let page = 1; page <= 50; page++) {
        const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
        if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
        if (!batch.length) break; users = users.concat(batch); if (batch.length < 200) break;
      }
      users.forEach(function (u) {
        if (!u.email) return;
        if (segment === "users" || states[u.id] === segment) recipients.push(u.email);
      });
    }
  } catch (e) { return aRes({ error: "list_failed" }, 400); }
  // Dedupe + validate + cap (protect sender reputation & Resend limits).
  const seen = {}; recipients = recipients.filter(function (e) { if (!e || e.indexOf("@") === -1 || seen[e]) return false; seen[e] = 1; return true; });
  const CAP = 300; const list = recipients.slice(0, CAP);

  // Build an email→first-name map so {{name}} can be personalised per recipient.
  const nameByEmail = {};
  try {
    const nameById = {};
    const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h });
    if (sr.ok) (await sr.json()).forEach(function (r) { const n = r.data && r.data.profile && r.data.profile.name; if (n) nameById[r.user_id] = String(n); });
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break;
      batch.forEach(function (u) {
        if (!u.email) return;
        const nm = nameById[u.id] || (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || "";
        if (nm) nameByEmail[u.email.toLowerCase()] = String(nm).trim().split(/\s+/)[0];
      });
      if (batch.length < 200) break;
    }
  } catch (e) {}

  // Optional image banner at the top of the email.
  const imageUrl = (b && typeof b.imageUrl === "string" && /^https:\/\//i.test(b.imageUrl.trim())) ? b.imageUrl.trim() : "";
  const banner = imageUrl ? '<div style="text-align:center;margin:0 0 16px"><img src="' + esc(imageUrl) + '" alt="" style="max-width:100%;height:auto;border-radius:12px"/></div>' : "";

  let sent = 0;
  for (const to of list) {
    const first = nameByEmail[to] || "";
    const personal = message.replace(/\{\{\s*(name|first_?name)\s*\}\}/gi, first || "there");
    const inner = banner +
      '<div style="font-size:15px;line-height:1.7;color:#0f1730">' + esc(personal).replace(/\n/g, "<br>") + '</div>' +
      '<p style="color:#98a6c4;font-size:12px;margin:18px 0 0">You are receiving this because you signed up or opted in at chintasmoney.com. Reply "unsubscribe" to stop.</p>';
    await sendEmail(env, { to: to, subject: subject, html: emailShell(inner) });
    sent++;
  }
  return aRes({ ok: true, sent: sent, total: recipients.length, capped: recipients.length > CAP }, 200);
}

// ===========================================================================
//  WEB PUSH  (RFC 8291 aes128gcm payload + RFC 8292 VAPID auth)
// ===========================================================================
function pushB64ToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function pushBytesToB64url(bytes) {
  const b = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pushConcat(arrays) {
  let len = 0; arrays.forEach(function (a) { len += a.length; });
  const out = new Uint8Array(len); let off = 0;
  arrays.forEach(function (a) { out.set(a, off); off += a.length; });
  return out;
}
async function pushHkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt, info: info }, key, length * 8);
  return new Uint8Array(bits);
}
async function vapidAuthHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const enc = function (s) { return pushBytesToB64url(new TextEncoder().encode(s)); };
  const header = enc(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = enc(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:" + (env.OWNER_EMAIL || OWNER_EMAIL) }));
  const unsigned = header + "." + payload;
  const pub = pushB64ToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE_KEY, x: pushBytesToB64url(pub.slice(1, 33)), y: pushBytesToB64url(pub.slice(33, 65)), ext: true };
  const signKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + pushBytesToB64url(new Uint8Array(sig));
  return "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY;
}
async function encryptPush(subscription, payloadBytes) {
  const uaPublic = pushB64ToBytes(subscription.keys.p256dh);   // 65 bytes
  const authSecret = pushB64ToBytes(subscription.keys.auth);   // 16 bytes
  const asPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPair.privateKey, 256));
  const keyInfo = pushConcat([new TextEncoder().encode("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = await pushHkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await pushHkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await pushHkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const record = pushConcat([payloadBytes, new Uint8Array([2])]); // single-record delimiter 0x02
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));
  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // record size = 4096
  const idlen = new Uint8Array([asPublic.length]); // 65
  return pushConcat([salt, rs, idlen, asPublic, ct]);
}
async function sendWebPush(env, subscription, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const body = await encryptPush(subscription, payloadBytes);
  const auth = await vapidAuthHeader(env, subscription.endpoint);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Authorization: auth },
    body: body,
  });
  return res.status;
}
// Store a browser's push subscription (opt-in from the app).
async function handlePushSubscribe(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return aRes({ error: "not_configured" }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const sub = b && b.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return aRes({ error: "bad_subscription" }, 400);
  const email = b && typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  try {
    await fetch(base + "/rest/v1/push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, email: email, created_at: new Date().toISOString() }),
    });
  } catch (e) {}
  return aRes({ ok: true }, 200);
}
// Admin: broadcast a push notification to every subscribed device.
async function handleAdminPush(request, env) {
  const gate = await requireAdmin(request, env); if (gate.err) return gate.err;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return aRes({ error: "push_not_configured", detail: "Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Cloudflare." }, 501);
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const title = String((b && b.title) || "").slice(0, 100);
  const body = String((b && b.body) || "").slice(0, 300);
  const urlPath = String((b && b.url) || "/app/").slice(0, 300);
  if (!title || !body) return aRes({ error: "missing", detail: "Title and message are required." }, 400);
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  let subs = [];
  try { const r = await fetch(gate.base + "/rest/v1/push_subscriptions?select=*&limit=5000", { headers: h }); if (r.ok) subs = await r.json(); } catch (e) {}
  const payload = { title: title, body: body, url: urlPath, icon: SITE_URL + "/app/assets/icon-192.png", tag: "cm-broadcast" };
  let sent = 0; const gone = [];
  for (const s of subs) {
    try {
      const status = await sendWebPush(env, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      if (status === 200 || status === 201) sent++;
      else if (status === 404 || status === 410) gone.push(s.endpoint);
    } catch (e) {}
  }
  for (const ep of gone) {
    try { await fetch(gate.base + "/rest/v1/push_subscriptions?endpoint=eq." + encodeURIComponent(ep), { method: "DELETE", headers: h }); } catch (e) {}
  }
  return aRes({ ok: true, sent: sent, total: subs.length, removed: gone.length }, 200);
}

// Welcome email on first sign-in. Client calls this once per new account.
async function handleWelcome(request, env) {
  let b; try { b = await request.json(); } catch (e) { return aRes({ error: "bad_request" }, 400); }
  const email = b && typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.indexOf("@") === -1) return aRes({ error: "bad_email" }, 400);
  await sendWelcomeEmail(env, email);
  // Alert the owner of a new signup.
  await sendOwnerAlert(env, "🆕 New signup — ChintasMoney",
    '<h2 style="margin:0 0 6px">🆕 New user just joined!</h2>' +
    '<p style="color:#5b6b8c;margin:0 0 12px">Someone created an account.</p>' +
    '<div style="border:1px solid #e6ebf5;border-radius:12px;padding:14px 16px;font-size:14px">Email: <b>' + esc(email) + '</b><br>When: ' + esc(new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })) + '</div>' +
    '<p style="margin:14px 0 0"><a href="' + SITE_URL + '/app/admin" style="color:#12b39a;font-weight:700">Open admin →</a></p>');
  return aRes({ ok: true }, 200);
}

// Daily "keep your streak alive" push — only to users with an active streak
// who haven't logged today AND have push turned on. Targeted, never spam.
async function sendStreakReminders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  // Push subscriptions keyed by email.
  let subsByEmail = {};
  try {
    const pr = await fetch(base + "/rest/v1/push_subscriptions?select=*", { headers: h });
    if (pr.ok) (await pr.json()).forEach(function (s) { if (s.email) (subsByEmail[s.email.toLowerCase()] = subsByEmail[s.email.toLowerCase()] || []).push(s); });
  } catch (e) {}
  if (!Object.keys(subsByEmail).length) return;
  // Map user_id -> email.
  const emailById = {};
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break; batch.forEach(function (u) { if (u.email) emailById[u.id] = u.email.toLowerCase(); });
      if (batch.length < 200) break;
    }
  } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  const dayTag = "streak-" + today;
  function streakOf(trades) {
    var days = {}; (trades || []).forEach(function (t) { if (t && t.date) days[String(t.date).slice(0, 10)] = 1; });
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var todayStr = d.toISOString().slice(0, 10);
    var loggedToday = !!days[todayStr];
    if (!days[todayStr]) { var y = new Date(d); y.setDate(y.getDate() - 1); if (!days[y.toISOString().slice(0, 10)]) return { streak: 0, loggedToday: false }; d = y; }
    var streak = 0;
    while (days[d.toISOString().slice(0, 10)]) { streak++; d.setDate(d.getDate() - 1); }
    return { streak: streak, loggedToday: loggedToday };
  }
  try {
    const sr = await fetch(base + "/rest/v1/user_state?select=user_id,data", { headers: h });
    if (!sr.ok) return;
    const rows = await sr.json();
    for (const row of rows) {
      const email = emailById[row.user_id]; if (!email) continue;
      const subs = subsByEmail[email]; if (!subs || !subs.length) continue;
      const st = streakOf((row.data && row.data.trades) || []);
      if (st.loggedToday || st.streak < 2) continue; // only nudge a real, at-risk streak
      // Dedupe once per day.
      let claimed = false;
      try {
        const ins = await fetch(base + "/rest/v1/email_log?on_conflict=user_id,kind", {
          method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }),
          body: JSON.stringify({ user_id: row.user_id, kind: dayTag, email: email, created_at: new Date().toISOString() }),
        });
        if (ins.ok) { const rr = await ins.json().catch(function () { return []; }); claimed = Array.isArray(rr) && rr.length > 0; }
      } catch (e) {}
      if (!claimed) continue;
      const payload = { title: "🔥 Keep your " + st.streak + "-day streak alive!", body: "Log a trade before midnight so your streak doesn't reset.", url: "/app/", tag: "cm-streak" };
      for (const s of subs) { try { await sendWebPush(env, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); } catch (e) {} }
    }
  } catch (e) {}
}

// Renewal reminder — paid plans are one-time, so nudge by email 1–3 days before a
// plan lapses. Recovers churn that would otherwise happen silently. Deduped per
// user+expiry so each renewal cycle sends at most one reminder per day.
async function sendRenewalReminders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  // email -> user_id (for dedup via email_log).
  const idByEmail = {};
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break; batch.forEach(function (u) { if (u.email) idByEmail[u.email.toLowerCase()] = u.id; });
      if (batch.length < 200) break;
    }
  } catch (e) {}
  let rows = [];
  try {
    const pr = await fetch(base + "/rest/v1/payments?select=email,plan,created_at,period_days,status&order=created_at.desc", { headers: h });
    if (pr.ok) rows = await pr.json();
  } catch (e) { return; }
  const now = Date.now(), RANK = { free: 0, plus: 1, pro: 2, diamond: 3 };
  // Latest plan payment per email.
  const latest = {};
  (rows || []).forEach(function (r) {
    if (!r || !r.email || (r.status && r.status !== "paid")) return;
    if (RANK[r.plan] == null || r.plan === "free") return;
    const e = r.email.toLowerCase();
    if (!latest[e] || new Date(r.created_at) > new Date(latest[e].created_at)) latest[e] = r;
  });
  for (const email of Object.keys(latest)) {
    const r = latest[email];
    const period = (r.period_days ? r.period_days : 33) * 86400000;
    const expiry = new Date(r.created_at).getTime() + period;
    const daysLeft = Math.ceil((expiry - now) / 86400000);
    if (daysLeft < 1 || daysLeft > 3) continue; // only the 1–3 day window
    const uid = idByEmail[email];
    if (uid) {
      let claimed = false;
      try {
        const ins = await fetch(base + "/rest/v1/email_log?on_conflict=user_id,kind", {
          method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }),
          body: JSON.stringify({ user_id: uid, kind: "renew-" + new Date(expiry).toISOString().slice(0, 10), email: email, created_at: new Date().toISOString() }),
        });
        if (ins.ok) { const rr = await ins.json().catch(function () { return []; }); claimed = Array.isArray(rr) && rr.length > 0; }
      } catch (e) {}
      if (!claimed) continue;
    }
    const d = productDesc(r.plan);
    const name = d ? d.name : r.plan;
    const inner =
      '<h2 style="margin:0 0 6px;font-size:1.4rem">Your ' + esc(name) + ' plan ends in ' + daysLeft + ' day' + (daysLeft === 1 ? "" : "s") + ' ⏳</h2>' +
      '<p style="color:#5b6b8c;margin:0 0 14px">Renew now to keep your monthly tokens, the tools you rely on' + (r.plan === "diamond" ? " and your AI Discipline Coach" : "") + ' — no break in access. Discipline compounds; don\'t lose your momentum.</p>' +
      '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '#/profile" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:800">Renew my ' + esc(name) + ' →</a></div>' +
      '<p style="color:#5b6b8c;font-size:13px;text-align:center;margin:6px 0 0">Tip: switch to yearly and get <b>2 months free</b>.</p>';
    try { await sendEmail(env, { to: email, subject: "⏳ Your ChintasMoney " + name + " ends in " + daysLeft + " day" + (daysLeft === 1 ? "" : "s") + " — renew to keep access", html: emailShell(inner) }); } catch (e) {}
  }
}

// ---- Unsubscribe (one-click) + opt-out list ---------------------------------
// Responsible email: every re-engagement email carries a one-click unsubscribe
// link. The link is HMAC-signed so only we can mint it, and clicking it adds the
// address to email_optout, which the win-back job honours.
async function unsubToken(env, email) {
  return (await hmacHex(env.ADMIN_SESSION_SECRET || "cm", "unsub:" + String(email).toLowerCase())).slice(0, 32);
}
async function unsubLink(env, email) {
  return SITE_URL + "/api/unsubscribe?e=" + encodeURIComponent(email) + "&t=" + (await unsubToken(env, email));
}
async function unsubFooter(env, email) {
  var link = await unsubLink(env, email);
  return '<p style="color:#98a6c4;font-size:12px;margin:18px 0 0;text-align:center">You get these because you have a ChintasMoney account. ' +
    '<a href="' + link + '" style="color:#7cc7ff">Unsubscribe from reminders</a>.</p>';
}
async function emailOptoutSet(env, base, h) {
  var set = {};
  try {
    var r = await fetch(base + "/rest/v1/email_optout?select=email", { headers: h });
    if (r.ok) (await r.json()).forEach(function (x) { if (x && x.email) set[String(x.email).toLowerCase()] = 1; });
  } catch (e) {}
  return set;
}
async function handleUnsubscribe(request, env) {
  var url = new URL(request.url);
  var email = (url.searchParams.get("e") || "").trim().toLowerCase();
  var tok = (url.searchParams.get("t") || "").trim();
  var page = function (msg) {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>ChintasMoney</title><div style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f4f6fb;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div style="max-width:440px;background:#fff;border:1px solid #e6ebf5;border-radius:16px;padding:28px;text-align:center">' +
      '<img src="' + LOGO_URL + '" alt="ChintasMoney" style="height:34px;margin-bottom:14px"/>' +
      '<div style="color:#0f1730;font-size:1.05rem;line-height:1.6">' + msg + '</div>' +
      '<p style="margin:18px 0 0"><a href="' + SITE_URL + '" style="color:#12b39a;font-weight:700;text-decoration:none">Back to chintasmoney.com →</a></p>' +
      '</div></div>', { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  };
  if (!email || !tok || tok !== (await unsubToken(env, email))) return page("This unsubscribe link looks invalid or expired. If you keep getting emails, reply <b>unsubscribe</b> to any of them and we\'ll remove you.");
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    var base = env.SUPABASE_URL.replace(/\/$/, "");
    try {
      await fetch(base + "/rest/v1/email_optout?on_conflict=email", {
        method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates" }),
        body: JSON.stringify({ email: email, created_at: new Date().toISOString() }),
      });
    } catch (e) {}
  }
  return page("You\'re unsubscribed from ChintasMoney reminder emails. 👋<br><span style=\"color:#5b6b8c;font-size:.9rem\">You\'ll still get important account emails like receipts. Changed your mind? Just open the app again.</span>");
}

// Weekly win-back — a warm Sunday-morning nudge to people who haven't opened the
// app in a while, from Chintamani. Honours the opt-out list, and sends at most
// one per week (deduped on the firing Sunday). Reaches users inactive 7–90 days;
// after 90 days we stop (no endless pestering = fewer spam complaints).
async function sendWinbackReminders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !env.RECEIPT_FROM) return;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
  const optout = await emailOptoutSet(env, base, h);
  // All auth users with their last sign-in.
  const users = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const ur = await fetch(base + "/auth/v1/admin/users?page=" + page + "&per_page=200", { headers: h });
      if (!ur.ok) break; const uj = await ur.json(); const batch = uj.users || (Array.isArray(uj) ? uj : []);
      if (!batch.length) break;
      batch.forEach(function (u) { if (u.email) users.push({ id: u.id, email: u.email.toLowerCase(), last: u.last_sign_in_at, created: u.created_at }); });
      if (batch.length < 200) break;
    }
  } catch (e) { return; }
  const now = Date.now();
  const weekTag = "winback-" + new Date().toISOString().slice(0, 10); // the firing Sunday
  for (const u of users) {
    if (optout[u.email]) continue;
    const lastTs = u.last ? new Date(u.last).getTime() : (u.created ? new Date(u.created).getTime() : 0);
    if (!lastTs) continue;
    const days = Math.floor((now - lastTs) / 86400000);
    if (days < 7 || days > 90) continue; // the re-engagement window
    // One per week max.
    let claimed = false;
    try {
      const ins = await fetch(base + "/rest/v1/email_log?on_conflict=user_id,kind", {
        method: "POST", headers: await sbHeaders(env, { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }),
        body: JSON.stringify({ user_id: u.id, kind: weekTag, email: u.email, created_at: new Date().toISOString() }),
      });
      if (ins.ok) { const rr = await ins.json().catch(function () { return []; }); claimed = Array.isArray(rr) && rr.length > 0; }
    } catch (e) {}
    if (!claimed) continue;
    const inner =
      '<h2 style="margin:0 0 6px;font-size:1.4rem">We miss you at ChintasMoney 👋</h2>' +
      '<p style="color:#5b6b8c;margin:0 0 6px">It\'s been ' + days + ' days since your last visit. A calm Sunday is the perfect time to look back at your week — before the next one starts.</p>' +
      '<p style="color:#5b6b8c;margin:0 0 14px">Two minutes is all it takes: log your trades, check your <b>Discipline Score</b>, and see your <b>Weekly Wrapped</b> — the one habit that quietly compounds into a better trader.</p>' +
      '<div style="text-align:center;margin:20px 0 8px"><a href="' + APP_URL + '" style="display:inline-block;background:linear-gradient(135deg,#22e08a,#12b39a);color:#04231b;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:800">Open ChintasMoney →</a></div>' +
      '<p style="color:#5b6b8c;font-size:13px;text-align:center;margin:6px 0 0">Don\'t forget — you earn <b>+30 free tokens</b> just for showing up today.</p>' +
      '<p style="color:#5b6b8c;font-size:13px;margin:16px 0 0">To your discipline,<br>— Chintamani 🙏</p>' +
      (await unsubFooter(env, u.email));
    try { await sendEmail(env, { to: u.email, subject: "We miss you — your Sunday discipline check-in 🧘", html: emailShell(inner) }); } catch (e) {}
  }
}

export default {
  async scheduled(event, env, ctx) {
    // Weekly report runs on Monday 04:00 UTC; the daily streak nudge runs every
    // evening; the win-back email goes out Sunday morning. Route by cron string.
    if (event && event.cron === "0 4 * * 1") ctx.waitUntil(sendWeeklyReports(env));
    else if (event && event.cron === "30 12 * * *") ctx.waitUntil((async function () { try { await sendStreakReminders(env); } catch (e) {} try { await sendRenewalReminders(env); } catch (e) {} })());
    else if (event && event.cron === "30 3 * * 0") ctx.waitUntil(sendWinbackReminders(env));
    else ctx.waitUntil(sendWeeklyReports(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Friendly shortcut: /admin (and /admin.html) → the real admin panel.
    if (url.pathname === "/admin" || url.pathname === "/admin.html" || url.pathname === "/admin/") {
      return Response.redirect(url.origin + "/app/admin", 301);
    }
    if (request.method === "POST" && url.pathname === "/api/razorpay/webhook") return handleRzpWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/api/welcome") return handleWelcome(request, env);
    if (request.method === "POST" && url.pathname === "/api/coach") return handleCoach(request, env);
    if (request.method === "POST" && url.pathname === "/api/referral") return handleReferral(request, env);
    if (request.method === "POST" && url.pathname === "/api/lead") return handleLead(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/broadcast") return handleAdminBroadcast(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/prospects") return handleAdminProspects(request, env);
    if (request.method === "POST" && url.pathname === "/api/lifecycle") return handleLifecycle(request, env);
    if (request.method === "GET" && url.pathname === "/api/entitlement") return handleEntitlement(request, env);
    if (request.method === "GET" && url.pathname === "/api/tokens") return handleTokensGet(request, env);
    if (request.method === "GET" && url.pathname === "/api/unsubscribe") return handleUnsubscribe(request, env);
    if (request.method === "POST" && url.pathname === "/api/push/subscribe") return handlePushSubscribe(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/push") return handleAdminPush(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/razorpay") return handleAdminRazorpay(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/login") return handleAdminLogin(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/data") return handleAdminData(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/refund") return handleAdminRefund(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/update-user") return handleAdminUpdateUser(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/send-invoice") return handleAdminSendInvoice(request, env);
    if (request.method === "POST" && url.pathname === "/api/admin/gift") return handleAdminGift(request, env);
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
    // Serve ads.txt explicitly as text/plain with a 200 — guarantees Google
    // AdSense can always read it, independent of static-asset content-type
    // detection (the usual cause of an "ads.txt not found" status).
    if (url.pathname === "/ads.txt") {
      return new Response("google.com, pub-1462824307424705, DIRECT, f08c47fec0942fa0\n",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "max-age=3600" } });
    }
    return env.ASSETS.fetch(request);
  },
};
