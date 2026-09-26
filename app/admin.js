/* ChintasMoney — Admin Control Panel
 * -----------------------------------------------------------------------------
 * A login-gated, front-end control panel for the owner:
 *   • People logged (emails, plan, when they came / last login)
 *   • Product catalogue (subscriptions + token packs) with per-category icons,
 *     fully editable prices — changes take effect in the app immediately
 *   • Gating editor: re-lock / unlock every gated section to any plan
 *   • Feature flags
 *   • Revenue: total money made, invoices, refunds
 *   • Filters across users & invoices
 *   • Export / download everything (JSON + CSV)
 *   • Privacy & Security (change admin password, wipe local data)
 *
 * SECURITY NOTE: this login is client-side only (localStorage). It keeps the
 * panel out of casual view, but is NOT a substitute for real server auth — the
 * cross-user data below is DEMO data until a backend (Supabase service-role) is
 * wired. The local account on this device is shown as real.
 * ---------------------------------------------------------------------------*/
(function () {
  "use strict";
  var root = document.getElementById("root");
  var CM = window.CM;

  // ---- default admin credentials (changeable in Privacy & Security) ---------
  var DEFAULT_USER = "chintasmoney";
  var DEFAULT_PASS = "Chintas@2026";
  var SESSION_KEY = "chintasmoney.admin.session";

  function el(h) { var t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
  function creds() { var c = CM.adminConfig(); return (c.auth && c.auth.user) ? c.auth : { user: DEFAULT_USER, pass: DEFAULT_PASS }; }
  // Session holds either a server JWT-style token ("live") or the sentinel "1"
  // (local-only gate, used when the Worker admin API isn't configured yet).
  function token() { try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; } }
  function isAuthed() { return !!token(); }
  function setToken(v) { try { v ? sessionStorage.setItem(SESSION_KEY, v) : sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function setAuthed(v) { setToken(v ? "1" : ""); }

  // ---- live data (Supabase via Worker service-role) -------------------------
  var LIVE = { state: "idle", users: null, invoices: null, refunds: null, error: "" };
  function fetchLive() {
    if (token() === "1") { LIVE.state = "demo"; return; } // local gate → demo data
    LIVE.state = "loading";
    fetch("/api/admin/data", { headers: { Authorization: "Bearer " + token() } })
      .then(function (r) {
        if (r.status === 401) { setToken(""); LIVE.state = "idle"; render(); return null; }
        if (!r.ok) { LIVE.state = "demo"; LIVE.error = r.status === 501 ? "Supabase not wired in the Worker yet — showing demo data." : "Couldn't load live data — showing demo."; render(); return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        LIVE.users = d.users || []; LIVE.invoices = d.invoices || []; LIVE.refunds = d.refunds || [];
        LIVE.state = "live"; render();
      })
      .catch(function () { LIVE.state = "demo"; LIVE.error = "Network error — showing demo data."; render(); });
  }
  function liveOn() { return LIVE.state === "live"; }

  // ---- inject admin-only styles (self-contained; no styles.css dependency) ---
  (function styles() {
    if (document.getElementById("cm-admin-css")) return;
    var s = document.createElement("style"); s.id = "cm-admin-css";
    s.textContent = [
      ".cm-login{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1533;padding:20px}",
      ".cm-login-card{width:100%;max-width:380px;background:#fff;border-radius:18px;padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.35)}",
      ".cm-login-card h1{margin:14px 0 4px;font-size:1.35rem}",
      ".cm-login-card p{margin:0 0 18px;color:#64748b;font-size:.9rem}",
      ".cm-fld{display:block;margin:0 0 12px}",
      ".cm-fld span{display:block;font-size:.78rem;font-weight:600;color:#475569;margin-bottom:5px}",
      ".cm-fld input,.cm-fld select{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit}",
      ".cm-btn{display:inline-flex;align-items:center;gap:6px;justify-content:center;padding:10px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-weight:600;cursor:pointer;font-family:inherit;font-size:.9rem}",
      ".cm-btn.p{background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;border:none}",
      ".cm-btn.sm{padding:7px 12px;font-size:.82rem}",
      ".cm-btn.danger{color:#dc2626;border-color:#fecaca}",
      ".cm-err{color:#dc2626;font-size:.82rem;margin:0 0 12px;min-height:16px}",
      ".cm-shell{display:flex;min-height:100vh;background:#f1f5f9;color:#0f172a;font-family:'Plus Jakarta Sans',system-ui,sans-serif}",
      ".cm-side{width:230px;flex-shrink:0;background:#0b1533;color:#cbd5e1;padding:18px 12px;position:sticky;top:0;height:100vh;box-sizing:border-box;overflow-y:auto}",
      ".cm-brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;margin:0 6px 18px;font-weight:800}",
      ".cm-brand img{width:34px;height:34px;border-radius:9px}",
      ".cm-brand small{display:block;font-size:.62rem;letter-spacing:.14em;color:#8b5cf6;font-weight:700}",
      ".cm-nav{display:block;padding:10px 12px;margin:3px 0;border-radius:10px;color:#cbd5e1;text-decoration:none;font-size:.9rem;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:inherit}",
      ".cm-nav:hover{background:rgba(255,255,255,.06)}",
      ".cm-nav.on{background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;font-weight:600}",
      ".cm-sep{height:1px;background:rgba(255,255,255,.1);margin:12px 4px}",
      ".cm-main{flex:1;padding:24px 28px;min-width:0}",
      ".cm-h1{margin:0;font-size:1.5rem}",
      ".cm-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px}",
      ".cm-sub{color:#64748b;font-size:.85rem;margin-top:2px}",
      ".cm-grid{display:grid;gap:14px}",
      ".cm-g2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}",
      ".cm-g3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}",
      ".cm-g4{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}",
      ".cm-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px}",
      ".cm-stat .lbl{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}",
      ".cm-stat .val{display:block;font-size:1.7rem;font-weight:800;margin:4px 0 2px}",
      ".cm-stat .hint{display:block;font-size:.78rem;color:#94a3b8}",
      ".cm-tbl{width:100%;border-collapse:collapse;font-size:.86rem}",
      ".cm-tbl th,.cm-tbl td{text-align:left;padding:10px 10px;border-bottom:1px solid #eef2f7;vertical-align:top}",
      ".cm-tbl th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#64748b}",
      ".cm-tbl td.num,.cm-tbl th.num{text-align:right;font-variant-numeric:tabular-nums}",
      ".cm-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700}",
      ".b-free{background:#e2e8f0;color:#334155}.b-plus{background:#dcfce7;color:#166534}.b-pro{background:#fef9c3;color:#854d0e}.b-diamond{background:#ede9fe;color:#5b21b6}",
      ".b-ok{background:#dcfce7;color:#166534}.b-warn{background:#fef9c3;color:#854d0e}.b-bad{background:#fee2e2;color:#991b1b}",
      ".cm-muted{color:#94a3b8}",
      ".cm-hint{color:#64748b;font-size:.85rem}",
      ".cm-note{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px 14px;font-size:.83rem;color:#475569}",
      ".cm-cat{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}",
      ".cm-cat .ic{width:46px;height:46px;flex:0 0 46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem}",
      ".cm-cat h3{margin:0 0 2px;font-size:1rem}",
      ".cm-filter{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px}",
      ".cm-filter .cm-fld{margin:0}",
      ".cm-bar{height:8px;border-radius:999px;background:#eef2f7;overflow:hidden;margin-top:4px}",
      ".cm-bar i{display:block;height:100%;background:linear-gradient(90deg,#8b5cf6,#6366f1)}",
      ".cm-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #eef2f7}",
      ".cm-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}",
      ".cm-hd h3{margin:0;font-size:1.02rem}",
      "@media(max-width:760px){.cm-side{position:fixed;left:-260px;transition:left .2s;z-index:40}.cm-side.open{left:0}.cm-main{padding:16px}.cm-menu-btn{display:inline-flex!important}}",
      ".cm-menu-btn{display:none;align-items:center}",
      ".cm-cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}",
      ".cm-uc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}",
      ".cm-uc-top{display:flex;gap:12px;align-items:center}",
      ".cm-av{width:44px;height:44px;flex:0 0 44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:1.05rem;background:linear-gradient(135deg,#8b5cf6,#6366f1)}",
      ".cm-uc-name{font-weight:700;font-size:.98rem;line-height:1.2}",
      ".cm-uc-mail{font-size:.8rem;color:#64748b;word-break:break-all}",
      ".cm-uc-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.8rem}",
      ".cm-uc-meta .k{color:#94a3b8;display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}",
      ".cm-uc-meta .v{font-weight:600;color:#334155}",
      ".cm-uc-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #eef2f7;padding-top:10px;font-size:.8rem}",
      ".cm-inv{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px}",
      ".cm-inv-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}",
      ".cm-inv-amt{font-size:1.35rem;font-weight:800}",
      ".cm-inv .code{font-family:ui-monospace,monospace;font-size:.78rem;color:#475569}",
      ".cm-cal-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}",
      ".cm-cal-hd h3{margin:0;font-size:1.1rem}",
      ".cm-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}",
      ".cm-cal .dow{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;text-align:center;padding:4px 0;font-weight:700}",
      ".cm-day{min-height:74px;border:1px solid #e2e8f0;border-radius:10px;padding:6px;background:#fff;display:flex;flex-direction:column;gap:3px}",
      ".cm-day.empty{background:transparent;border:none}",
      ".cm-day.today{border-color:#8b5cf6;box-shadow:0 0 0 1px #8b5cf6 inset}",
      ".cm-day .dn{font-size:.72rem;font-weight:700;color:#64748b}",
      ".cm-pill{font-size:.66rem;font-weight:700;border-radius:6px;padding:1px 5px;display:inline-block}",
      ".cm-pill.new{background:#dcfce7;color:#166534}.cm-pill.act{background:#ede9fe;color:#5b21b6}",
      ".cm-day.plan{cursor:pointer}.cm-day.plan:hover{border-color:#8b5cf6}",
      ".cm-chip{font-size:.66rem;background:#eef2ff;color:#3730a3;border-radius:6px;padding:1px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "@media(max-width:640px){.cm-day{min-height:58px}.cm-cal{gap:3px}}"
    ].join("");
    document.head.appendChild(s);
  })();

  // ===========================================================================
  //  DEMO cross-user dataset (until Supabase service-role backend is wired).
  //  The local device account is merged in as REAL.
  // ===========================================================================
  var DEMO_USERS = [
    { name: "Aarav Sharma",  email: "aarav.sharma@gmail.com",  plan: "diamond", persona: "trader",   joined: "2026-03-02", last: "2026-09-21", ai: 812, status: "active",   country: "IN" },
    { name: "Diya Patel",    email: "diya.patel@outlook.com",  plan: "pro",     persona: "investor", joined: "2026-04-18", last: "2026-09-20", ai: 344, status: "active",   country: "IN" },
    { name: "Kabir Rao",     email: "kabir.rao@gmail.com",     plan: "plus",    persona: "both",     joined: "2026-05-30", last: "2026-09-19", ai: 121, status: "past_due", country: "IN" },
    { name: "Meera Nair",    email: "meera.nair@yahoo.com",    plan: "plus",    persona: "personal", joined: "2026-06-11", last: "2026-09-18", ai: 63,  status: "active",   country: "IN" },
    { name: "Rohan Gupta",   email: "rohan.g@gmail.com",       plan: "free",    persona: "planner",  joined: "2026-07-01", last: "2026-09-15", ai: 9,   status: "active",   country: "IN" },
    { name: "Ishaan Verma",  email: "ishaan.v@gmail.com",      plan: "free",    persona: "trader",   joined: "2026-08-09", last: "2026-09-12", ai: 4,   status: "active",   country: "IN" },
    { name: "Ananya Iyer",   email: "ananya.iyer@gmail.com",   plan: "pro",     persona: "investor", joined: "2026-08-22", last: "2026-09-21", ai: 210, status: "active",   country: "IN" }
  ];
  // DEMO invoices (a "product" is a plan or token pack purchase).
  var DEMO_INVOICES = [
    { id: "INV-2609-0007", email: "aarav.sharma@gmail.com", product: "diamond", amount: 999, date: "2026-09-01", status: "paid",     method: "UPI" },
    { id: "INV-2609-0006", email: "ananya.iyer@gmail.com",  product: "pro",     amount: 499, date: "2026-09-03", status: "paid",     method: "Card" },
    { id: "INV-2609-0005", email: "diya.patel@outlook.com", product: "pro",     amount: 499, date: "2026-09-05", status: "paid",     method: "Netbanking" },
    { id: "INV-2609-0004", email: "aarav.sharma@gmail.com", product: "tok150",  amount: 199, date: "2026-09-08", status: "paid",     method: "UPI" },
    { id: "INV-2609-0003", email: "meera.nair@yahoo.com",   product: "plus",    amount: 199, date: "2026-09-10", status: "paid",     method: "UPI" },
    { id: "INV-2609-0002", email: "kabir.rao@gmail.com",    product: "plus",    amount: 199, date: "2026-09-11", status: "past_due", method: "Card" },
    { id: "INV-2609-0001", email: "ananya.iyer@gmail.com",  product: "tok60",   amount: 99,  date: "2026-09-14", status: "paid",     method: "UPI" },
    { id: "INV-2608-0009", email: "diya.patel@outlook.com", product: "tok20",   amount: 49,  date: "2026-08-28", status: "refunded", method: "Card" }
  ];
  var DEMO_REFUNDS = [
    { id: "RFND-2608-0002", invoice: "INV-2608-0009", email: "diya.patel@outlook.com", product: "tok20", amount: 49, date: "2026-08-30", reason: "Duplicate charge" }
  ];

  // Product catalogue (categories + icons). Prices read live from CM so admin
  // edits reflect instantly. Token packs mirror worker.js RZP_PRODUCTS.
  var TOKEN_PACKS = [
    { id: "tok20",  name: "20 Analysis Tokens",  price: 49,  emoji: "🎟️" },
    { id: "tok60",  name: "60 Analysis Tokens",  price: 99,  emoji: "🎫" },
    { id: "tok150", name: "150 Analysis Tokens", price: 199, emoji: "🎠" }
  ];
  var PLAN_ICON = { free: "🆓", plus: "✨", pro: "🏆", diamond: "💎" };
  var PLAN_BADGE = { free: "b-free", plus: "b-plus", pro: "b-pro", diamond: "b-diamond" };

  function localUser() {
    var s = CM.load();
    return { name: s.profile.name || "You (this device)", email: (window.CMCloud && CMCloud.user && CMCloud.user.email) || "you@this-device",
      plan: s.profile.plan || "free", persona: s.profile.persona || "—", joined: (s.meta.createdAt || "").slice(0, 10),
      last: new Date().toISOString().slice(0, 10), ai: s.usage.aiQuestions || 0, status: "active", country: "IN", local: true };
  }
  function allUsers() { return liveOn() ? (LIVE.users || []) : [localUser()].concat(DEMO_USERS); }
  function allInvoices() { return liveOn() ? (LIVE.invoices || []) : DEMO_INVOICES; }
  function allRefunds() { return liveOn() ? (LIVE.refunds || []) : DEMO_REFUNDS; }
  function planPrice(id) { return (CM.PLANS[id] && CM.PLANS[id].price) || 0; }
  function packPrice(id) { var p = TOKEN_PACKS.filter(function (x) { return x.id === id; })[0]; return p ? p.price : 0; }
  function productPrice(id) { return CM.PLANS[id] ? planPrice(id) : packPrice(id); }
  function productName(id) { return CM.PLANS[id] ? CM.PLANS[id].name : (TOKEN_PACKS.filter(function (x) { return x.id === id; })[0] || { name: id }).name; }

  // ---- filter state (persist across re-render within session) ---------------
  var FILTER = { plan: "", status: "", q: "" };
  var TAB = "overview";

  // ===========================================================================
  //  LOGIN SCREEN
  // ===========================================================================
  function renderLogin() {
    root.innerHTML = "";
    var wrap = el('<div class="cm-login"></div>');
    var card = el('<div class="cm-login-card"></div>');
    card.appendChild(el('<div style="width:52px;height:52px;border-radius:14px;background:#0b1533;display:flex;align-items:center;justify-content:center;font-size:1.6rem">🔐</div>'));
    card.appendChild(el('<h1>Admin Control Panel</h1>'));
    card.appendChild(el('<p>ChintasMoney — owner access only.</p>'));
    var errP = el('<p class="cm-err"></p>');
    var uF = el('<label class="cm-fld"><span>Username</span><input type="text" autocomplete="username" placeholder="username"/></label>');
    var pF = el('<label class="cm-fld"><span>Password</span><input type="password" autocomplete="current-password" placeholder="password"/></label>');
    var btn = el('<button class="cm-btn p" style="width:100%;margin-top:6px">Sign in</button>');
    function localAttempt() {
      var c = creds();
      if (uF.querySelector("input").value.trim() === c.user && pF.querySelector("input").value === c.pass) {
        setAuthed(true); LIVE.state = "demo"; render();
      } else { errP.textContent = "Wrong username or password."; }
    }
    function attempt() {
      errP.textContent = "Signing in…"; btn.disabled = true;
      var u = uF.querySelector("input").value.trim(), p = pF.querySelector("input").value;
      fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: u, password: p }) })
        .then(function (r) {
          if (r.status === 200) return r.json().then(function (d) { setToken(d.token); LIVE.state = "idle"; fetchLive(); render(); });
          if (r.status === 401) { errP.textContent = "Wrong username or password."; btn.disabled = false; return; }
          // 501/not configured (or other) → fall back to the local gate + demo data.
          btn.disabled = false; localAttempt();
        })
        .catch(function () { btn.disabled = false; localAttempt(); });
    }
    btn.addEventListener("click", attempt);
    card.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });
    card.appendChild(uF); card.appendChild(pF); card.appendChild(errP); card.appendChild(btn);
    card.appendChild(el('<p class="cm-hint" style="margin-top:16px;text-align:center">Client-side gate. For production, protect this route server-side.</p>'));
    wrap.appendChild(card); root.appendChild(wrap);
  }

  // ===========================================================================
  //  SHELL
  // ===========================================================================
  var TABTITLE = { overview: "Overview", people: "People Logged", calendar: "Activity Calendar",
    content: "Content Calendar", catalogue: "Product Catalogue & Prices",
    revenue: "Revenue, Invoices & Refunds", gating: "Locked Sections & Gating", flags: "Feature Flags",
    exportt: "Export / Download", privacy: "Privacy & Security" };

  // Month shown by the calendars (0 = current month, -1 = last month, etc.)
  var CAL_OFFSET = 0;
  function monthMeta(offset) {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    var y = d.getFullYear(), m = d.getMonth();
    return { y: y, m: m, first: new Date(y, m, 1).getDay(), days: new Date(y, m + 1, 0).getDate(),
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }) };
  }
  function ymd(y, m, day) { return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
  // Content plan persists per-device via admin config.
  function contentPlan() { var c = CM.adminConfig(); return c.contentPlan || {}; }
  function saveContentPlan(p) { var c = CM.adminConfig(); c.contentPlan = p; CM.saveAdmin(c); }

  function render() {
    if (!isAuthed()) return renderLogin();
    // Kick off the live fetch once per session for a real (server) token.
    if (LIVE.state === "idle" && token() !== "1") fetchLive();
    root.innerHTML = "";
    var shell = el('<div class="cm-shell"></div>');

    var side = el('<aside class="cm-side"></aside>');
    side.appendChild(el('<a class="cm-brand" href="index.html"><img src="assets/logo.png" alt=""/><span>ChintasMoney<small>CONTROL PANEL</small></span></a>'));
    [["overview", "▦ Overview"], ["people", "👥 People logged"], ["calendar", "📅 Activity calendar"],
     ["content", "🗓️ Content calendar"], ["catalogue", "🏷️ Products & prices"],
     ["revenue", "₹ Revenue & invoices"], ["gating", "🔒 Locked sections"], ["flags", "⚑ Feature flags"],
     ["exportt", "⬇ Export everything"], ["privacy", "🛡️ Privacy & security"]].forEach(function (t) {
      var b = el('<button class="cm-nav' + (TAB === t[0] ? " on" : "") + '">' + t[1] + '</button>');
      b.addEventListener("click", function () { TAB = t[0]; render(); });
      side.appendChild(b);
    });
    side.appendChild(el('<div class="cm-sep"></div>'));
    side.appendChild(el('<a class="cm-nav" href="index.html">↩ Back to app</a>'));
    var out = el('<button class="cm-nav">⎋ Sign out</button>');
    out.addEventListener("click", function () { setToken(""); LIVE = { state: "idle", users: null, invoices: null, refunds: null, error: "" }; render(); });
    side.appendChild(out);
    shell.appendChild(side);

    var main = el('<main class="cm-main"></main>');
    var top = el('<div class="cm-top"></div>');
    var menuBtn = el('<button class="cm-btn sm cm-menu-btn">☰</button>');
    menuBtn.addEventListener("click", function () { side.classList.toggle("open"); });
    var titleBox = el('<div></div>');
    titleBox.appendChild(el('<h1 class="cm-h1">' + TABTITLE[TAB] + '</h1>'));
    var srcTxt = LIVE.state === "loading" ? "Loading live data…"
      : LIVE.state === "live" ? "🟢 Live data — signed in via server (Supabase)."
      : "🟡 Demo data — " + (LIVE.error || "server admin API not configured yet.");
    titleBox.appendChild(el('<div class="cm-sub">' + srcTxt + '</div>'));
    var titleWrap = el('<div style="display:flex;gap:12px;align-items:center"></div>');
    titleWrap.appendChild(menuBtn); titleWrap.appendChild(titleBox);
    top.appendChild(titleWrap);
    // Refresh button — re-pull live data (payments/users) without reloading the page.
    var refreshBtn = el('<button class="cm-btn sm" title="Reload live data">' + (LIVE.state === "loading" ? "⏳ Refreshing…" : "🔄 Refresh") + '</button>');
    if (LIVE.state === "loading") refreshBtn.disabled = true;
    refreshBtn.addEventListener("click", function () {
      if (token() === "1") { render(); return; } // demo gate — nothing live to pull
      LIVE.state = "loading"; render(); fetchLive();
    });
    top.appendChild(refreshBtn);
    main.appendChild(top);
    main.appendChild(TABS[TAB]());
    shell.appendChild(main);
    root.appendChild(shell);
  }

  function stat(lbl, val, hint) {
    return el('<div class="cm-card cm-stat"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="hint">' + (hint || "") + '</span></div>');
  }

  // ---- revenue helpers ------------------------------------------------------
  function paidInvoices() { return allInvoices().filter(function (i) { return i.status === "paid"; }); }
  function grossRevenue() { return paidInvoices().reduce(function (a, i) { return a + i.amount; }, 0); }
  function refundTotal() { return allRefunds().reduce(function (a, r) { return a + r.amount; }, 0); }
  function netRevenue() { return grossRevenue() - refundTotal(); }
  function mrr() {
    return allUsers().reduce(function (a, u) { return a + (u.status === "active" ? planPrice(u.plan) : 0); }, 0);
  }

  // ===========================================================================
  //  TABS
  // ===========================================================================
  function calMonthNav(v) {
    var mm = monthMeta(CAL_OFFSET);
    var hd = el('<div class="cm-cal-hd"></div>');
    var prev = el('<button class="cm-btn sm">‹ Prev</button>');
    var next = el('<button class="cm-btn sm">Next ›</button>');
    prev.addEventListener("click", function () { CAL_OFFSET--; render(); });
    next.addEventListener("click", function () { CAL_OFFSET++; render(); });
    hd.appendChild(prev);
    hd.appendChild(el('<h3>' + mm.label + '</h3>'));
    hd.appendChild(next);
    v.appendChild(hd);
    return mm;
  }
  function calGrid() {
    var g = el('<div class="cm-cal"></div>');
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(function (d) { g.appendChild(el('<div class="dow">' + d + '</div>')); });
    return g;
  }

  var TABS = {
    // -------- ACTIVITY CALENDAR (signups + logins per day) -------------------
    calendar: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">New signups and active users per day, from real accounts. Green = new signups, purple = users last active that day.</div>'));
      var mm = calMonthNav(v);
      var users = allUsers();
      var newBy = {}, actBy = {};
      users.forEach(function (u) {
        if (u.joined) newBy[u.joined] = (newBy[u.joined] || 0) + 1;
        if (u.last) actBy[u.last] = (actBy[u.last] || 0) + 1;
      });
      var todayStr = new Date().toISOString().slice(0, 10);
      var g = calGrid();
      for (var i = 0; i < mm.first; i++) g.appendChild(el('<div class="cm-day empty"></div>'));
      var mNew = 0, mAct = 0;
      for (var day = 1; day <= mm.days; day++) {
        var key = ymd(mm.y, mm.m, day);
        var cell = el('<div class="cm-day' + (key === todayStr ? " today" : "") + '"></div>');
        cell.appendChild(el('<span class="dn">' + day + '</span>'));
        if (newBy[key]) { cell.appendChild(el('<span class="cm-pill new">+' + newBy[key] + ' new</span>')); mNew += newBy[key]; }
        if (actBy[key]) { cell.appendChild(el('<span class="cm-pill act">' + actBy[key] + ' active</span>')); mAct += actBy[key]; }
        g.appendChild(cell);
      }
      v.appendChild(g);
      var s = el('<div class="cm-grid cm-g3" style="margin-top:16px"></div>');
      s.appendChild(stat("New signups", String(mNew), "this month"));
      s.appendChild(stat("Active users", String(mAct), "last-active this month"));
      s.appendChild(stat("Total users", String(users.length), liveOn() ? "live" : "demo"));
      v.appendChild(s);
      return v;
    },

    // -------- CONTENT CALENDAR (plan your posts) -----------------------------
    content: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Plan your posts/Reels. Tap a day to add or edit what goes out. Saved on this device.</div>'));
      var tools = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>');
      var auto = el('<button class="cm-btn sm p">✨ Auto-plan 22 Reels from tomorrow</button>');
      auto.addEventListener("click", function () {
        if (!confirm("Add 'Reel #1..#22' to the next 22 days starting tomorrow? Existing entries on those days are kept.")) return;
        var plan = contentPlan(); var d = new Date(); d.setDate(d.getDate() + 1);
        for (var n = 1; n <= 22; n++) {
          var key = d.toISOString().slice(0, 10);
          plan[key] = (plan[key] || []).concat(["Reel #" + n]);
          d.setDate(d.getDate() + 1);
        }
        saveContentPlan(plan); render();
      });
      var clear = el('<button class="cm-btn sm danger">Clear all planned</button>');
      clear.addEventListener("click", function () { if (confirm("Remove all planned posts?")) { saveContentPlan({}); render(); } });
      tools.appendChild(auto); tools.appendChild(clear);
      v.appendChild(tools);
      var mm = calMonthNav(v);
      var plan = contentPlan();
      var todayStr = new Date().toISOString().slice(0, 10);
      var g = calGrid();
      for (var i = 0; i < mm.first; i++) g.appendChild(el('<div class="cm-day empty"></div>'));
      for (var day = 1; day <= mm.days; day++) {
        (function (key) {
          var cell = el('<div class="cm-day plan' + (key === todayStr ? " today" : "") + '"></div>');
          cell.appendChild(el('<span class="dn">' + key.slice(8) + '</span>'));
          (plan[key] || []).forEach(function (item) { cell.appendChild(el('<span class="cm-chip" title="' + esc(item) + '">' + esc(item) + '</span>')); });
          cell.addEventListener("click", function () {
            var cur = (plan[key] || []).join("; ");
            var next = prompt("Posts for " + key + " (separate multiple with ; ). Leave blank to clear:", cur);
            if (next === null) return;
            var items = next.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
            if (items.length) plan[key] = items; else delete plan[key];
            saveContentPlan(plan); render();
          });
          g.appendChild(cell);
        })(ymd(mm.y, mm.m, day));
      }
      v.appendChild(g);
      var count = Object.keys(plan).reduce(function (a, k) { return a + plan[k].length; }, 0);
      v.appendChild(el('<div class="cm-hint" style="margin-top:12px">' + count + ' post(s) planned in total. Tip: use the button above to schedule your 22 videos in one tap, then tweak days.</div>'));
      return v;
    },

    overview: function () {
      var v = el('<div></div>');
      var users = allUsers();
      var g = el('<div class="cm-grid cm-g4"></div>');
      g.appendChild(stat("People logged", String(users.length), "incl. this device"));
      g.appendChild(stat("Paying users", String(users.filter(function (u) { return planPrice(u.plan) > 0; }).length), "Plus / Platinum / Diamond"));
      g.appendChild(stat("Net revenue", money(netRevenue()), "after refunds"));
      g.appendChild(stat("MRR", money(mrr()), "monthly recurring"));
      v.appendChild(g);

      var g2 = el('<div class="cm-grid cm-g4" style="margin-top:14px"></div>');
      g2.appendChild(stat("Invoices", String(allInvoices().length), paidInvoices().length + " paid"));
      g2.appendChild(stat("Refunds", String(allRefunds().length), money(refundTotal()) + " returned"));
      g2.appendChild(stat("Past due", String(users.filter(function (u) { return u.status === "past_due"; }).length), "need attention"));
      g2.appendChild(stat("AI questions", String(users.reduce(function (a, u) { return a + u.ai; }, 0)), "all-time"));
      v.appendChild(g2);

      // plan mix
      var mix = el('<div class="cm-card" style="margin-top:16px"><div class="cm-hd"><h3>Plan mix</h3></div></div>');
      ["free", "plus", "pro", "diamond"].forEach(function (id) {
        var n = users.filter(function (u) { return u.plan === id; }).length;
        var w = users.length ? Math.round(n / users.length * 100) : 0;
        mix.appendChild(el('<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>' + PLAN_ICON[id] + ' ' + CM.PLANS[id].name + '</span><span class="cm-muted">' + n + ' · ' + w + '%</span></div><div class="cm-bar"><i style="width:' + w + '%"></i></div></div>'));
      });
      v.appendChild(mix);
      v.appendChild(el('<div class="cm-note" style="margin-top:14px">Cross-user rows are demo data. Prices, gating and flags you change here are <b>real</b> and take effect in the live app immediately.</div>'));
      return v;
    },

    // -------- PEOPLE LOGGED (emails, plan, when they came, filters) ----------
    people: function () {
      var v = el('<div></div>');
      v.appendChild(filterBar());
      var users = applyFilter(allUsers());
      if (!users.length) { v.appendChild(el('<div class="cm-card cm-muted">No users match the filter.</div>')); return v; }
      var grid = el('<div class="cm-cards"></div>');
      users.forEach(function (u) {
        var initials = (u.name || "?").split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join("").toUpperCase();
        var card = el('<div class="cm-uc"></div>');
        var top = el('<div class="cm-uc-top"></div>');
        top.appendChild(el('<div class="cm-av">' + esc(initials || "U") + '</div>'));
        top.appendChild(el('<div style="min-width:0"><div class="cm-uc-name">' + esc(u.name) + (u.local ? ' <span class="cm-badge b-ok">this device</span>' : '') + '</div><div class="cm-uc-mail">' + esc(u.email) + '</div></div>'));
        card.appendChild(top);
        card.appendChild(el('<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<span class="cm-badge ' + PLAN_BADGE[u.plan] + '">' + PLAN_ICON[u.plan] + ' ' + CM.PLANS[u.plan].name + '</span>' +
          '<span class="cm-badge ' + (u.status === "active" ? "b-ok" : "b-bad") + '">' + esc(u.status.replace("_", " ")) + '</span></div>'));
        card.appendChild(el('<div class="cm-uc-meta">' +
          '<div><span class="k">Persona</span><span class="v">' + esc(u.persona) + '</span></div>' +
          '<div><span class="k">AI questions</span><span class="v">' + u.ai + '</span></div>' +
          '<div><span class="k">Joined</span><span class="v">' + esc(u.joined) + '</span></div>' +
          '<div><span class="k">Last login</span><span class="v">' + esc(u.last) + '</span></div></div>'));
        grid.appendChild(card);
      });
      v.appendChild(grid);
      var dl = el('<div style="margin-top:12px"><button class="cm-btn sm">⬇ Download these users (CSV)</button></div>');
      dl.querySelector("button").addEventListener("click", function () {
        downloadCSV("chintasmoney-users.csv", ["name", "email", "plan", "persona", "status", "ai", "joined", "last"], users);
      });
      v.appendChild(dl);
      return v;
    },

    // -------- PRODUCT CATALOGUE & PRICES (editable, icon per category) -------
    catalogue: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Edit any price and hit <b>Save</b> — it updates the app and the payment amount reference instantly. Token-pack amounts are also enforced server-side in the Worker.</div>'));

      // Subscriptions
      v.appendChild(el('<div class="cm-hd"><h3>📦 Subscription plans</h3></div>'));
      var g = el('<div class="cm-grid cm-g2"></div>');
      Object.keys(CM.PLANS).forEach(function (id) {
        var p = CM.PLANS[id];
        var card = el('<div class="cm-cat"></div>');
        card.appendChild(el('<div class="ic" style="background:#ede9fe">' + PLAN_ICON[id] + '</div>'));
        var body = el('<div style="flex:1;min-width:0"></div>');
        body.appendChild(el('<h3>' + esc(p.name) + ' <span class="cm-badge ' + PLAN_BADGE[id] + '">' + id + '</span></h3>'));
        body.appendChild(el('<div class="cm-hint">' + esc(p.blurb) + '</div>'));
        var lab = el('<label class="cm-fld" style="margin:10px 0 8px"><span>Price (₹ / ' + esc(p.cadence) + ')</span><input type="number" min="0" value="' + p.price + '"/></label>');
        body.appendChild(lab);
        var save = el('<button class="cm-btn p sm">Save price</button>');
        save.addEventListener("click", function () { CM.setPlanPrice(id, +lab.querySelector("input").value || 0); render(); });
        body.appendChild(save);
        body.appendChild(el('<div style="margin-top:10px"><div class="cm-hint" style="font-weight:700;color:#475569">Included</div><ul style="margin:4px 0 0;padding-left:18px;font-size:.82rem;color:#475569">' + p.features.slice(0, 6).map(function (f) { return '<li>' + esc(f.replace(/-/g, " ")) + '</li>'; }).join("") + '</ul></div>'));
        card.appendChild(body);
        g.appendChild(card);
      });
      v.appendChild(g);

      // Token packs
      v.appendChild(el('<div class="cm-hd" style="margin-top:20px"><h3>🎟️ Analysis token packs</h3></div>'));
      var g2 = el('<div class="cm-grid cm-g3"></div>');
      TOKEN_PACKS.forEach(function (t) {
        var card = el('<div class="cm-cat"></div>');
        card.appendChild(el('<div class="ic" style="background:#dcfce7">' + t.emoji + '</div>'));
        var body = el('<div style="flex:1"></div>');
        body.appendChild(el('<h3>' + esc(t.name) + '</h3>'));
        body.appendChild(el('<div class="cm-hint">One-off top-up · ' + esc(t.id) + '</div>'));
        body.appendChild(el('<div style="font-size:1.3rem;font-weight:800;margin-top:8px">' + money(t.price) + '</div>'));
        body.appendChild(el('<div class="cm-hint">Amounts are set in <code>worker.js</code> (server-authoritative).</div>'));
        card.appendChild(body);
        g2.appendChild(card);
      });
      v.appendChild(g2);
      return v;
    },

    // -------- REVENUE, INVOICES & REFUNDS ------------------------------------
    revenue: function () {
      var v = el('<div></div>');
      var g = el('<div class="cm-grid cm-g4"></div>');
      g.appendChild(stat("Total money made", money(grossRevenue()), "gross, paid invoices"));
      g.appendChild(stat("Net revenue", money(netRevenue()), "after refunds"));
      g.appendChild(stat("Invoices", String(allInvoices().length), paidInvoices().length + " paid"));
      g.appendChild(stat("Refunds", money(refundTotal()), allRefunds().length + " refunded"));
      v.appendChild(g);

      v.appendChild(filterBar(true));
      var invs = applyInvoiceFilter(allInvoices());
      v.appendChild(el('<div class="cm-hd"><h3>Invoices</h3></div>'));
      if (!invs.length) v.appendChild(el('<div class="cm-card cm-muted">No invoices match the filter.</div>'));
      else {
        var ig = el('<div class="cm-cards"></div>');
        invs.forEach(function (i) {
          var sb = i.status === "paid" ? "b-ok" : i.status === "refunded" ? "b-warn" : "b-bad";
          var card = el('<div class="cm-inv"></div>');
          card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(i.id) + '</span><span class="cm-badge ' + sb + '">' + esc(i.status.replace("_", " ")) + '</span></div>'));
          card.appendChild(el('<div class="cm-inv-amt">' + money(i.amount) + '</div>'));
          card.appendChild(el('<div style="font-size:.86rem"><b>' + esc(productName(i.product)) + '</b></div>'));
          card.appendChild(el('<div class="cm-uc-mail">' + esc(i.email) + '</div>'));
          card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">' + esc(i.method) + '</span><span class="cm-muted">' + esc(i.date) + '</span></div>'));
          ig.appendChild(card);
        });
        v.appendChild(ig);
      }
      var dl = el('<div style="margin:12px 0"><button class="cm-btn sm">⬇ Download invoices (CSV)</button></div>');
      dl.querySelector("button").addEventListener("click", function () { downloadCSV("chintasmoney-invoices.csv", ["id", "email", "product", "amount", "method", "status", "date"], invs); });
      v.appendChild(dl);

      // refunds
      v.appendChild(el('<div class="cm-hd"><h3>Refunds</h3></div>'));
      if (!allRefunds().length) v.appendChild(el('<div class="cm-card cm-muted">No refunds.</div>'));
      else {
        var rg = el('<div class="cm-cards"></div>');
        allRefunds().forEach(function (r) {
          var card = el('<div class="cm-inv"></div>');
          card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(r.id) + '</span><span class="cm-badge b-warn">refunded</span></div>'));
          card.appendChild(el('<div class="cm-inv-amt">' + money(r.amount) + '</div>'));
          card.appendChild(el('<div style="font-size:.86rem"><b>' + esc(productName(r.product)) + '</b></div>'));
          card.appendChild(el('<div class="cm-uc-mail">' + esc(r.email) + '</div>'));
          card.appendChild(el('<div style="font-size:.82rem;color:#475569">Reason: ' + esc(r.reason) + '</div>'));
          card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">inv ' + esc(r.invoice) + '</span><span class="cm-muted">' + esc(r.date) + '</span></div>'));
          rg.appendChild(card);
        });
        v.appendChild(rg);
      }
      v.appendChild(el('<div class="cm-note" style="margin-top:14px">Real invoices &amp; refunds appear here once the Razorpay webhook is stored in a backend. Today these are demo figures.</div>'));
      return v;
    },

    // -------- LOCKED SECTIONS / GATING EDITOR --------------------------------
    gating: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Set the <b>minimum plan</b> required for each section. Lower it to unlock a feature for everyone; raise it to lock it behind a paid plan. Changes apply live.</div>'));
      var order = ["free", "plus", "pro", "diamond"];
      var c = el('<div class="cm-card"><div class="cm-hd"><h3>Section access</h3></div></div>');
      Object.keys(CM.FEATURE_MATRIX).forEach(function (area) {
        var cur = CM.FEATURE_MATRIX[area];
        var row = el('<div class="cm-row"></div>');
        row.appendChild(el('<div><b>' + esc(area) + '</b><div class="cm-hint">min plan: ' + esc(CM.PLANS[cur].name) + '</div></div>'));
        var sel = el('<select style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:9px;font-family:inherit">' +
          order.map(function (id) { return '<option value="' + id + '"' + (id === cur ? " selected" : "") + '>' + CM.PLANS[id].name + '</option>'; }).join("") + '</select>');
        sel.addEventListener("change", function () { CM.setFeatureGate(area, sel.value); render(); });
        row.appendChild(sel);
        c.appendChild(row);
      });
      v.appendChild(c);
      return v;
    },

    // -------- FEATURE FLAGS --------------------------------------------------
    flags: function () {
      var v = el('<div></div>');
      var cfg = CM.adminConfig();
      var c = el('<div class="cm-card"><div class="cm-hd"><h3>Feature flags</h3></div></div>');
      Object.keys(cfg.flags).forEach(function (k) {
        var on = !!cfg.flags[k];
        var row = el('<div class="cm-row"></div>');
        row.appendChild(el('<div><b>' + esc(k) + '</b><div class="cm-hint">' + (on ? "Enabled" : "Disabled") + '</div></div>'));
        var btn = el('<button class="cm-btn sm' + (on ? "" : " p") + '">' + (on ? "Disable" : "Enable") + '</button>');
        btn.addEventListener("click", function () { CM.setFlag(k, !on); render(); });
        row.appendChild(btn);
        c.appendChild(row);
      });
      v.appendChild(c);
      return v;
    },

    // -------- EXPORT / DOWNLOAD EVERYTHING -----------------------------------
    exportt: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Download a full backup of the control-panel data and configuration.</div>'));
      var g = el('<div class="cm-grid cm-g2"></div>');
      var items = [
        ["📦 Everything (JSON)", "Full snapshot: users, invoices, refunds, catalogue, config.", function () {
          downloadJSON("chintasmoney-backup.json", {
            exportedAt: new Date().toISOString(), users: allUsers(), invoices: allInvoices(), refunds: allRefunds(),
            catalogue: { plans: CM.PLANS, tokenPacks: TOKEN_PACKS }, config: CM.adminConfig(),
            revenue: { gross: grossRevenue(), refunds: refundTotal(), net: netRevenue(), mrr: mrr() }
          });
        }],
        ["👥 Users (CSV)", "All people logged with plan, email, dates.", function () {
          downloadCSV("chintasmoney-users.csv", ["name", "email", "plan", "persona", "status", "ai", "joined", "last"], allUsers());
        }],
        ["🧾 Invoices (CSV)", "Every invoice with amount, method, status.", function () {
          downloadCSV("chintasmoney-invoices.csv", ["id", "email", "product", "amount", "method", "status", "date"], allInvoices());
        }],
        ["↩ Refunds (CSV)", "All refunds with reason and amount.", function () {
          downloadCSV("chintasmoney-refunds.csv", ["id", "invoice", "email", "product", "amount", "reason", "date"], allRefunds());
        }],
        ["🏷️ Catalogue (JSON)", "Plans and token packs with current prices.", function () {
          downloadJSON("chintasmoney-catalogue.json", { plans: CM.PLANS, tokenPacks: TOKEN_PACKS });
        }],
        ["⚙️ Config (JSON)", "Price overrides, gating and flags.", function () {
          downloadJSON("chintasmoney-config.json", CM.adminConfig());
        }]
      ];
      items.forEach(function (it) {
        var card = el('<div class="cm-card"></div>');
        card.appendChild(el('<h3 style="margin:0 0 4px;font-size:1rem">' + it[0] + '</h3>'));
        card.appendChild(el('<div class="cm-hint" style="margin-bottom:12px">' + it[1] + '</div>'));
        var b = el('<button class="cm-btn p sm">Download</button>');
        b.addEventListener("click", it[2]);
        card.appendChild(b);
        g.appendChild(card);
      });
      v.appendChild(g);
      return v;
    },

    // -------- PRIVACY & SECURITY ---------------------------------------------
    privacy: function () {
      var v = el('<div></div>');
      // change credentials
      var c = el('<div class="cm-card"><div class="cm-hd"><h3>🔑 Admin credentials</h3></div></div>');
      var msg = el('<p class="cm-err" style="color:#166534"></p>');
      var uF = el('<label class="cm-fld"><span>Username</span><input type="text" value="' + esc(creds().user) + '"/></label>');
      var pF = el('<label class="cm-fld"><span>New password</span><input type="password" placeholder="leave blank to keep current"/></label>');
      var save = el('<button class="cm-btn p sm">Update credentials</button>');
      save.addEventListener("click", function () {
        var cfg = CM.adminConfig();
        var newUser = uF.querySelector("input").value.trim() || creds().user;
        var newPass = pF.querySelector("input").value || creds().pass;
        cfg.auth = { user: newUser, pass: newPass };
        CM.saveAdmin(cfg);
        msg.textContent = "Credentials updated. They apply on next sign-in.";
        pF.querySelector("input").value = "";
      });
      c.appendChild(uF); c.appendChild(pF); c.appendChild(save); c.appendChild(msg);
      c.appendChild(el('<div class="cm-note" style="margin-top:14px">This gate is client-side only. Anyone with the files could bypass it — treat it as a lock on the door, not a vault. For real protection, gate <code>/app/admin.html</code> behind server auth (e.g. Cloudflare Access).</div>'));
      v.appendChild(c);

      // privacy / data controls
      var pc = el('<div class="cm-card" style="margin-top:16px"><div class="cm-hd"><h3>🛡️ Data &amp; privacy</h3></div></div>');
      pc.appendChild(el('<div class="cm-row"><div><b>User emails</b><div class="cm-hint">Shown for support &amp; billing only. Never sold or shared.</div></div><span class="cm-badge b-ok">private</span></div>'));
      pc.appendChild(el('<div class="cm-row"><div><b>Payment card data</b><div class="cm-hint">Handled entirely by Razorpay — never stored by ChintasMoney.</div></div><span class="cm-badge b-ok">not stored</span></div>'));
      pc.appendChild(el('<div class="cm-row"><div><b>Cookie consent</b><div class="cm-hint">Ads/analytics load only after consent (consent.js).</div></div><span class="cm-badge b-ok">enforced</span></div>'));
      var wipe = el('<div class="cm-row"><div><b>Reset local admin config</b><div class="cm-hint">Clears price/gating/flag overrides &amp; admin credentials on THIS device.</div></div></div>');
      var wb = el('<button class="cm-btn sm danger">Reset config</button>');
      wb.addEventListener("click", function () {
        if (confirm("Reset all admin overrides and credentials on this device?")) {
          try { localStorage.removeItem("chintasmoney.admin.v1"); } catch (e) {}
          alert("Admin config reset. Default credentials restored."); render();
        }
      });
      wipe.appendChild(wb); pc.appendChild(wipe);
      v.appendChild(pc);
      return v;
    }
  };

  // ---- shared filter bar ----------------------------------------------------
  function filterBar(forInvoices) {
    var bar = el('<div class="cm-filter"></div>');
    var q = el('<label class="cm-fld"><span>Search email / name</span><input type="text" placeholder="type to filter…"/></label>');
    q.querySelector("input").value = FILTER.q;
    q.querySelector("input").addEventListener("input", function () { FILTER.q = this.value; render(); setTimeout(function(){ var i=document.querySelector(".cm-filter input"); if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);} },0); });
    bar.appendChild(q);
    var plan = el('<label class="cm-fld"><span>Plan / product</span><select><option value="">All</option>' +
      ["free", "plus", "pro", "diamond"].map(function (id) { return '<option value="' + id + '"' + (FILTER.plan === id ? " selected" : "") + '>' + CM.PLANS[id].name + '</option>'; }).join("") + '</select></label>');
    plan.querySelector("select").addEventListener("change", function () { FILTER.plan = this.value; render(); });
    bar.appendChild(plan);
    var opts = forInvoices ? ["paid", "past_due", "refunded"] : ["active", "past_due"];
    var status = el('<label class="cm-fld"><span>Status</span><select><option value="">All</option>' +
      opts.map(function (s) { return '<option value="' + s + '"' + (FILTER.status === s ? " selected" : "") + '>' + s.replace("_", " ") + '</option>'; }).join("") + '</select></label>');
    status.querySelector("select").addEventListener("change", function () { FILTER.status = this.value; render(); });
    bar.appendChild(status);
    var clear = el('<button class="cm-btn sm">Clear</button>');
    clear.addEventListener("click", function () { FILTER = { plan: "", status: "", q: "" }; render(); });
    bar.appendChild(clear);
    return bar;
  }
  function applyFilter(users) {
    var q = FILTER.q.trim().toLowerCase();
    return users.filter(function (u) {
      if (FILTER.plan && u.plan !== FILTER.plan) return false;
      if (FILTER.status && u.status !== FILTER.status) return false;
      if (q && (u.email + " " + u.name).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function applyInvoiceFilter(invs) {
    var q = FILTER.q.trim().toLowerCase();
    return invs.filter(function (i) {
      if (FILTER.plan && i.product !== FILTER.plan) return false;
      if (FILTER.status && i.status !== FILTER.status) return false;
      if (q && (i.email + " " + i.id).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  // ---- download helpers -----------------------------------------------------
  function triggerDownload(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function downloadJSON(name, obj) { triggerDownload(name, new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); }
  function downloadCSV(name, cols, rows) {
    function cell(x) { var s = x == null ? "" : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var lines = [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(","); }));
    triggerDownload(name, new Blob([lines.join("\n")], { type: "text/csv" }));
  }

  render();
})();
