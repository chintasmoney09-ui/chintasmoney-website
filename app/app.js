/* ChintasMoney — Trader Report Card (client-side SPA)
 * A behavioural mirror for traders: Discipline Score, personality, mistakes,
 * streaks, badges, shareable card, and an evidence-based discipline coach.
 * NOT financial advice — no buy/sell calls. Data is the trader's own.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";
  var root = document.getElementById("root");
  var CM = window.CM;

  function el(h) { var t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; }
  function money(n) { var v = Math.round(n); return (v < 0 ? "-₹" : "₹") + Math.abs(v).toLocaleString("en-IN"); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function ago(iso) { var d = Math.round((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : d + "d ago"; }

  var NAV = [
    { id: "today", label: "Today", ic: "⚡" },
    { id: "home", label: "My Report Card", ic: "◎" },
    { id: "checklist", label: "Pre-Trade Check", ic: "✅" },
    { id: "log", label: "Log a Trade", ic: "＋" },
    { id: "trades", label: "Trade Journal", ic: "▤" },
    { id: "markets", label: "Charts", ic: "📈" },
    { id: "analytics", label: "Analytics", ic: "📊" },
    { id: "report", label: "My Report", ic: "🧾" },
    { id: "calc", label: "Risk Calculator", ic: "🧮" },
    { id: "dreams", label: "Dream Planner", ic: "💭" },
    { sep: true, group: "Understand yourself" },
    { id: "replay", label: "Trade Replay", ic: "🎬" },
    { id: "insights", label: "Mistake Insights", ic: "🔍" },
    { id: "strategy", label: "Setup Performance", ic: "▦" },
    { id: "coach", label: "Discipline Coach", ic: "✦" },
    { sep: true, group: "Play" },
    { id: "badges", label: "Streaks & Badges", ic: "🏅" },
    { id: "leaderboard", label: "Leaderboard", ic: "🏆" },
    { id: "card", label: "Shareable Card", ic: "↗" },
    { sep: true },
    { id: "profile", label: "Profile & Plan", ic: "☰" }
  ];

  // Plain, directive one-liner for every section: what it is + what to do.
  var SECTION_HELP = {
    today: "Your daily home base — open it each day for your discipline score, today's mission and quick actions.",
    home: "Your headline scorecard: discipline score, trader personality and key stats. Check how you're really doing.",
    checklist: "Run this 30-second check before you enter a trade — it catches bad setups before they cost you money.",
    log: "Record each trade after you take it. This powers every score and insight, so log honestly.",
    trades: "Every trade you've logged, in one place. Review, edit, or tap 📈 to analyse any trade on the live chart.",
    markets: "Live charts for any market. Study the price, then tap “📐 Size this trade” to plan it in the calculator.",
    analytics: "Deeper numbers from your logs — trends, win rate, risk:reward and more.",
    report: "A clean summary of your trading you can download, print or save as a PDF to share.",
    calc: "Work out how much to buy and where to put your stop — before you risk real money. Then log it in one tap.",
    dreams: "Set a money goal (a bike, a trip) and see how disciplined trading gets you there.",
    replay: "Replay any trade on the real market for its actual dates — see what would have happened, and whether you exited too early or too late.",
    insights: "Your repeating mistakes, ranked by how often they cost you — so you know exactly what to fix first.",
    strategy: "See which of your setups actually make money, and which quietly bleed your account.",
    coach: "Ask the AI coach about your own trading and get an honest, data-based verdict.",
    badges: "Earn streaks and badges for disciplined habits — keep your streak alive.",
    leaderboard: "See how your discipline ranks against other traders. We reward discipline, never profit.",
    card: "Create a shareable card of your discipline score to post or send to friends.",
    profile: "Your account, plan and data — manage your subscription and keep your journal safe."
  };
  function helpDismissed(id) { try { return localStorage.getItem("cm.help." + id) === "1"; } catch (e) { return false; } }
  function dismissHelp(id) { try { localStorage.setItem("cm.help." + id, "1"); } catch (e) {} }
  function sectionGuide(id) {
    var text = SECTION_HELP[id]; if (!text || helpDismissed(id)) return null;
    var g = el('<div class="sec-guide"><span class="sg-ic">💡</span><span class="sg-tx">' + esc(text) + '</span><button class="sg-x" title="Got it — hide this">✕</button></div>');
    g.querySelector(".sg-x").addEventListener("click", function () { dismissHelp(id); g.remove(); });
    return g;
  }

  var mobileOpen = false;
  function route() { return location.hash.replace(/^#\/?/, "") || "today"; }
  function go(r) { location.hash = "#/" + r; }
  window.addEventListener("hashchange", render);

  window.__cmRender = render;
  function render() {
    // Cloud auth gate (only when backend is enabled in config.js)
    if (window.CM_CONFIG && window.CM_CONFIG.cloud) {
      var cs = window.CMCloud ? window.CMCloud.state : "loading";
      var mustAuth = window.CM_CONFIG.requireAuth;
      // While the backend is still loading we only block if sign-in is required;
      // optional-auth users get straight into the offline app.
      if ((cs === "loading" || cs === "off") && mustAuth) { root.innerHTML = '<div class="onb"><div class="onb-card" style="text-align:center"><div style="font-size:1.6rem">₹</div><p class="hint">Loading your account…</p></div></div>'; return; }
      if (cs === "anon" && (mustAuth || showAuth)) { renderAuth(); return; }
      // otherwise → continue into the app (offline is fine)
    }
    if (!CM.load().profile.onboarded) { renderOnboarding(); return; }
    var r = route();
    root.innerHTML = ""; root.appendChild(shell(r));
    // Keep the browser tab / history entry meaningful per view.
    var navItem = NAV.filter(function (n) { return n.id === r; })[0];
    document.title = (navItem ? navItem.label : "Dashboard") + " · ChintasMoney";
    // Resume an action the user started before signing in (e.g. a purchase).
    if (pendingAction && isAuthed()) { var f = pendingAction; pendingAction = null; setTimeout(f, 60); }
  }

  // ---- Auth screen (cloud mode) --------------------------------------------
  var authMode = "login";
  var showAuth = false; // set when an optional-auth user asks to sign in
  var pendingAction = null; // run this once the user finishes signing in (e.g. resume a purchase)
  function isAuthed() { return window.CMCloud && window.CMCloud.state === "authed"; }
  function needsSignIn() { return window.CM_CONFIG && window.CM_CONFIG.cloud && !isAuthed(); }
  // Ask the user to sign in first, then run fn(). If sign-in isn't needed, run now.
  function signInThen(fn) { if (needsSignIn()) { pendingAction = fn; openAuth("signup"); } else { fn(); } }
  function openAuth(mode) { if (mode) authMode = mode; showAuth = true; render(); }
  function sessDismissed(k) { try { return sessionStorage.getItem(k) === "1"; } catch (e) { return false; } }
  function sessDismiss(k) { try { sessionStorage.setItem(k, "1"); } catch (e) {} }
  function renderAuth() {
    root.innerHTML = "";
    var wrap = el('<div class="onb"></div>'), c = el('<div class="onb-card"></div>');
    c.appendChild(el('<div class="brand" style="padding:0 0 6px"><span class="brand-badge brand-logo-chip"><img src="assets/logo-icon.png" alt=""/></span><div><b style="color:var(--ink)">ChintasMoney</b><small style="color:var(--muted)">TRADER REPORT CARD</small></div></div>'));
    c.appendChild(el('<h2 style="margin:12px 0 4px">' + (authMode === "login" ? "Welcome back" : "Create your account") + '</h2>'));
    c.appendChild(el('<p class="hint">' + (authMode === "login" ? "Sign in to access your trading journal." : "Create a free account to save your journal and access it on any device.") + '</p>'));
    var msg = el('<p class="hint" id="aMsg" style="min-height:1.1em;color:var(--red)"></p>');
    // Social sign-in (one tap). New users are recorded in your user base automatically.
    var GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    var P = window.CM_CONFIG.authProviders || {};
    var providers = el('<div class="oauth-col"></div>');
    function providerBtn(id, label, svg) {
      var btn = el('<button class="oauth-btn">' + svg + '<span>' + label + '</span></button>');
      btn.addEventListener("click", function () {
        msg.style.color = "var(--muted)"; msg.textContent = "Redirecting…";
        CMCloud.signInOAuth(id).then(function (r) { if (r && r.error) { msg.style.color = "var(--red)"; msg.textContent = r.error.message; } })
          .catch(function () { msg.style.color = "var(--red)"; msg.textContent = "Could not start sign-in."; });
      });
      return btn;
    }
    if (P.google) providers.appendChild(providerBtn("google", "Continue with Google", GOOGLE_SVG));
    if (providers.children.length) { c.appendChild(providers); c.appendChild(el('<div class="auth-or"><span>or continue with email</span></div>')); }
    var em = el('<label class="fld"><span>Email</span><input id="aEmail" type="email" placeholder="you@example.com"/></label>');
    var pw = el('<label class="fld"><span>Password</span><input id="aPass" type="password" placeholder="••••••••"/></label>');
    c.appendChild(em); c.appendChild(pw);
    c.appendChild(msg);
    var go = el('<button class="btn btn-primary" style="width:100%">' + (authMode === "login" ? "Log in" : "Sign up") + '</button>');
    go.addEventListener("click", function () {
      var email = c.querySelector("#aEmail").value.trim(), pass = c.querySelector("#aPass").value;
      if (!email || !pass) { msg.textContent = "Enter email and password."; return; }
      go.disabled = true; go.textContent = "Please wait…";
      var op = authMode === "login" ? CMCloud.signIn(email, pass) : CMCloud.signUp(email, pass);
      op.then(function (r) {
        go.disabled = false; go.textContent = authMode === "login" ? "Log in" : "Sign up";
        if (r && r.error) { msg.textContent = r.error.message; }
        else if (authMode === "signup" && r && r.data && !r.data.session) { msg.style.color = "var(--green)"; msg.textContent = "Check your email to confirm, then log in."; }
      }).catch(function (e) { go.disabled = false; go.textContent = "Try again"; msg.textContent = "Something went wrong."; });
    });
    c.appendChild(go);
    var toggle = el('<p class="hint" style="text-align:center;margin-top:14px;cursor:pointer">' + (authMode === "login" ? "New here? <b style=\"color:var(--violet)\">Create an account</b>" : "Already have an account? <b style=\"color:var(--violet)\">Log in</b>") + '</p>');
    toggle.addEventListener("click", function () { authMode = authMode === "login" ? "signup" : "login"; renderAuth(); });
    c.appendChild(toggle);
    // Optional sign-in: let the user skip straight into the offline app.
    if (!window.CM_CONFIG.requireAuth) {
      var skip = el('<p class="hint" style="text-align:center;margin-top:6px;cursor:pointer;color:var(--muted)">← Use offline for now</p>');
      skip.addEventListener("click", function () { showAuth = false; render(); });
      c.appendChild(skip);
    }
    wrap.appendChild(c); root.appendChild(wrap);
  }

  function shell(r) {
    var s = CM.load(), wrap = el('<div class="app"></div>');
    var side = el('<aside class="sidebar' + (mobileOpen ? " open" : "") + '"></aside>');
    side.appendChild(el('<a class="brand" href="../index.html"><span class="brand-badge brand-logo-chip"><img src="assets/logo-icon.png" alt="ChintasMoney"/></span><div><b>ChintasMoney</b><small>TRADER REPORT CARD</small></div></a>'));
    NAV.forEach(function (n) {
      if (n.sep) { side.appendChild(el('<div class="nav-sep"></div>')); if (n.group) side.appendChild(el('<div style="color:#6f83ab;font-size:.66rem;letter-spacing:.08em;padding:2px 10px 4px">' + n.group.toUpperCase() + '</div>')); return; }
      var locked = !CM.planAllows(s.profile.plan, n.id);
      var needName = locked ? (CM.PLANS[CM.FEATURE_MATRIX[n.id]] || {}).name : "";
      var a = el('<a class="nav-item' + (r === n.id ? " active" : "") + '" href="#/' + n.id + '"><span class="ic">' + n.ic + '</span><span>' + n.label + '</span>' + (locked ? '<span class="lock">✦ ' + esc(needName) + '</span>' : '') + '</a>');
      a.addEventListener("click", function () { mobileOpen = false; });
      side.appendChild(a);
    });
    // Sidebar upsell — sells the upgrade (hidden for Diamond, the top plan)
    if (s.profile.plan !== "diamond") {
      var nextName = s.profile.plan === "free" ? "Plus" : "Platinum";
      var nextPrice = s.profile.plan === "free" ? "₹199" : "₹499";
      var up = el('<a class="side-upsell" href="#/profile">' +
        '<span class="su-badge">💎 7-day trial free</span>' +
        '<div class="su-title">Go ' + nextName + '</div>' +
        '<div class="su-feats">✓ Unlimited logging<br>✓ AI Discipline Coach<br>✓ Deep analytics &amp; league</div>' +
        '<div class="su-cta">Upgrade — from ' + nextPrice + '/mo →</div></a>');
      up.addEventListener("click", function () { mobileOpen = false; });
      side.appendChild(up);
    }
    // Account row — always visible so people can sign in early and buy under an account.
    if (window.CM_CONFIG && window.CM_CONFIG.cloud) {
      if (isAuthed()) {
        var acct = el('<div class="side-acct"><span class="sa-dot">☁️</span><span class="sa-email">' + esc((window.CMCloud.user && window.CMCloud.user.email) || "") + '</span><button class="sa-out">Sign out</button></div>');
        acct.querySelector(".sa-out").addEventListener("click", function () { window.CMCloud.signOut(); });
        side.appendChild(acct);
      } else {
        var signin = el('<button class="side-signin">Create free account</button>');
        signin.addEventListener("click", function () { mobileOpen = false; openAuth("signup"); });
        side.appendChild(signin);
      }
    }

    var foot = el('<div class="side-foot"><span class="plan-pill">● ' + CM.PLANS[s.profile.plan].name + ' plan</span>' +
      '<div class="side-legal"><a href="../learn.html">Learn</a> · <a href="../privacy.html">Privacy</a> · <a href="../terms.html">Terms</a> · <a href="../disclaimer.html">Disclaimer</a></div>' +
      '<div class="side-legal" style="margin-top:6px">Not investment advice · F&amp;O is risky.</div></div>');
    var scBtn = el('<button class="side-shortcuts">⌨ Keyboard shortcuts (?)</button>'); scBtn.addEventListener("click", function () { showShortcuts(); });
    foot.appendChild(scBtn);
    side.appendChild(foot);
    wrap.appendChild(side);
    if (mobileOpen) { var sc = el('<div class="scrim"></div>'); sc.addEventListener("click", function () { mobileOpen = false; render(); }); wrap.appendChild(sc); }

    var main = el('<main class="main"></main>');
    var guide = sectionGuide(r); if (guide) main.appendChild(guide);
    main.appendChild(!CM.planAllows(s.profile.plan, r) ? paywall(r) : (VIEWS[r] || VIEWS.home)());
    wrap.appendChild(main);

    // Global quick-log floating action button (hidden on the log view itself)
    if (r !== "log") {
      var fab = el('<button class="fab" title="Log a trade" aria-label="Log a trade">＋</button>');
      fab.addEventListener("click", function () { go("log"); });
      wrap.appendChild(fab);
    }
    return wrap;
  }

  function topbar(title, sub, actions) {
    var bar = el('<div class="topbar"></div>');
    var mb = el('<button class="btn btn-sm menu-btn">☰</button>'); mb.addEventListener("click", function () { mobileOpen = true; render(); }); bar.appendChild(mb);
    bar.appendChild(el('<div><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>'));
    bar.appendChild(el('<div class="spacer"></div>'));
    (actions || []).forEach(function (a) { bar.appendChild(a); });
    return bar;
  }
  function logBtn() { var b = el('<button class="btn btn-primary">＋ Log a trade</button>'); b.addEventListener("click", function () { go("log"); }); return b; }

  // What each locked area actually gives you — so the paywall sells, not just blocks.
  var AREA_SELL = {
    insights: { em: "🔍", title: "Mistake Insights", tag: "See every leak in your trading — ranked.", feats: ["Your repeating mistakes, ranked by how often they bleed you", "The exact rupee cost of each bad habit", "A fix for your #1 leak, updated as you log"] },
    coach: { em: "✦", title: "AI Discipline Coach", tag: "A calm, honest verdict on every trade.", feats: ["Ask anything about your own trading, answered from your data", "Two-line honest verdicts: what worked, what's killing your account", "Weekly progress, win-rate & R:R coaching"] },
    badges: { em: "🏅", title: "Streaks & Badges", tag: "Turn discipline into a game you want to win.", feats: ["Earn badges for real discipline habits — not for winning", "A 12-week activity heatmap of your consistency", "Daily streaks that keep you logging"] },
    leaderboard: { em: "🏆", title: "Discipline League", tag: "Climb from Bronze to Diamond vs traders like you.", feats: ["Ranked on discipline, never on luck or P&L", "Weekly promotion & relegation zones", "A shareable rank card to flex your consistency"] },
    strategy: { em: "▦", title: "Setup Performance", tag: "Find the setups that actually pay.", feats: ["Win-rate & net P&L for every setup you trade", "Spot the strategy quietly bleeding your account", "R-multiples & time-of-day edge"] },
    replay: { em: "🎬", title: "Trade Replay", tag: "Replay any trade on the real market — see what would have happened.", feats: ["Your entry, stop & exit drawn on the actual market for that trade's dates", "Did the market hit your stop or target? How much did you leave on the table?", "Your behaviour & emotion vs what the market really did — the honest verdict"] }
  };
  function paywall(area) {
    var need = CM.FEATURE_MATRIX[area], plan = CM.PLANS[need];
    var s = AREA_SELL[area] || { em: "🔒", title: area, tag: plan.blurb, feats: [] };
    var w = el('<div></div>');
    w.appendChild(topbar(s.title, "A " + plan.name + " feature"));
    var priceTxt = plan.price ? "₹" + plan.price + "/mo" : "Free";
    // Blurred live preview of the REAL feature — a teaser, not a wall.
    try {
      if (VIEWS[area]) {
        var prev = el('<div class="pw-preview" aria-hidden="true"></div>');
        var pv = VIEWS[area]();
        var tb0 = pv.querySelector && pv.querySelector(".topbar"); if (tb0) tb0.remove();
        prev.appendChild(pv);
        var stage = el('<div class="pw-stage"></div>');
        stage.appendChild(prev);
        stage.appendChild(el('<div class="pw-peek">👀 a peek at your real ' + esc(s.title) + '</div>'));
        w.appendChild(stage);
      }
    } catch (e) {}
    var c = el('<div class="card paywall-sell"></div>');
    c.innerHTML =
      '<div class="pw-hero"><div class="pw-em">' + s.em + '</div>' +
        '<div class="pw-lock">✨ Preview · ' + esc(plan.name) + ' feature</div>' +
        '<h2 class="pw-title">Unlock ' + esc(s.title) + '</h2>' +
        '<p class="pw-tag">' + esc(s.tag) + '</p></div>' +
      '<div class="pw-feats">' + s.feats.map(function (f) { return '<div class="pw-feat"><span>✓</span> ' + esc(f) + '</div>'; }).join("") + '</div>' +
      '<div class="pw-price"><b>' + priceTxt + '</b>' + (plan.price ? '<span> · 7-day trial · cancel anytime</span>' : '') + '</div>';
    var b = el('<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:14px">Upgrade to ' + plan.name + ' →</button>');
    b.addEventListener("click", function () { go("profile"); render(); });
    c.appendChild(b);
    var comp = el('<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px">See all plans</button>');
    comp.addEventListener("click", function () { go("profile"); render(); });
    c.appendChild(comp);
    c.appendChild(el('<p class="hint" style="text-align:center;margin-top:12px">Join disciplined traders across India. Discipline over profit.</p>'));
    w.appendChild(c);
    return w;
  }

  function scoreColor(n) { return n >= 75 ? "var(--emerald)" : n >= 50 ? "var(--gold)" : "var(--red)"; }
  function scoreLabel(n) { return n >= 85 ? "Elite discipline" : n >= 75 ? "Strong" : n >= 50 ? "Leaky" : n >= 30 ? "Reckless" : "Account-killer"; }

  // Circular gauge (SVG)
  function gauge(score, size) {
    size = size || 190; var r = size / 2 - 14, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="14"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + scoreColor(score) + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="46%" text-anchor="middle" font-size="' + (size * 0.26) + '" font-weight="800" fill="var(--ink)">' + score + '</text>' +
      '<text x="50%" y="63%" text-anchor="middle" font-size="' + (size * 0.075) + '" fill="var(--muted)">DISCIPLINE</text></svg>';
  }

  // Animated gauge: renders at 0 then counts up to score (used on hero screens).
  function mountGauge(container, score, size) {
    container.innerHTML = gauge(score, size);
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) return;
    var svg = container.querySelector("svg"); if (!svg) return;
    var arc = svg.querySelectorAll("circle")[1], num = svg.querySelectorAll("text")[0];
    if (!arc || !num) return;
    var s = size || 190, r = s / 2 - 14, c = 2 * Math.PI * r;
    var start = null, dur = 900;
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    arc.setAttribute("stroke-dashoffset", c); num.textContent = "0";
    function step(ts) {
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / dur), e = ease(p), val = Math.round(score * e);
      arc.setAttribute("stroke-dashoffset", c * (1 - score / 100 * e));
      num.textContent = val;
      if (p < 1) requestAnimationFrame(step); else num.textContent = score;
    }
    requestAnimationFrame(step);
  }

  var VIEWS = {};

  // ---- SVG chart helpers ---------------------------------------------------
  function svgLine(vals, opt) {
    opt = opt || {}; var w = opt.w || 520, h = opt.h || 180, pad = 8;
    if (!vals.length) return '<div class="hint">No data yet.</div>';
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (opt.zeroBase && min > 0) min = 0; if (min === max) { max = min + 1; }
    var n = vals.length, dx = (w - pad * 2) / Math.max(1, n - 1);
    function x(i) { return pad + i * dx; } function y(v) { return h - pad - (v - min) / (max - min) * (h - pad * 2); }
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var area = d + " L" + x(n - 1).toFixed(1) + " " + (h - pad) + " L" + x(0).toFixed(1) + " " + (h - pad) + " Z";
    var col = opt.color || "#0f9d76", zeroY = (min < 0 && max > 0) ? y(0) : null;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="g' + (opt.id || "") + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".28"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
      (zeroY !== null ? '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="#2a2140" stroke-dasharray="4 4"/>' : '') +
      '<path d="' + area + '" fill="url(#g' + (opt.id || "") + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(vals[n - 1]).toFixed(1) + '" r="3.5" fill="' + col + '"/></svg>';
  }
  function svgDonut(segs, opt) {
    opt = opt || {}; var size = opt.size || 150, r = size / 2 - 12, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0) || 1, off = 0;
    var circles = segs.map(function (s) {
      var frac = s.value / total, seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="16" stroke-dasharray="' + (frac * C).toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-off * C).toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      off += frac; return seg;
    }).join("");
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#241c3a" stroke-width="16"/>' + circles +
      '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="' + (size * 0.2) + '" font-weight="800" fill="#ece9f6">' + (opt.center || "") + '</text>' +
      (opt.sub ? '<text x="' + cx + '" y="' + (cy + size * 0.13) + '" text-anchor="middle" font-size="' + (size * 0.075) + '" fill="#7b879d">' + opt.sub + '</text>' : '') + '</svg>';
  }
  function svgHBars(items) {
    if (!items.length) return '<div class="hint">No data yet.</div>';
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })) || 1;
    return items.map(function (i) {
      var w = Math.round(Math.abs(i.value) / max * 100), pos = i.value >= 0;
      return '<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>' + esc(i.label) + '</span><span class="' + (pos ? "pos" : "neg") + '" style="font-weight:700">' + (i.fmt || i.value) + '</span></div>' +
        '<div class="bar' + (pos ? "" : " coral") + '" style="margin-top:4px"><i style="width:' + w + '%"></i></div></div>';
    }).join("");
  }
  function scoreColorHex(n) { return n >= 75 ? "#22e08a" : n >= 50 ? "#f5b849" : "#ff5a6a"; }

  // ---- Candlestick + volume + MA chart (illustrative demo data) -------------
  function seedRand(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genCandles(n, seed, base) {
    var r = seedRand(seed), price = base || 100, out = [], trend = (r() - 0.4) * 0.6;
    for (var i = 0; i < n; i++) {
      if (i % 14 === 0) trend = (r() - 0.45) * 1.2;
      var o = price, ch = trend + (r() - 0.5) * base * 0.02;
      var c = Math.max(1, o + ch);
      var hi = Math.max(o, c) + r() * base * 0.012, lo = Math.min(o, c) - r() * base * 0.012;
      var v = 40 + r() * 100 + (Math.abs(ch) / base) * 800;
      out.push({ o: o, h: hi, l: lo, c: c, v: v, up: c >= o });
      price = c;
    }
    return out;
  }
  function sma(data, win) {
    return data.map(function (d, i) { if (i < win - 1) return null; var s = 0; for (var k = i - win + 1; k <= i; k++) s += data[k].c; return s / win; });
  }
  function fmtP(n) { return n.toFixed(n < 100 ? 2 : n < 1000 ? 1 : 0); }
  function svgCandleChart(data, opt) {
    opt = opt || {};
    var W = 940, H = 440, padL = 48, padR = 12, padT = 12;
    var pH = 300, vGap = 20, vH = 84, pB = padT + pH, vT = pB + vGap, vB = vT + vH;
    var n = data.length, cw = (W - padL - padR) / n, bw = Math.max(2, cw * 0.62);
    var his = data.map(function (d) { return d.h; }), los = data.map(function (d) { return d.l; });
    var pmax = Math.max.apply(null, his), pmin = Math.min.apply(null, los);
    var pad = (pmax - pmin) * 0.06; pmax += pad; pmin -= pad;
    var vmax = Math.max.apply(null, data.map(function (d) { return d.v; })) || 1;
    function px(i) { return padL + i * cw + cw / 2; }
    function py(v) { return padT + (pmax - v) / (pmax - pmin) * pH; }
    function vy(v) { return vB - (v / vmax) * vH; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block">';
    // grid + price axis
    for (var g = 0; g <= 4; g++) {
      var yy = padT + g / 4 * pH, val = pmax - g / 4 * (pmax - pmin);
      s += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" stroke="#241c3a"/>';
      s += '<text x="' + (padL - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="10" fill="#8a83a6">' + fmtP(val) + '</text>';
    }
    // volume bars
    if (opt.volume !== false) data.forEach(function (d, i) { s += '<rect x="' + (px(i) - bw / 2).toFixed(1) + '" y="' + vy(d.v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (vB - vy(d.v)).toFixed(1) + '" fill="' + (d.up ? "rgba(34,224,138,.35)" : "rgba(255,90,106,.35)") + '"/>'; });
    // candles
    data.forEach(function (d, i) {
      var col = d.up ? "#22e08a" : "#ff5a6a", x = px(i);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + py(d.h).toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + py(d.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1.3"/>';
      var yo = py(d.o), yc = py(d.c), top = Math.min(yo, yc), hgt = Math.max(1.5, Math.abs(yc - yo));
      s += '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="1" fill="' + col + '"/>';
    });
    // moving averages
    function maPath(arr, color) {
      var dd = "", started = false;
      arr.forEach(function (v, i) { if (v == null) return; dd += (started ? "L" : "M") + px(i).toFixed(1) + " " + py(v).toFixed(1) + " "; started = true; });
      return '<path d="' + dd + '" fill="none" stroke="' + color + '" stroke-width="1.8" opacity=".95"/>';
    }
    if (opt.ma !== false) { s += maPath(sma(data, 9), "#a78bfa"); s += maPath(sma(data, 21), "#f5b849"); }
    // trade markers (illustrative)
    if (opt.markers !== false && n > 30) {
      var bi = Math.floor(n * 0.28), si = Math.floor(n * 0.72);
      s += '<g><polygon points="' + px(bi) + ',' + (py(data[bi].l) + 16) + ' ' + (px(bi) - 6) + ',' + (py(data[bi].l) + 26) + ' ' + (px(bi) + 6) + ',' + (py(data[bi].l) + 26) + '" fill="#22e08a"/><text x="' + px(bi) + '" y="' + (py(data[bi].l) + 40) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#22e08a">BUY</text></g>';
      s += '<g><polygon points="' + px(si) + ',' + (py(data[si].h) - 16) + ' ' + (px(si) - 6) + ',' + (py(data[si].h) - 26) + ' ' + (px(si) + 6) + ',' + (py(data[si].h) - 26) + '" fill="#ff5a6a"/><text x="' + px(si) + '" y="' + (py(data[si].h) - 30) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#ff5a6a">SELL</text></g>';
    }
    s += '<text x="' + padL + '" y="' + (vT - 6) + '" font-size="10" fill="#8a83a6">Volume</text>';
    s += '</svg>';
    return s;
  }

  var mkState = { sym: "NSE:NIFTY" };
  // Cross-view handoff so the chart, calculator, log and report card work together.
  var handoff = { calc: null, log: null };
  var SYMBOLS = [["NIFTY", 24800, 11], ["BANKNIFTY", 51200, 23], ["RELIANCE", 2980, 7], ["TCS", 3910, 31], ["TATAMOTORS", 985, 5], ["ZOMATO", 168, 13]];
  // Real NSE symbols users can pick from (indices resolve to tracking ETFs via tvSymbolFor).
  var POPULAR_SYMS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN",
    "AXISBANK", "KOTAKBANK", "ITC", "LT", "BHARTIARTL", "HINDUNILVR", "MARUTI", "SUNPHARMA", "WIPRO", "HCLTECH",
    "TECHM", "TATAMOTORS", "TATASTEEL", "JSWSTEEL", "ADANIENT", "ADANIPORTS", "BAJFINANCE", "BAJAJFINSV",
    "ASIANPAINT", "TITAN", "ULTRACEMCO", "NESTLEIND", "POWERGRID", "NTPC", "ONGC", "COALINDIA", "HDFCLIFE",
    "DRREDDY", "CIPLA", "DMART", "ZOMATO", "PAYTM", "IRCTC", "IDEA", "YESBANK", "PNB"];
  function symOptions(sel) {
    return POPULAR_SYMS.map(function (s) {
      return '<option value="' + s + '"' + (sel && sel === s ? " selected" : "") + '>' + s + '</option>';
    }).join("");
  }
  // F&O lot sizes (SEBI revises these periodically — reasonable current defaults).
  function lotFor(s) {
    s = (s || "").toUpperCase();
    if (/MIDCPNIFTY/.test(s)) return 120;
    if (/FINNIFTY/.test(s)) return 65;
    if (/BANKNIFTY/.test(s)) return 35;
    if (/NIFTYNXT50/.test(s)) return 25;
    if (/SENSEX/.test(s)) return 20;
    if (/BANKEX/.test(s)) return 30;
    if (/NIFTY/.test(s)) return 75;
    return null;
  }
  var LOT_VALUES = [120, 75, 65, 35, 30, 25, 20];
  function isLotValue(v) { return LOT_VALUES.indexOf(+v) >= 0; }
  function marketOptions(sel) {
    return MARKET_GROUPS.map(function (g) {
      return '<optgroup label="' + g[0] + '">' + g[1].map(function (o) {
        return '<option value="' + o[1] + '"' + (sel === o[1] ? " selected" : "") + '>' + o[0] + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
  }
  function labelFor(sym) {
    for (var i = 0; i < MARKET_GROUPS.length; i++) for (var j = 0; j < MARKET_GROUPS[i][1].length; j++)
      if (MARKET_GROUPS[i][1][j][1] === sym) return MARKET_GROUPS[i][1][j][0];
    return sym;
  }
  VIEWS.markets = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Live Charts", "Analyse any market — NSE, gold, crude, crypto & more. Real candles, volume & every indicator."));
    var card = el('<div class="card"></div>');
    // One-tap quick picks for the most-wanted markets
    var MK_QUICK = [["NIFTY 50", "NSE:NIFTY"], ["Bank Nifty", "NSE:BANKNIFTY"], ["Gold", "OANDA:XAUUSD"], ["Crude Oil", "TVC:USOIL"], ["Bitcoin", "BINANCE:BTCUSDT"], ["Reliance", "NSE:RELIANCE"], ["Nasdaq", "TVC:NDX"]];
    var quick = el('<div class="mk-quick"></div>');
    var symRow = el('<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">' +
      '<label class="fld" style="margin:0;flex:1;min-width:200px"><span>Market / symbol</span><select id="mkSym">' + marketOptions(mkState.sym) + '</select></label>' +
      '<button class="btn btn-primary" id="mkSize" title="Size a trade on this market in the Risk Calculator">📐 Size this trade</button>' +
      '<button class="btn" id="mkFull" title="Full screen — rotate your phone to analyse big">⛶ Fullscreen</button>' +
      '<a class="btn" id="mkDeep" target="_blank" rel="noopener nofollow" href="#">Deep analysis ↗</a></div>');
    var box = el('<div id="mkBox" style="margin-top:14px"></div>');
    function refreshQuick() { quick.querySelectorAll(".mk-chip").forEach(function (ch) { ch.classList.toggle("on", ch.getAttribute("data-sym") === mkState.sym); }); }
    function setSym(sym) { mkState.sym = sym; var sel = symRow.querySelector("#mkSym"); sel.value = sym; mountMk(); refreshQuick(); }
    MK_QUICK.forEach(function (m) {
      var ch = el('<button class="mk-chip" data-sym="' + m[1] + '">' + m[0] + '</button>');
      ch.addEventListener("click", function () { setSym(m[1]); });
      quick.appendChild(ch);
    });
    function mountMk() {
      box.innerHTML = ""; box.appendChild(tvChart(mkState.sym, 620, false));
      symRow.querySelector("#mkDeep").href = "https://www.tradingview.com/symbols/" + encodeURIComponent(mkState.sym).replace("%3A", "-") + "/";
    }
    symRow.querySelector("#mkSym").addEventListener("change", function () { mkState.sym = this.value; mountMk(); refreshQuick(); });
    symRow.querySelector("#mkFull").addEventListener("click", function () { goFullscreen(box); });
    symRow.querySelector("#mkSize").addEventListener("click", function () {
      handoff.calc = { tv: mkState.sym, label: labelFor(mkState.sym) };
      go("calc"); // hashchange triggers render; a 2nd render() here would wipe the handoff
    });
    card.appendChild(quick);
    card.appendChild(symRow);
    refreshQuick();
    card.appendChild(box);
    mountMk();
    card.appendChild(el('<p class="hint" style="margin-top:10px">Tap the chart toolbar for indicators (RSI, MACD, MA, Bollinger…) and drawing tools. Hit <b>⛶ Fullscreen</b> and rotate your phone for a big landscape view. Indian indices show their tracking ETF; use <b>Deep analysis</b> for full technicals &amp; fundamentals on TradingView.</p>'));
    v.appendChild(card);
    return v;
  };

  // ---- TradingView live charts (iframe embed) ------------------------------
  // We use the iframe widgetembed (symbol in the URL) instead of the JS embed:
  // the JS embed can't read its config when injected dynamically (no
  // document.currentScript), so it silently falls back to AAPL. The iframe
  // always shows the symbol we ask for and updates when we swap it.
  function tvChart(sym, h, mini) {
    // Use TradingView's current, supported "Advanced Chart" widget. We load it
    // inside an iframe via srcdoc so the widget script has its own document
    // context (document.currentScript works) and reliably renders the symbol we
    // pass — the old s.tradingview.com/widgetembed endpoint is deprecated and now
    // shows "symbol only available on TradingView" for most symbols.
    var cfg = {
      autosize: true,
      symbol: sym,
      interval: "D",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "in",
      withdateranges: true,
      allow_symbol_change: false,
      hide_side_toolbar: !!mini,
      hide_top_toolbar: !!mini,
      hide_legend: !!mini,
      support_host: "https://www.tradingview.com"
    };
    var srcdoc =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>html,body{height:100%;margin:0;padding:0;background:#0b1533;overflow:hidden}' +
      '.tradingview-widget-container,.tradingview-widget-container__widget{height:100%;width:100%}</style></head><body>' +
      '<div class="tradingview-widget-container">' +
      '<div class="tradingview-widget-container__widget"></div>' +
      '<script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>' +
      JSON.stringify(cfg) +
      '<\/script></div></body></html>';
    var wrap = el('<div class="tv-frame" style="height:' + (h || 480) + 'px"></div>');
    var ifr = document.createElement("iframe");
    ifr.srcdoc = srcdoc;
    ifr.setAttribute("frameborder", "0");
    ifr.setAttribute("scrolling", "no");
    ifr.setAttribute("allowfullscreen", "");
    ifr.setAttribute("loading", "lazy");
    ifr.style.cssText = "width:100%;height:100%;border:0;display:block";
    var cap = el('<div style="text-align:right"><a href="https://www.tradingview.com/symbols/' + encodeURIComponent(sym).replace("%3A", "-") + '/" rel="noopener nofollow" target="_blank" style="color:#8a83a6;font-size:.7rem;text-decoration:none">Live data by TradingView</a></div>');
    wrap.appendChild(ifr);
    var outer = el('<div></div>'); outer.appendChild(wrap); outer.appendChild(cap);
    return outer;
  }
  // NSE *index* symbols (NIFTY/BANKNIFTY) aren't available in TradingView's free
  // embeds via their index feeds (NSE:NIFTY/NSE:BANKNIFTY), which are served
  // which mirror the index and DO load. Stocks work as-is.
  var TV_SYM = { NIFTY: "NSE:NIFTY", BANKNIFTY: "NSE:BANKNIFTY", RELIANCE: "NSE:RELIANCE", TCS: "NSE:TCS", TATAMOTORS: "NSE:TATAMOTORS", ZOMATO: "NSE:ZOMATO" };
  // Guess the live TradingView symbol from a user's trade symbol string.
  function tvSymbolFor(s) {
    s = (s || "").trim().toUpperCase();
    if (/BANKNIFTY/.test(s)) return "NSE:BANKNIFTY";
    if (/FINNIFTY/.test(s)) return "NSE:NIFTY";
    if (/NIFTY/.test(s)) return "NSE:NIFTY";
    if (/SENSEX/.test(s)) return "NSE:NIFTY";
    var first = s.split(/\s+/)[0].replace(/[^A-Z0-9&-]/g, "");
    return first ? "NSE:" + first : "NSE:NIFTY";
  }
  function tvAdvanced(sym, h) { return tvChart(sym, h || 480, false); }
  function tvMini(sym, title, h) { return tvChart(sym, h || 240, true); }
  // Full-screen a chart wrapper (lets the user rotate to landscape on mobile).
  function goFullscreen(node) {
    var t = node.querySelector(".tv-frame") || node;
    if (t.requestFullscreen) t.requestFullscreen();
    else if (t.webkitRequestFullscreen) t.webkitRequestFullscreen();
  }
  // Markets catalogue for the Live Charts analyser (full TradingView symbols).
  var MARKET_GROUPS = [
    ["Indian Indices", [["NIFTY 50", "NSE:NIFTY"], ["BANK NIFTY", "NSE:BANKNIFTY"], ["SENSEX", "BSE:SENSEX"]]],
    ["NSE Stocks", [["RELIANCE", "NSE:RELIANCE"], ["TCS", "NSE:TCS"], ["HDFC BANK", "NSE:HDFCBANK"], ["INFOSYS", "NSE:INFY"], ["ICICI BANK", "NSE:ICICIBANK"], ["SBI", "NSE:SBIN"], ["TATA MOTORS", "NSE:TATAMOTORS"], ["ADANI ENT", "NSE:ADANIENT"]]],
    ["Commodities", [["Gold · XAU/USD", "OANDA:XAUUSD"], ["Silver · XAG/USD", "OANDA:XAGUSD"], ["Crude Oil · WTI", "TVC:USOIL"], ["Brent Oil", "TVC:UKOIL"], ["Natural Gas", "NYMEX:NG1!"]]],
    ["Crypto", [["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"], ["Solana", "BINANCE:SOLUSDT"], ["Dogecoin", "BINANCE:DOGEUSDT"]]],
    ["Global Indices", [["S&P 500", "TVC:SPX"], ["Nasdaq 100", "TVC:NDX"], ["Dow Jones", "TVC:DJI"]]],
    ["Forex", [["USD/INR", "FX_IDC:USDINR"], ["EUR/USD", "OANDA:EURUSD"], ["GBP/USD", "OANDA:GBPUSD"]]]
  ];

  // ---- Chintamani mascot (wise old risk-manager) ---------------------------
  function mascot(size) {
    size = size || 96;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 120 120" aria-hidden="true">' +
      '<defs><radialGradient id="halo" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#a78bfa" stop-opacity=".5"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient></defs>' +
      '<circle cx="60" cy="58" r="54" fill="url(#halo)"/>' +
      '<path d="M28 74 q32 34 64 0 q4 26 -32 30 q-36 -4 -32 -30Z" fill="#f0a13a"/>' + // robe
      '<circle cx="60" cy="54" r="30" fill="#f7d9b7"/>' + // face
      '<path d="M31 48 q3 -22 29 -22 q26 0 29 22 q-6 -6 -12 -5 q-8 -6 -17 -6 q-9 0 -17 6 q-6 -1 -12 5Z" fill="#e7ecf3"/>' + // hair top
      '<path d="M36 58 q6 40 24 40 q18 0 24 -40 q-8 10 -24 10 q-16 0 -24 -10Z" fill="#eef2f7"/>' + // beard
      '<circle cx="49" cy="52" r="7.5" fill="none" stroke="#2a2140" stroke-width="2.4"/>' + // glasses L
      '<circle cx="71" cy="52" r="7.5" fill="none" stroke="#2a2140" stroke-width="2.4"/>' + // glasses R
      '<line x1="56.5" y1="52" x2="63.5" y2="52" stroke="#2a2140" stroke-width="2.4"/>' +
      '<circle cx="49" cy="52" r="2.2" fill="#2a2140"/><circle cx="71" cy="52" r="2.2" fill="#2a2140"/>' +
      '<path d="M52 64 q8 6 16 0" fill="none" stroke="#b07a4a" stroke-width="2.2" stroke-linecap="round"/>' + // smile
      '<circle cx="60" cy="40" r="3" fill="#f5b849"/>' + // tilak/dot
      '</svg>';
  }
  function chintaCard(tip) {
    var c = el('<div class="card" style="display:flex;gap:14px;align-items:center;border-color:var(--line-2);background:linear-gradient(120deg,rgba(139,92,246,.14),var(--bg-2))"></div>');
    c.appendChild(el('<div style="flex:none">' + mascot(72) + '</div>'));
    c.appendChild(el('<div><div style="font-weight:800">Chintamani says</div><div class="hint" style="color:var(--ink-soft);font-size:.95rem;margin-top:2px">“' + esc(tip || CM.chintaTip()) + '”</div></div>'));
    return c;
  }

  // ---- Engagement bar (level · XP · streak · daily goal) -------------------
  function engagementBar() {
    var e = CM.engagement();
    var w = el('<div class="card" style="margin-bottom:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;border-color:var(--line-2)"></div>');
    w.appendChild(el('<div style="display:flex;align-items:center;gap:10px"><div style="font-size:1.8rem">' + e.em + '</div><div><div style="font-weight:800">Lv ' + e.level + ' · ' + esc(e.title) + '</div><div class="hint mono">' + e.xp + ' XP</div></div></div>'));
    var prog = el('<div style="flex:1;min-width:180px"><div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--muted)"><span>Level ' + e.level + '</span><span>' + e.xpToNext + ' XP to Lv ' + (e.level + 1) + '</span></div><div class="bar" style="margin-top:5px"><i style="width:' + e.pct + '%"></i></div></div>');
    w.appendChild(prog);
    w.appendChild(el('<div style="text-align:center"><div style="font-size:1.4rem">🔥 ' + e.streak + '</div><div class="hint">day streak</div></div>'));
    var goal = el('<div style="text-align:center"><div style="font-size:1.4rem">' + (e.loggedToday ? "✅" : "🎯") + '</div><div class="hint">' + (e.loggedToday ? "logged today" : "log a trade today") + '</div></div>');
    w.appendChild(goal);
    return w;
  }

  // Personalised daily mission: target the weakest habit first, else keep sharp.
  function missionOf(st, ms, e) {
    if (!st.count) return { text: "Log your first trade — honestly.", why: "You can't fix what you don't measure. Even a bad trade counts." };
    if (st.noSL > 0) return { text: "Set a stop-loss on every trade today.", why: "You've traded without a stop " + st.noSL + " time(s). No stop = no trade." };
    if (st.emotional > 0) return { text: "Trade calm — no revenge, no FOMO.", why: "Emotional exits have cost you before. After a loss, step away for 10 minutes." };
    if (st.overtradeDays > 0) return { text: "Take only your A+ setups — quality over quantity.", why: "You've had overtrading days. Fewer, better trades beat more trades." };
    if (!e.loggedToday) return { text: "Keep your streak alive — log today's trades.", why: "Consistency is the habit that compounds. Don't break the chain. 🔥" };
    return { text: "Protect your edge — stick to your plan.", why: "Your discipline is strong (" + st.discipline + "). Today's job is simply not to slip." };
  }

  function hiText() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
  function todayHero() {
    var s = CM.load(), st = CM.stats(), e = CM.engagement();
    var name = s.profile.name || "Trader";
    var topPct = Math.max(3, Math.round((100 - st.discipline) * 0.55));
    var hero = el('<div class="today-hero"></div>');
    hero.innerHTML =
      '<div class="th-row"><div><div class="th-hi">' + hiText() + ', ' + esc(name) + ' 👋</div>' +
        '<div class="th-sub">' + (e.loggedToday ? "Streak safe today ✅" : "Log 1 trade to keep your streak alive 🔥") + '</div></div>' +
        '<div class="th-rank">🏆 Top ' + topPct + '%</div></div>' +
      '<div class="th-streak"><div class="th-flame">🔥</div>' +
        '<div><div class="th-num" style="color:#f5b849">' + e.streak + '</div><div class="th-lbl">day streak</div></div>' +
        '<div class="th-score"><div class="th-num" style="color:' + scoreColorHex(st.discipline) + '">' + st.discipline + '</div><div class="th-lbl">discipline</div></div>' +
        '<div class="th-score"><div class="th-num">' + e.em + ' ' + e.level + '</div><div class="th-lbl">' + esc(e.title) + '</div></div></div>' +
      '<div class="th-xp"><i style="width:' + e.pct + '%"></i></div>' +
      '<div class="th-xpt">' + e.xpToNext + ' XP to level ' + (e.level + 1) + '</div>';
    var cta = el('<button class="btn btn-primary" style="width:100%;margin-top:14px;justify-content:center">' + (e.loggedToday ? "＋ Log another trade" : "🔥 Keep my streak — log a trade") + '</button>');
    cta.addEventListener("click", function () { go("log"); });
    hero.appendChild(cta);
    return hero;
  }

  // ---- TODAY feed (the addictive scroll) -----------------------------------
  VIEWS.today = function () {
    var s = CM.load(), st = CM.stats(), e = CM.engagement(), ms = CM.mistakes(), v = el('<div></div>');
    v.appendChild(topbar("Today", "Your daily money mirror — a fresh look every time you open.", [logBtn()]));
    v.appendChild(todayHero());
    var feed = el('<div class="grid" style="max-width:680px;margin:0 auto"></div>');
    // 0. Today's mission — a personalised daily discipline focus
    var mission = missionOf(st, ms, e);
    var mcard = el('<div class="card mission-card"><div class="card-hd"><h3>🎯 Today\'s mission</h3>' + (e.loggedToday ? '<span class="badge b-green">on track</span>' : '<span class="badge b-yellow">pending</span>') + '</div><div style="font-size:1.05rem;font-weight:700;color:var(--ink)">' + esc(mission.text) + '</div><div class="hint" style="margin-top:4px">' + esc(mission.why) + '</div></div>');
    feed.appendChild(mcard);
    // Organic account nudge — only after the user has put in real work (2+ own trades),
    // never up front, and dismissible for the session so it never nags.
    if (needsSignIn() && !sessDismissed("cm.acctNudge")) {
      var ownN = s.trades.filter(function (t) { return !/^s\d+$/.test(t.id || ""); }).length;
      if (ownN >= 2) {
        var nudge = el('<div class="card acct-nudge">' +
          '<div class="an-body"><div class="an-title">Save your progress</div>' +
          '<div class="hint">You\'ve logged ' + ownN + ' trades. Create a free account to securely save your journal and access it across your devices.</div>' +
          '<div class="an-row"><button class="btn btn-primary btn-sm an-go">Create free account</button>' +
          '<button class="btn btn-ghost btn-sm an-later">Maybe later</button></div></div></div>');
        nudge.querySelector(".an-go").addEventListener("click", function () { openAuth("signup"); });
        nudge.querySelector(".an-later").addEventListener("click", function () { sessDismiss("cm.acctNudge"); render(); });
        feed.appendChild(nudge);
      }
    }
    // New-here demo video (lazy facade; set data-yt to a YouTube id to go live)
    var vcard = el('<div class="card"><div class="card-hd"><h3>🎬 New here? Watch the 2-min demo</h3></div><div class="vc-frame" data-yt=""><div class="vc-play">▶</div><span class="vc-badge">2-min walkthrough</span></div></div>');
    var vf = vcard.querySelector(".vc-frame");
    vf.addEventListener("click", function () {
      var id = (vf.getAttribute("data-yt") || "").trim();
      if (!id) { window.location.href = "../index.html#howto"; return; }
      var ifr = document.createElement("iframe");
      ifr.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
      ifr.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture"); ifr.setAttribute("allowfullscreen", "");
      ifr.style.cssText = "width:100%;height:100%;border:0;display:block"; vf.innerHTML = ""; vf.appendChild(ifr);
    });
    feed.appendChild(vcard);
    // 1. Chintamani tip
    feed.appendChild(chintaCard());
    // 2. discipline snapshot
    var dcard = el('<div class="card"></div>');
    dcard.appendChild(el('<div class="card-hd"><h3>Your discipline right now</h3><span class="badge ' + (st.discipline >= 75 ? "b-green" : st.discipline >= 50 ? "b-yellow" : "b-red") + '">' + scoreLabel(st.discipline) + '</span></div>'));
    var dRow = el('<div style="display:flex;align-items:center;gap:16px"><div class="dcard-g"></div><div><div class="persona" style="font-size:1.15rem;font-weight:800">' + st.personality.em + ' ' + esc(st.personality.key) + '</div><div class="hint">' + esc(st.personality.line) + '</div></div></div>');
    mountGauge(dRow.querySelector(".dcard-g"), st.discipline, 120);
    dcard.appendChild(dRow);
    feed.appendChild(dcard);
    // 3. biggest leak to fix
    if (ms.length) {
      var lc = el('<div class="card" style="border-color:rgba(255,90,106,.35)"></div>');
      lc.appendChild(el('<div class="card-hd"><h3>🩸 Fix this first</h3><span class="badge b-red">×' + ms[0].n + '</span></div>'));
      lc.appendChild(el('<div style="font-weight:700">' + esc(ms[0].name) + '</div><div class="hint" style="margin-top:2px">' + esc(ms[0].tip) + '</div>'));
      feed.appendChild(lc);
    }
    // 4. next badge to chase
    if (e.nextBadge) {
      var bc = el('<div class="card" style="display:flex;gap:14px;align-items:center"></div>');
      bc.appendChild(el('<div style="font-size:2.2rem;flex:none;opacity:.6">' + e.nextBadge.em + '</div>'));
      bc.appendChild(el('<div><div style="font-weight:800">Next badge: ' + esc(e.nextBadge.name) + '</div><div class="hint">' + esc(e.nextBadge.desc) + '</div></div>'));
      feed.appendChild(bc);
    }
    // 5. mini chart nudge
    var mc = el('<div class="card"></div>');
    mc.appendChild(el('<div class="card-hd"><h3>📈 NIFTY 50 · live</h3></div>'));
    mc.appendChild(tvMini("NSE:NIFTY", "NIFTY 50", 340));
    feed.appendChild(mc);
    // 6. equity nudge
    var eq = CM.equityCurve();
    if (eq.length) {
      var ec = el('<div class="card"></div>');
      ec.appendChild(el('<div class="card-hd"><h3>Your equity curve</h3><span class="hint mono ' + (st.totalPnl >= 0 ? "pos" : "neg") + '">' + money(st.totalPnl) + '</span></div>'));
      ec.appendChild(el(svgLine(eq.map(function (p) { return p.cum; }), { id: "today", color: st.totalPnl >= 0 ? "#22e08a" : "#ff5a6a", h: 130 })));
      feed.appendChild(ec);
    }
    // 7. CTA
    var cta = el('<div class="card" style="text-align:center;background:linear-gradient(120deg,rgba(34,224,138,.12),rgba(139,92,246,.12))"></div>');
    cta.appendChild(el('<div style="font-weight:800;font-size:1.05rem">Keep the streak alive 🔥</div><p class="hint" style="margin:6px 0 12px">Plan it, then log it — earn XP and keep your report card honest.</p>'));
    var ctaRow = el('<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"></div>');
    var pcb = el('<button class="btn btn-ghost">✅ Pre-Trade Check</button>'); pcb.addEventListener("click", function () { go("checklist"); });
    var cb = el('<button class="btn btn-primary">＋ Log a trade</button>'); cb.addEventListener("click", function () { go("log"); });
    ctaRow.appendChild(pcb); ctaRow.appendChild(cb); cta.appendChild(ctaRow);
    feed.appendChild(cta);
    v.appendChild(feed);
    return v;
  };

  // ---- REPORT (downloadable / printable) -----------------------------------
  VIEWS.report = function () {
    var st = CM.stats(), wl = CM.winLoss(), ms = CM.mistakes(), e = CM.engagement(), v = el('<div></div>');
    var dl = el('<button class="btn btn-sm">⬇ Download sheet (CSV)</button>'); dl.addEventListener("click", downloadReportCSV);
    var pr = el('<button class="btn btn-sm">🖨 Save as PDF</button>'); pr.addEventListener("click", function () { window.print(); });
    v.appendChild(topbar("My Report", "A clean summary you can download, print or share.", [dl, pr]));
    var c = el('<div class="card"></div>');
    c.appendChild(el('<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div style="display:flex;align-items:center;gap:10px">' + mascot(56) + '<div><div style="font-weight:800;font-size:1.15rem">' + esc(CM.load().profile.name || "Trader") + '\'s Report Card</div><div class="hint">' + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) + ' · Lv ' + e.level + ' ' + esc(e.title) + '</div></div></div><div style="text-align:right">' + gauge(st.discipline, 96) + '</div></div>'));
    var g = el('<div class="grid g4" style="margin-top:12px"></div>');
    g.appendChild(tile("Trades", String(st.count), "analysed"));
    g.appendChild(tile("Win rate", st.winRate + "%", wl.wins + "W · " + wl.losses + "L"));
    g.appendChild(tile("Net P&L", money(st.totalPnl), "from your logs", st.totalPnl >= 0));
    g.appendChild(tile("Discipline", st.discipline + "/100", scoreLabel(st.discipline), st.discipline >= 75));
    c.appendChild(g);
    // Visual snapshot — donut charts
    var RPIE = ["#8b5cf6", "#22e08a", "#f5b849", "#19d3c5", "#ff5a6a", "#a78bfa"];
    var spR = CM.setupPerformance(), emoR = CM.emotionBreakdown();
    var calm = emoR.filter(function (x) { return /calm/i.test(x.label); }).reduce(function (a, x) { return a + x.n; }, 0);
    var emotional = emoR.reduce(function (a, x) { return a + x.n; }, 0) - calm;
    var calmPct = (calm + emotional) ? Math.round(calm / (calm + emotional) * 100) : 0;
    var charts = el('<div class="grid g3" style="margin-top:14px;align-items:start"></div>');
    var wlc = el('<div class="card" style="padding:16px;text-align:center"><div class="hint" style="margin-bottom:8px;font-weight:600">Wins vs losses</div></div>');
    wlc.appendChild(el(svgDonut([{ value: wl.wins, color: "#22c55e" }, { value: wl.losses, color: "#ef4444" }], { size: 136, center: st.winRate + "%", sub: "win rate" })));
    charts.appendChild(wlc);
    var spc = el('<div class="card" style="padding:16px;text-align:center"><div class="hint" style="margin-bottom:8px;font-weight:600">Setups traded</div></div>');
    spc.appendChild(el(svgDonut(spR.map(function (r, i) { return { value: r.n, color: RPIE[i % RPIE.length] }; }), { size: 136, center: String(st.count), sub: "trades" })));
    charts.appendChild(spc);
    var emc = el('<div class="card" style="padding:16px;text-align:center"><div class="hint" style="margin-bottom:8px;font-weight:600">Calm vs emotional</div></div>');
    emc.appendChild(el(svgDonut([{ value: calm, color: "#22e08a" }, { value: emotional, color: "#f5b849" }], { size: 136, center: calmPct + "%", sub: "calm" })));
    charts.appendChild(emc);
    c.appendChild(charts);

    // Best & worst trade (by discipline) + this-week-vs-last-week trend
    var allT = CM.load().trades;
    if (allT.length) {
      var scored = allT.map(function (t) { return { t: t, d: CM.tradeDiscipline(t), p: CM.pnl(t) }; });
      var best = scored.reduce(function (a, x) { return (x.d > a.d || (x.d === a.d && x.p > a.p)) ? x : a; });
      var worst = scored.reduce(function (a, x) { return (x.d < a.d || (x.d === a.d && x.p < a.p)) ? x : a; });
      function bwCard(title, x, good) {
        var note = x.t.note ? '<div class="hint tnote" style="max-width:none;margin-top:4px" title="' + esc(x.t.note) + '">💬 ' + esc(x.t.note) + '</div>' : '';
        return '<div class="card" style="padding:14px"><div class="hint" style="font-weight:600;margin-bottom:6px">' + title + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>' + esc(x.t.symbol) + '</b>' +
          '<span class="num" style="font-weight:800;color:' + scoreColor(x.d) + '">' + x.d + '</span></div>' +
          '<div class="hint">' + esc(x.t.setup) + ' · ' + esc(x.t.exit_reason) + ' · <span class="' + (x.p >= 0 ? "pos" : "neg") + '">' + money(x.p) + '</span></div>' + note + '</div>';
      }
      var bw = el('<div class="grid g2" style="margin-top:14px;align-items:start"></div>');
      function bwNode(title, x, good) {
        var node = el(bwCard(title, x, good));
        var an = el('<button class="btn btn-sm" style="margin-top:10px">📈 Analyse on chart</button>');
        an.addEventListener("click", function () { analyseTrade(x.t); });
        node.appendChild(an);
        return node;
      }
      bw.appendChild(bwNode("🏆 Most disciplined trade", best, true));
      bw.appendChild(bwNode("⚠️ Least disciplined trade", worst, false));
      c.appendChild(bw);

      var now = Date.now(), DAY = 864e5;
      function avgDiscBetween(from, to) {
        var xs = scored.filter(function (x) { var tm = new Date(x.t.date).getTime(); return isFinite(tm) && tm >= from && tm < to; });
        return xs.length ? { n: xs.length, avg: Math.round(xs.reduce(function (a, x) { return a + x.d; }, 0) / xs.length) } : { n: 0, avg: null };
      }
      var thisW = avgDiscBetween(now - 7 * DAY, now + DAY), lastW = avgDiscBetween(now - 14 * DAY, now - 7 * DAY);
      if (thisW.n) {
        var trend, tColor, tArrow;
        if (lastW.avg == null) { trend = "First week logged"; tColor = "var(--muted)"; tArrow = "•"; }
        else { var delta = thisW.avg - lastW.avg; tArrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "▬"; tColor = delta > 0 ? "var(--emerald)" : delta < 0 ? "var(--red)" : "var(--muted)"; trend = (delta > 0 ? "+" : "") + delta + " vs last week (" + lastW.avg + ")"; }
        c.appendChild(el('<div class="card" style="margin-top:14px;padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
          '<div><div class="hint" style="font-weight:600">This week\'s discipline</div><div class="hint">' + thisW.n + ' trade' + (thisW.n === 1 ? "" : "s") + ' in the last 7 days</div></div>' +
          '<div style="text-align:right"><div style="font-size:1.6rem;font-weight:800;color:' + scoreColor(thisW.avg) + '">' + thisW.avg + '</div>' +
          '<div style="font-size:.82rem;font-weight:700;color:' + tColor + '">' + tArrow + ' ' + esc(trend) + '</div></div></div>'));
      }
    }

    c.appendChild(el('<h3 style="margin:16px 0 6px">Top mistakes to fix</h3>'));
    var ul = el('<ol style="margin:0;padding-left:18px;color:var(--ink-soft)"></ol>');
    (ms.length ? ms : [{ name: "No repeating mistakes — clean sheet.", n: 0 }]).slice(0, 5).forEach(function (m) { ul.appendChild(el('<li style="margin:3px 0">' + esc(m.name) + (m.n ? ' <b>×' + m.n + '</b>' : '') + '</li>')); });
    c.appendChild(ul);
    c.appendChild(el('<p class="hint" style="margin-top:14px"><span class="mock-tag">CHINTAMANI</span> ' + esc(CM.chintaTip()) + '</p>'));
    v.appendChild(c);
    return v;
  };
  function downloadReportCSV() {
    var st = CM.stats(), wl = CM.winLoss(), ms = CM.mistakes(), e = CM.engagement();
    var rows = [["Metric", "Value"],
      ["Name", CM.load().profile.name || "Trader"], ["Date", new Date().toISOString().slice(0, 10)],
      ["Level", e.level + " " + e.title], ["Discipline score", st.discipline + "/100 (" + scoreLabel(st.discipline) + ")"],
      ["Trades", st.count], ["Win rate", st.winRate + "%"], ["Wins", wl.wins], ["Losses", wl.losses],
      ["Net P&L", Math.round(st.totalPnl)], ["Avg win", Math.round(st.avgWin)], ["Avg loss", Math.round(st.avgLoss)],
      ["Risk:Reward", st.rr ? st.rr.toFixed(2) : "-"], ["No-SL trades", st.noSL], ["Emotional exits", st.emotional],
      ["Personality", st.personality.key], ["Streak (days)", e.streak]];
    ms.forEach(function (m, i) { rows.push(["Mistake " + (i + 1), m.name + " x" + m.n]); });
    var csv = rows.map(function (r) { return r.map(function (x) { var s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "chintasmoney-report.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---- HOME / Report Card --------------------------------------------------
  VIEWS.home = function () {
    var s = CM.load(), st = CM.stats(), p = st.personality;
    var v = el('<div></div>');
    v.appendChild(topbar("Your Trader Report Card", "Hi " + (s.profile.name || "trader") + " — this is your honest mirror, not tips.", [logBtn()]));

    v.appendChild(engagementBar());
    var hero = el('<div class="card" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap"></div>');
    var gwrap = el('<div></div>'); hero.appendChild(gwrap); mountGauge(gwrap, st.discipline);
    var right = el('<div style="flex:1;min-width:240px"></div>');
    right.appendChild(el('<div class="badge ' + (st.discipline >= 75 ? "b-green" : st.discipline >= 50 ? "b-yellow" : "b-red") + '">' + scoreLabel(st.discipline) + '</div>'));
    right.appendChild(el('<h2 style="margin:8px 0 2px;font-size:1.5rem">' + p.em + ' ' + esc(p.key) + '</h2>'));
    right.appendChild(el('<p class="hint" style="max-width:46ch">' + esc(p.line) + '</p>'));
    right.appendChild(el('<p style="margin:6px 0 0"><b>' + st.count + '</b> trades analysed · net <span class="' + (st.totalPnl >= 0 ? "pos" : "neg") + '">' + money(st.totalPnl) + '</span> <span class="mock-tag">from your logs</span></p>'));
    hero.appendChild(right);
    v.appendChild(hero);

    // live chart card
    var chc = el('<div class="card" style="margin-top:16px"></div>');
    chc.appendChild(el('<div class="card-hd"><h3>📈 NIFTY 50 · live</h3></div>'));
    chc.appendChild(tvMini("NSE:NIFTY", "NIFTY 50", 340));
    var chb = el('<button class="btn btn-ghost btn-sm" style="margin-top:8px">Open full charts →</button>');
    chb.addEventListener("click", function () { go("markets"); });
    chc.appendChild(chb);
    v.appendChild(chc);

    var g = el('<div class="grid g4" style="margin-top:16px"></div>');
    g.appendChild(tile("Win rate", st.winRate + "%", "of " + st.count + " trades"));
    g.appendChild(tile("Risk : reward", st.rr ? st.rr.toFixed(2) + "×" : "—", "avg win ÷ avg loss"));
    g.appendChild(tile("No stop-loss", String(st.noSL), "trades without a stop", st.noSL === 0));
    g.appendChild(tile("Emotional exits", String(st.emotional), "fear/greed/revenge/FOMO", st.emotional === 0));
    v.appendChild(g);

    // equity curve snapshot
    var eq = CM.equityCurve();
    if (eq.length) {
      var eqc = el('<div class="card" style="margin-top:16px"></div>');
      eqc.appendChild(el('<div class="card-hd"><h3>Equity curve</h3><span class="hint mono ' + (st.totalPnl >= 0 ? "pos" : "neg") + '">' + money(st.totalPnl) + ' net · ' + st.count + ' trades</span></div>'));
      eqc.appendChild(el(svgLine(eq.map(function (p) { return p.cum; }), { id: "home", color: st.totalPnl >= 0 ? "#0f9d76" : "#ef4444", h: 150 })));
      var moreb = el('<button class="btn btn-ghost btn-sm" style="margin-top:8px">Open full analytics →</button>');
      moreb.addEventListener("click", function () { go("analytics"); });
      eqc.appendChild(moreb);
      v.appendChild(eqc);
    }

    var cols = el('<div class="grid g2" style="margin-top:16px;align-items:start"></div>');
    // top mistakes
    var mc = el('<div class="card"><div class="card-hd"><h3>What\'s costing you</h3></div></div>');
    var ms = CM.mistakes();
    if (!ms.length) mc.appendChild(el('<p class="hint">No repeating mistakes detected yet. Keep logging.</p>'));
    ms.slice(0, 4).forEach(function (m) { mc.appendChild(el('<div class="attn"><div class="dot ' + (m.n >= 3 ? "red" : "yellow") + '"></div><div><div class="t">' + esc(m.name) + ' <span class="badge b-red">×' + m.n + '</span></div><div class="d">' + esc(m.tip) + '</div></div></div>')); });
    var mb = el('<button class="btn btn-ghost btn-sm" style="margin-top:6px">See all insights →</button>'); mb.addEventListener("click", function () { go("insights"); }); mc.appendChild(mb);
    cols.appendChild(mc);
    // share nudge
    var sh = el('<div class="card"><div class="card-hd"><h3>Flex your card</h3></div><p class="hint">Share your Trader Personality &amp; Discipline Score. (Traders love — and hate — seeing this.)</p></div>');
    var sb = el('<button class="btn btn-primary btn-sm">Open shareable card ↗</button>'); sb.addEventListener("click", function () { go("card"); }); sh.appendChild(sb);
    cols.appendChild(sh);
    v.appendChild(cols);
    return v;
  };
  function tile(l, v, note, good) {
    return el('<div class="card stat"><span class="lbl">' + l + '</span><span class="val">' + v + '</span><span class="hint' + (good === true ? " pos" : good === false ? " neg" : "") + '">' + note + '</span></div>');
  }

  // ---- ANALYTICS -----------------------------------------------------------
  VIEWS.analytics = function () {
    var st = CM.stats(), eq = CM.equityCurve(), dt = CM.disciplineTrend(), wl = CM.winLoss();
    var v = el('<div></div>');
    v.appendChild(topbar("Analytics", "The charts your broker never shows you — all from your own trades.", [logBtn()]));
    if (!st.count) { var e = el('<div class="card paywall"><div class="lock-ic">📊</div><h3>No charts yet</h3><p class="hint">Log a few trades and your analytics come alive.</p></div>'); var eb = el('<button class="btn btn-primary" style="margin-top:8px">＋ Log a trade</button>'); eb.addEventListener("click", function () { go("log"); }); e.appendChild(eb); v.appendChild(e); return v; }

    var g = el('<div class="grid g4"></div>');
    g.appendChild(tile("Net P&L", money(st.totalPnl), "from your logs", st.totalPnl >= 0));
    g.appendChild(tile("Win rate", st.winRate + "%", wl.wins + "W · " + wl.losses + "L"));
    g.appendChild(tile("Risk : reward", st.rr ? st.rr.toFixed(2) + "×" : "—", "avg win ÷ loss"));
    g.appendChild(tile("Discipline", st.discipline + "/100", scoreLabel(st.discipline), st.discipline >= 75));
    v.appendChild(g);

    var row1 = el('<div class="grid g2" style="margin-top:16px;align-items:start"></div>');
    var eqCard = el('<div class="card"><div class="card-hd"><h3>Equity curve</h3><span class="hint mono ' + (st.totalPnl >= 0 ? "pos" : "neg") + '">' + money(st.totalPnl) + '</span></div></div>');
    eqCard.appendChild(el(svgLine(eq.map(function (p) { return p.cum; }), { id: "eq", color: st.totalPnl >= 0 ? "#0f9d76" : "#ef4444", zeroBase: false, h: 190 })));
    eqCard.appendChild(el('<p class="hint" style="margin:8px 0 0">Cumulative profit &amp; loss across your ' + st.count + ' logged trades.</p>'));
    row1.appendChild(eqCard);

    var wlCard = el('<div class="card"><div class="card-hd"><h3>Wins vs losses</h3></div><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"></div></div>');
    wlCard.lastChild.appendChild(el(svgDonut([{ value: wl.wins, color: "#22c55e" }, { value: wl.losses, color: "#ef4444" }], { center: st.winRate + "%", sub: "win rate" })));
    wlCard.lastChild.appendChild(el('<div><div class="attn" style="border:0;padding:4px 0"><div class="dot green"></div><div>' + wl.wins + ' winning trades</div></div><div class="attn" style="border:0;padding:4px 0"><div class="dot red"></div><div>' + wl.losses + ' losing trades</div></div></div>'));
    row1.appendChild(wlCard);
    v.appendChild(row1);

    var row2 = el('<div class="grid g2" style="margin-top:16px;align-items:start"></div>');
    var dCard = el('<div class="card"><div class="card-hd"><h3>Discipline trend</h3><span class="hint">per trade</span></div></div>');
    dCard.appendChild(el(svgLine(dt, { id: "disc", color: scoreColorHex(st.discipline), h: 170, zeroBase: true })));
    dCard.appendChild(el('<p class="hint" style="margin:8px 0 0">Higher = you followed your plan. Watch the dips — that\'s where money leaks.</p>'));
    row2.appendChild(dCard);

    var spCard = el('<div class="card"><div class="card-hd"><h3>P&L by setup</h3></div></div>');
    spCard.appendChild(el('<div>' + svgHBars(CM.setupPerformance().map(function (s) { return { label: s.setup + " (" + s.winRate + "% · " + s.n + ")", value: s.pnl, fmt: money(s.pnl) }; })) + '</div>'));
    row2.appendChild(spCard);
    v.appendChild(row2);

    // setup distribution pie
    var PIE = ["#8b5cf6", "#22e08a", "#f5b849", "#19d3c5", "#ff5a6a", "#a78bfa", "#4fe3a3", "#fb7185"];
    var sp = CM.setupPerformance();
    var pieCard = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>Setup distribution</h3></div><div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"></div></div>');
    pieCard.lastChild.appendChild(el(svgDonut(sp.map(function (r, i) { return { value: r.n, color: PIE[i % PIE.length] }; }), { size: 160, center: st.count, sub: "trades" })));
    var leg = el('<div style="display:grid;gap:6px"></div>');
    sp.forEach(function (r, i) { leg.appendChild(el('<div style="display:flex;align-items:center;gap:8px;font-size:.88rem"><span style="width:12px;height:12px;border-radius:3px;background:' + PIE[i % PIE.length] + '"></span>' + esc(r.setup) + ' <span class="muted">· ' + r.n + '</span></div>')); });
    pieCard.lastChild.appendChild(leg);
    v.appendChild(pieCard);

    var emo = CM.emotionBreakdown();
    var eCard = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>What you feel when you trade</h3></div></div>');
    eCard.appendChild(el('<div>' + svgHBars(emo.map(function (x) { var bad = /revenge|fomo|fear|greed|overconf/i.test(x.label); return { label: x.label, value: bad ? -x.n : x.n, fmt: x.n + " trades" }; })) + '</div>'));
    eCard.appendChild(el('<p class="hint" style="margin:6px 0 0">Red = emotional states that usually cost you. Green = calm, planned trading.</p>'));
    v.appendChild(eCard);

    // Emotion + exit-reason donuts (more visual breakdowns)
    function donutCard(title, segs, center, sub, legend) {
      var card = el('<div class="card"><div class="card-hd"><h3>' + title + '</h3></div><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"></div></div>');
      card.lastChild.appendChild(el(svgDonut(segs, { size: 150, center: center, sub: sub })));
      var leg = el('<div style="display:grid;gap:6px">' + legend + '</div>');
      card.lastChild.appendChild(leg);
      return card;
    }
    var EMOC = { Calm: "#22e08a", FOMO: "#f5b849", Revenge: "#ff5a6a", Fear: "#19d3c5", Greed: "#a78bfa", Overconfident: "#fb7185" };
    var emoSegs = emo.map(function (x) { return { value: x.n, color: EMOC[x.label] || "#8b5cf6" }; });
    var emoLegend = emo.map(function (x) { return '<div style="display:flex;align-items:center;gap:8px;font-size:.86rem"><span style="width:11px;height:11px;border-radius:3px;background:' + (EMOC[x.label] || "#8b5cf6") + '"></span>' + esc(x.label) + ' <span class="muted">· ' + x.n + '</span></div>'; }).join("");
    var calmN = emo.filter(function (x) { return /calm/i.test(x.label); }).reduce(function (a, x) { return a + x.n; }, 0);
    var emoTot = emo.reduce(function (a, x) { return a + x.n; }, 0) || 1;
    // exit-reason breakdown from trades
    var exitCounts = {}; CM.load().trades.forEach(function (t) { var k = t.exit_reason || "Other"; exitCounts[k] = (exitCounts[k] || 0) + 1; });
    var EXC = ["#22e08a", "#19d3c5", "#f5b849", "#a78bfa", "#ff5a6a", "#fb7185", "#8b5cf6"];
    var exitArr = Object.keys(exitCounts).map(function (k, i) { return { label: k, n: exitCounts[k], color: EXC[i % EXC.length] }; }).sort(function (a, b) { return b.n - a.n; });
    var exitTot = exitArr.reduce(function (a, x) { return a + x.n; }, 0) || 1;
    var exitSegs = exitArr.map(function (x) { return { value: x.n, color: x.color }; });
    var exitLegend = exitArr.map(function (x) { return '<div style="display:flex;align-items:center;gap:8px;font-size:.86rem"><span style="width:11px;height:11px;border-radius:3px;background:' + x.color + '"></span>' + esc(x.label) + ' <span class="muted">· ' + x.n + '</span></div>'; }).join("");
    var donutRow = el('<div class="grid g2" style="margin-top:16px;align-items:start"></div>');
    donutRow.appendChild(donutCard("Emotion mix", emoSegs, Math.round(calmN / emoTot * 100) + "%", "calm", emoLegend));
    donutRow.appendChild(donutCard("Why you exit", exitSegs, String(st.count), "trades", exitLegend));
    v.appendChild(donutRow);
    return v;
  };

  // ---- LOG A TRADE ---------------------------------------------------------
  // ---- PRE-TRADE READINESS CHECK ------------------------------------------
  // A discipline gate BEFORE the click: weighted gates -> readiness score + verdict.
  var CHECK_GATES = [
    { id: "sl", w: 25, q: "I have set a stop-loss", why: "No stop = one trade can end your account." },
    { id: "risk", w: 20, q: "My risk is ≤ 1–2% of capital", why: "Small risk lets you survive a losing streak." },
    { id: "setup", w: 15, q: "This matches a planned setup (not FOMO)", why: "Boredom and chasing are not setups." },
    { id: "rr", w: 15, q: "My reward is at least 1.5× my risk", why: "Poor R:R loses money even at a high win rate." },
    { id: "calm", w: 15, q: "I'm calm — not revenge-trading", why: "Emotion turns one red trade into five." },
    { id: "limit", w: 10, q: "I'm within my trade count for today", why: "Overtrading just adds brokerage and mistakes." }
  ];
  function readyGauge(score, verdict, color) {
    var size = 190, r = size / 2 - 14, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="14"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="45%" text-anchor="middle" font-size="' + (size * 0.26) + '" font-weight="800" fill="var(--ink)">' + score + '</text>' +
      '<text x="50%" y="62%" text-anchor="middle" font-size="' + (size * 0.085) + '" font-weight="700" fill="' + color + '">' + verdict + '</text></svg>';
  }
  VIEWS.checklist = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Should I take this trade?", "Run the gate before you click. Green means go — everything else means wait."));
    var c = el('<div class="card"></div>');
    var gauge = el('<div style="display:flex;justify-content:center;margin:4px 0 8px" id="ckGauge"></div>');
    var verdictMsg = el('<p class="hint" id="ckMsg" style="text-align:center;margin:0 0 14px"></p>');
    var list = el('<div class="check-gates"></div>');
    CHECK_GATES.forEach(function (g) {
      var row = el('<label class="check-gate"><input type="checkbox" data-w="' + g.w + '" id="ck_' + g.id + '"/>' +
        '<span class="cg-body"><b>' + g.q + '</b><small>' + g.why + '</small></span>' +
        '<span class="cg-w">+' + g.w + '</span></label>');
      list.appendChild(row);
    });
    c.appendChild(gauge); c.appendChild(verdictMsg); c.appendChild(list);
    var actions = el('<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"></div>');
    var logIt = el('<button class="btn btn-primary" id="ckLog" disabled>Log this trade →</button>');
    logIt.addEventListener("click", function () { go("log"); });
    var reset = el('<button class="btn btn-ghost" id="ckReset">Reset</button>');
    reset.addEventListener("click", function () { list.querySelectorAll("input").forEach(function (i) { i.checked = false; }); update(); });
    actions.appendChild(logIt); actions.appendChild(reset);
    c.appendChild(actions);
    v.appendChild(c);
    v.appendChild(el('<p class="hint" style="margin-top:12px;text-align:center">A checklist is not a guarantee — it keeps you honest. Educational only, not investment advice.</p>'));
    function update() {
      var score = 0;
      list.querySelectorAll("input").forEach(function (i) { if (i.checked) score += +i.getAttribute("data-w"); });
      var slOn = c.querySelector("#ck_sl").checked;
      var verdict, color, msg;
      if (!slOn) { verdict = "STOP"; color = "var(--red)"; msg = "No stop-loss ticked — do not take this trade until you have one."; }
      else if (score >= 80) { verdict = "GO"; color = "var(--emerald)"; msg = "Disciplined setup. Size it as planned and stick to your stop."; }
      else if (score >= 55) { verdict = "CAUTION"; color = "var(--gold)"; msg = "Some boxes are unticked. Fix them or trade smaller than usual."; }
      else { verdict = "WAIT"; color = "var(--red)"; msg = "Too many gaps. This looks like an emotional or unplanned trade — wait."; }
      gauge.innerHTML = readyGauge(score, verdict, color);
      verdictMsg.textContent = msg; verdictMsg.style.color = color;
      var green = slOn && score >= 80;
      logIt.disabled = !green;
      logIt.style.opacity = green ? "1" : ".5";
    }
    list.querySelectorAll("input").forEach(function (i) { i.addEventListener("change", update); });
    update();
    return v;
  };

  VIEWS.log = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Log a Trade", "Honesty in = honesty out. This is between you and your data."));
    var c = el('<div class="card"></div>');
    var f =
      '<div class="grid g2"><label class="fld"><span>Symbol</span><input id="sym" list="symList" placeholder="Type or pick — NIFTY, RELIANCE…" autocomplete="off" /><datalist id="symList">' + symOptions() + '</datalist></label>' +
      '<label class="fld"><span>Side</span><select id="side"><option>Buy</option><option>Sell</option></select></label></div>' +
      '<div class="grid g4"><label class="fld"><span>Qty <small id="lotHint" class="muted" style="font-weight:400"></small></span><input id="qty" type="number" /></label>' +
      '<label class="fld"><span>Entry</span><input id="entry" type="number" /></label>' +
      '<label class="fld"><span>Exit</span><input id="exit" type="number" /></label>' +
      '<label class="fld"><span>Planned SL</span><input id="sl" type="number" placeholder="(be honest)" /></label></div>' +
      '<div class="grid g3"><label class="fld"><span>Setup</span><select id="setup">' + CM.SETUPS.map(function (x) { return '<option>' + x + '</option>'; }).join("") + '</select></label>' +
      '<label class="fld"><span>Why did you exit?</span><select id="xr">' + CM.EXITS.map(function (x) { return '<option>' + x + '</option>'; }).join("") + '</select></label>' +
      '<label class="fld"><span>Your emotion</span><select id="emo">' + CM.EMOTIONS.map(function (x) { return '<option>' + x + '</option>'; }).join("") + '</select></label></div>' +
      '<label class="fld"><span>Note <small class="muted" style="font-weight:400">— why you took it, what you learned (optional)</small></span><textarea id="note" rows="2" placeholder="e.g. Clean breakout retest, but I moved my stop — won\'t do that again." style="resize:vertical"></textarea></label>';
    c.innerHTML = f;
    // Prefill when the user came here from the Risk Calculator.
    var pl = handoff.log; handoff.log = null;
    if (pl) {
      if (pl.symbol) c.querySelector("#sym").value = pl.symbol;
      if (pl.side) c.querySelector("#side").value = pl.side;
      if (pl.qty) c.querySelector("#qty").value = pl.qty;
      if (pl.entry != null) c.querySelector("#entry").value = pl.entry;
      if (pl.plannedSL != null) c.querySelector("#sl").value = pl.plannedSL;
    }
    // Live P&L + risk:reward preview — updates as you type (reinforces the plan-first habit).
    var preview = el('<div class="trade-preview" hidden><div class="tp-cell"><span class="tp-lbl">Est. P&amp;L</span><b id="tpPnl" class="tp-val">—</b></div><div class="tp-cell"><span class="tp-lbl">Risk : Reward</span><b id="tpRR" class="tp-val">—</b></div><div class="tp-cell"><span class="tp-lbl">Risk</span><b id="tpRisk" class="tp-val">—</b></div><div class="tp-cell"><span class="tp-lbl">Discipline</span><b id="tpDisc" class="tp-val">—</b></div></div>');
    c.appendChild(preview);
    function num(id) { var x = parseFloat(c.querySelector(id).value); return isFinite(x) ? x : null; }
    function updatePreview() {
      var side = c.querySelector("#side").value, qty = num("#qty"), entry = num("#entry"), exit = num("#exit"), sl = num("#sl");
      var dir = /sell/i.test(side) ? -1 : 1;
      var show = false;
      var pnlEl = preview.querySelector("#tpPnl"), rrEl = preview.querySelector("#tpRR"), riskEl = preview.querySelector("#tpRisk");
      if (entry != null && exit != null && qty) {
        var p = dir * (exit - entry) * qty;
        pnlEl.textContent = money(p); pnlEl.className = "tp-val " + (p >= 0 ? "pos" : "neg"); show = true;
      } else { pnlEl.textContent = "—"; pnlEl.className = "tp-val"; }
      if (entry != null && sl != null && entry !== sl) {
        var riskPer = Math.abs(entry - sl);
        riskEl.textContent = money(riskPer * (qty || 1)) + (qty ? "" : " /sh"); show = true;
        if (exit != null) {
          var reward = Math.abs(exit - entry);
          var rr = reward / riskPer;
          rrEl.textContent = "1 : " + rr.toFixed(2); rrEl.className = "tp-val " + (rr >= 2 ? "pos" : rr >= 1 ? "" : "neg");
        } else { rrEl.textContent = "—"; rrEl.className = "tp-val"; }
      } else { riskEl.textContent = sl == null ? "no SL" : "—"; riskEl.className = "tp-val" + (sl == null ? " neg" : ""); rrEl.textContent = "—"; rrEl.className = "tp-val"; if (sl == null && (entry != null || exit != null)) show = true; }
      // Discipline score this trade will earn (same logic as saved trades)
      var discEl = preview.querySelector("#tpDisc");
      if (show) {
        var d = CM.tradeDiscipline({ plannedSL: sl == null ? null : sl, exit_reason: c.querySelector("#xr").value, emotion: c.querySelector("#emo").value });
        discEl.textContent = String(d);
        discEl.className = "tp-val " + (d >= 75 ? "pos" : d >= 50 ? "" : "neg");
      } else { discEl.textContent = "—"; discEl.className = "tp-val"; }
      preview.hidden = !show;
    }
    ["#side", "#qty", "#entry", "#exit", "#sl", "#xr", "#emo"].forEach(function (id) { c.querySelector(id).addEventListener("input", updatePreview); c.querySelector(id).addEventListener("change", updatePreview); });
    // Free-plan monthly quota indicator
    var q0 = CM.quota();
    if (q0.limit !== Infinity) {
      var pctUsed = Math.min(100, Math.round(q0.used / q0.limit * 100));
      c.appendChild(el('<div class="quota-note' + (q0.remaining <= 3 ? " low" : "") + '">' +
        '<div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:6px"><span>Free logs this month</span><b>' + q0.used + ' / ' + q0.limit + '</b></div>' +
        '<div class="quota-bar"><i style="width:' + pctUsed + '%"></i></div>' +
        (q0.remaining <= 3 ? '<div style="font-size:.78rem;margin-top:6px;color:var(--gold)">' + (q0.remaining > 0 ? q0.remaining + ' free logs left — upgrade for unlimited.' : "You've used all free logs this month.") + '</div>' : '') +
        '</div>'));
    }
    var save = el('<button class="btn btn-primary btn-lg">Save trade &amp; update my score</button>');
    save.addEventListener("click", function () {
      var sym = c.querySelector("#sym").value.trim(); if (!sym) { c.querySelector("#sym").focus(); return; }
      var q = CM.quota();
      if (!q.allowed) {
        dialog("You've hit your free monthly limit", '<p class="hint">You\'ve logged all <b>' + q.limit + '</b> free trades this month. Upgrade to <b>Plus</b> for <b>unlimited</b> logging, full mistake analysis and the AI Discipline Coach — or come back next month, your data is safe.</p><div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-primary" id="qUpgrade">See plans</button></div>', function (b, close) { b.querySelector("#qUpgrade").addEventListener("click", function () { close(); go("profile"); render(); }); });
        return;
      }
      var slv = c.querySelector("#sl").value;
      var saved = CM.addTrade({ symbol: sym, side: c.querySelector("#side").value, qty: +c.querySelector("#qty").value || 0,
        entry: +c.querySelector("#entry").value || 0, exit: +c.querySelector("#exit").value || 0,
        plannedSL: slv === "" ? null : +slv, target: null, setup: c.querySelector("#setup").value,
        exit_reason: c.querySelector("#xr").value, emotion: c.querySelector("#emo").value,
        note: (c.querySelector("#note").value || "").trim().slice(0, 500), date: new Date().toISOString() });
      // Instant honest feedback on the trade just logged (reinforces the loop).
      var d = CM.tradeDiscipline(saved), p = CM.pnl(saved);
      var verdict = d >= 75 ? "Disciplined trade 👏" : d >= 50 ? "Some leaks to plug" : "Undisciplined — this is what costs money";
      var msgs = [];
      if (!CM.hasSL(saved)) msgs.push("No stop-loss logged (−40).");
      if (!/target|stop-loss/i.test(saved.exit_reason)) msgs.push("You didn't exit on plan (−25).");
      if (/revenge|fomo|fear|greed|bored/i.test(saved.exit_reason) || /revenge|fomo|fear|greed|overconfident/i.test(saved.emotion)) msgs.push("Emotional decision (−25).");
      var body = '<div style="text-align:center;margin-bottom:10px">' + gauge(d, 120) + '</div>' +
        '<div style="text-align:center;font-weight:800;font-size:1.05rem;color:' + scoreColor(d) + '">' + verdict + '</div>' +
        '<p class="hint" style="text-align:center;margin:6px 0 0">P&amp;L on this trade: <b class="' + (p >= 0 ? "pos" : "neg") + '">' + money(p) + '</b></p>' +
        (msgs.length ? '<ul class="hint" style="margin:12px 0 0;padding-left:18px">' + msgs.map(function (m) { return '<li>' + m + '</li>'; }).join("") + '</ul>' : '<p class="hint" style="text-align:center;margin-top:10px">Stop set, exited on plan, stayed calm. Keep it up.</p>') +
        '<div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-primary" id="tvReport">See my report card →</button><button class="btn btn-ghost" id="tvAnother">Log another</button></div>';
      dialog("Trade saved · discipline " + d + "/100", body, function (b, close) {
        b.querySelector("#tvReport").addEventListener("click", function () { close(); go("home"); render(); });
        b.querySelector("#tvAnother").addEventListener("click", function () { close(); go("log"); render(); });
      });
      if (d >= 75) confetti();
    });
    c.appendChild(save);
    // Enter in any single-line field saves the trade (textarea keeps normal newlines).
    c.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); save.click(); } });
    c.appendChild(el('<p class="hint" style="margin-top:10px">Tip: leaving <b>Planned SL</b> empty counts as “traded without a stop” — because that’s the truth we\'re measuring.</p>'));
    var preCheck = el('<button class="btn btn-ghost btn-sm" style="margin-top:6px">✅ Not sure? Run the Pre-Trade Check first</button>');
    preCheck.addEventListener("click", function () { go("checklist"); });
    c.appendChild(preCheck);
    v.appendChild(c);

    // Live market chart of the symbol being logged, with YOUR entry / stop / exit
    // drawn right on it — a live preview of what the trade looks like.
    var chartCard = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>📈 Live chart · your trade drawn on it</h3><span class="hint mono" id="chSym" style="flex:1"></span><button class="btn btn-sm" id="chFull" title="Full screen">⛶</button></div><div id="chBox"></div><p class="hint" style="margin-top:8px">Real market candles for this symbol, with your <b style="color:#7aa2ff">entry</b>, <b style="color:#ff5a6a">stop-loss</b> and <b style="color:#f5b849">exit</b> as live lines — updates as you type.</p></div>');
    v.appendChild(chartCard);
    function currentLevels() {
      return { entry: c.querySelector("#entry").value, sl: c.querySelector("#sl").value,
        exit: c.querySelector("#exit").value, side: c.querySelector("#side").value, qty: c.querySelector("#qty").value };
    }
    function mountChart() {
      var sym = (c.querySelector("#sym").value || "").trim() || "NIFTY";
      chartCard.querySelector("#chSym").textContent = sym.toUpperCase();
      liveTradeChart(chartCard.querySelector("#chBox"), sym, currentLevels(), 360);
    }
    function refreshLevels() { var box = chartCard.querySelector("#chBox"); if (box && box._cmSetLevels) box._cmSetLevels(currentLevels()); }
    ["#entry", "#exit", "#sl", "#side", "#qty"].forEach(function (id) {
      c.querySelector(id).addEventListener("input", refreshLevels); c.querySelector(id).addEventListener("change", refreshLevels);
    });
    chartCard.querySelector("#chFull").addEventListener("click", function () { goFullscreen(chartCard.querySelector("#chBox")); });
    function syncLot() {
      var symEl = c.querySelector("#sym"), qtyEl = c.querySelector("#qty"), hint = c.querySelector("#lotHint");
      var lot = lotFor(symEl.value);
      if (hint) hint.textContent = lot ? "· 1 lot = " + lot : "";
      if (lot && (qtyEl.value.trim() === "" || isLotValue(qtyEl.value))) qtyEl.value = lot;
    }
    var ct; c.querySelector("#sym").addEventListener("input", function () { syncLot(); updatePreview(); clearTimeout(ct); ct = setTimeout(mountChart, 700); });
    syncLot();
    updatePreview();
    mountChart();
    return v;
  };

  // ---- TRADE JOURNAL -------------------------------------------------------
  var tradesFilter = "all";
  var TRADE_FILTERS = [
    { id: "all", label: "All", fn: function () { return true; } },
    { id: "nosl", label: "No stop-loss", fn: function (t) { return !CM.hasSL(t); } },
    { id: "emo", label: "Emotional", fn: function (t) { return /revenge|fomo|fear|greed|bored/i.test(t.exit_reason) || /revenge|fomo|fear|greed|overconfident/i.test(t.emotion); } },
    { id: "win", label: "Winners", fn: function (t) { return CM.pnl(t) > 0; } },
    { id: "loss", label: "Losers", fn: function (t) { return CM.pnl(t) < 0; } }
  ];
  VIEWS.trades = function () {
    var s = CM.load(), st = CM.stats();
    var v = el('<div></div>');
    var exp = el('<button class="btn btn-sm">⬇ Export CSV</button>'); exp.addEventListener("click", exportCSV);
    var imp = el('<button class="btn btn-sm">⬆ Import CSV</button>'); imp.addEventListener("click", importCSV);
    v.appendChild(topbar("Trade Journal", st.count + " trades logged", [exp, imp, logBtn()]));
    var limit = CM.PLANS[s.profile.plan].limits.history;
    if (!st.trades.length) {
      var empty = el('<div class="card paywall"><div class="lock-ic">📓</div><h3>No trades yet</h3><p class="hint">Log your first trade to see your Discipline Score come alive.</p></div>');
      var b = el('<button class="btn btn-primary" style="margin-top:8px">＋ Log a trade</button>'); b.addEventListener("click", function () { go("log"); });
      empty.appendChild(b); v.appendChild(empty); return v;
    }
    // Filter chips — isolate your worst habits or your best trades.
    var chips = el('<div class="jrn-filters"></div>');
    TRADE_FILTERS.forEach(function (f) {
      var n = st.trades.filter(f.fn).length;
      var chip = el('<button class="jrn-chip' + (tradesFilter === f.id ? " on" : "") + '">' + f.label + ' <span class="jc-n">' + n + '</span></button>');
      chip.addEventListener("click", function () { tradesFilter = f.id; render(); });
      chips.appendChild(chip);
    });
    v.appendChild(chips);
    var activeFilter = (TRADE_FILTERS.filter(function (f) { return f.id === tradesFilter; })[0] || TRADE_FILTERS[0]).fn;
    var shown = st.trades.filter(activeFilter);
    var c = el('<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Symbol</th><th>Setup</th><th class="num">P&L</th><th>Exit reason</th><th>Emotion</th><th class="num">Disc.</th><th>When</th><th></th></tr></thead><tbody></tbody></table></div>');
    var tb = c.querySelector("tbody");
    if (!shown.length) tb.appendChild(el('<tr><td colspan="8" class="hint" style="text-align:center;padding:18px">No trades match this filter — nice.</td></tr>'));
    shown.forEach(function (t) {
      var p = CM.pnl(t), d = CM.tradeDiscipline(t);
      var tr = el('<tr><td><b>' + esc(t.symbol) + '</b><div class="hint">' + t.side + ' ' + t.qty + '</div>' + (t.note ? '<div class="hint tnote" title="' + esc(t.note) + '">💬 ' + esc(t.note) + '</div>' : '') + '</td>' +
        '<td><span class="chip">' + esc(t.setup) + '</span></td>' +
        '<td class="num ' + (p >= 0 ? "pos" : "neg") + '">' + money(p) + '</td>' +
        '<td>' + esc(t.exit_reason) + (CM.hasSL(t) ? '' : ' <span class="badge b-red">no SL</span>') + '</td>' +
        '<td>' + esc(t.emotion) + '</td>' +
        '<td class="num"><b style="color:' + scoreColor(d) + '">' + d + '</b></td>' +
        '<td class="hint">' + ago(t.date) + '</td><td></td></tr>');
      var an = el('<button class="btn btn-sm" title="Analyse on real chart">📈</button>'); an.addEventListener("click", function () { analyseTrade(t); });
      var edit = el('<button class="btn btn-sm" title="Edit trade">✎</button>'); edit.addEventListener("click", function () { editTrade(t); });
      var del = el('<button class="btn btn-sm" title="Delete">✕</button>'); del.addEventListener("click", function () { if (confirm("Delete this " + t.symbol + " trade?")) { CM.deleteTrade(t.id); toast("Trade deleted", "err"); render(); } });
      tr.lastChild.appendChild(an); tr.lastChild.appendChild(edit); tr.lastChild.appendChild(del); tb.appendChild(tr);
    });
    v.appendChild(c);
    if (limit !== Infinity) v.appendChild(el('<div class="notice" style="margin-top:12px">Free plan analyses your data — full unlimited history &amp; export is in <b>Plus</b>.</div>'));
    return v;
  };

  // Edit an existing trade (fix a typo, correct the exit, add a note).
  function editTrade(t) {
    function opts(list, sel) { return list.map(function (x) { return '<option' + (x === sel ? " selected" : "") + '>' + x + '</option>'; }).join(""); }
    function sideOpts(sel) { return ["Buy", "Sell"].map(function (x) { return '<option' + (x === sel ? " selected" : "") + '>' + x + '</option>'; }).join(""); }
    var body =
      '<div class="grid g2"><label class="fld"><span>Symbol</span><input id="eSym" value="' + esc(t.symbol) + '"/></label>' +
      '<label class="fld"><span>Side</span><select id="eSide">' + sideOpts(t.side) + '</select></label></div>' +
      '<div class="grid g4"><label class="fld"><span>Qty</span><input id="eQty" type="number" value="' + (t.qty || 0) + '"/></label>' +
      '<label class="fld"><span>Entry</span><input id="eEntry" type="number" value="' + (t.entry || 0) + '"/></label>' +
      '<label class="fld"><span>Exit</span><input id="eExit" type="number" value="' + (t.exit || 0) + '"/></label>' +
      '<label class="fld"><span>Planned SL</span><input id="eSL" type="number" value="' + (t.plannedSL == null ? "" : t.plannedSL) + '"/></label></div>' +
      '<div class="grid g3"><label class="fld"><span>Setup</span><select id="eSetup">' + opts(CM.SETUPS, t.setup) + '</select></label>' +
      '<label class="fld"><span>Why did you exit?</span><select id="eXr">' + opts(CM.EXITS, t.exit_reason) + '</select></label>' +
      '<label class="fld"><span>Emotion</span><select id="eEmo">' + opts(CM.EMOTIONS, t.emotion) + '</select></label></div>' +
      '<label class="fld"><span>Note</span><textarea id="eNote" rows="2">' + esc(t.note || "") + '</textarea></label>' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn btn-primary" id="eSave">Save changes</button></div>';
    dialog("Edit " + esc(t.symbol) + " trade", body, function (b, close) {
      b.querySelector("#eSave").addEventListener("click", function () {
        var sl = b.querySelector("#eSL").value;
        CM.updateTrade(t.id, {
          symbol: b.querySelector("#eSym").value.trim() || t.symbol, side: b.querySelector("#eSide").value,
          qty: +b.querySelector("#eQty").value || 0, entry: +b.querySelector("#eEntry").value || 0,
          exit: +b.querySelector("#eExit").value || 0, plannedSL: sl === "" ? null : +sl,
          setup: b.querySelector("#eSetup").value, exit_reason: b.querySelector("#eXr").value,
          emotion: b.querySelector("#eEmo").value, note: (b.querySelector("#eNote").value || "").trim().slice(0, 500)
        });
        close(); toast("Trade updated ✓", "ok"); render();
      });
    });
  }

  // ---- DREAMS / WEALTH PLANNER (the aspiration engine) ---------------------
  var DREAM_PRESETS = [["🏡", "Dream home", 10000000], ["🏎️", "Dream car", 2500000], ["🏝️", "Yearly vacations", 500000], ["🎓", "Kids' education", 5000000], ["🔥", "Financial freedom", 50000000]];
  VIEWS.dreams = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Dream Planner", "Turn discipline into a lifestyle. See what consistent, sized-right money can become."));
    var c = el('<div class="card"></div>');
    var chips = el('<div class="chart-toolbar"></div>');
    DREAM_PRESETS.forEach(function (d) {
      var b = el('<button class="chart-toggle">' + d[0] + ' ' + d[1] + '</button>');
      b.addEventListener("click", function () { c.querySelector("#dName").value = d[1]; c.querySelector("#dEmoji").value = d[0]; c.querySelector("#dTarget").value = d[2]; run(); });
      chips.appendChild(b);
    });
    c.appendChild(chips);
    var form = el('<div class="grid g3"></div>');
    form.innerHTML =
      '<label class="fld"><span>Dream</span><input id="dName" value="Dream home"/></label>' +
      '<label class="fld"><span>Emoji</span><input id="dEmoji" value="🏡"/></label>' +
      '<label class="fld"><span>Target (₹)</span><input id="dTarget" type="number" value="10000000"/></label>' +
      '<label class="fld"><span>Starting capital (₹)</span><input id="dStart" type="number" value="200000"/></label>' +
      '<label class="fld"><span>Invest / month (₹)</span><input id="dMonthly" type="number" value="25000"/></label>' +
      '<label class="fld"><span>Expected return (% / yr)</span><input id="dRate" type="number" value="14" step="0.5"/></label>' +
      '<label class="fld"><span>Years</span><input id="dYears" type="number" value="12" min="1"/></label>';
    c.appendChild(form);
    c.addEventListener("input", function () { run(); });
    // Results + projection chart live in their own card, shown ABOVE the inputs.
    var resultsCard = el('<div class="card" style="margin-bottom:16px"><div class="card-hd"><h3>📈 Your projection</h3></div></div>');
    var out = el('<div id="dOut"></div>');
    resultsCard.appendChild(out);
    function n(id) { var x = parseFloat(c.querySelector(id).value); return isNaN(x) ? 0 : x; }
    function run() {
      var name = c.querySelector("#dName").value, emoji = c.querySelector("#dEmoji").value,
          target = n("#dTarget"), start = n("#dStart"), monthly = n("#dMonthly"), rate = n("#dRate"), years = Math.max(1, n("#dYears"));
      var p = CM.project(start, monthly, rate, years);
      var reachM = CM.monthsToTarget(start, monthly, rate, target);
      var reached = p.fv >= target;
      var growth = p.fv - p.invested;
      out.innerHTML =
        '<div style="display:flex;align-items:center;gap:14px;margin:8px 0 12px"><div style="font-size:2.4rem">' + esc(emoji) + '</div>' +
          '<div><div style="font-weight:800;font-size:1.15rem">' + esc(name) + '</div>' +
          '<div class="hint">In ' + years + ' years you could have <b class="pos mono">' + money(p.fv) + '</b></div></div></div>' +
        '<div class="grid g3">' +
          '<div class="card" style="padding:12px"><div class="hint">Projected corpus</div><div class="mono pos" style="font-size:1.2rem;font-weight:800">' + money(p.fv) + '</div></div>' +
          '<div class="card" style="padding:12px"><div class="hint">You invest</div><div class="mono" style="font-size:1.2rem;font-weight:800">' + money(p.invested) + '</div></div>' +
          '<div class="card" style="padding:12px"><div class="hint">Growth (compounding)</div><div class="mono pos" style="font-size:1.2rem;font-weight:800">' + money(growth) + '</div></div>' +
        '</div>' +
        '<div style="margin-top:12px">' + svgLine(p.series, { id: "dream", color: "#22e08a", h: 170, zeroBase: true }) + '</div>' +
        '<div class="' + (reached ? "" : "notice") + '" style="margin-top:10px;font-weight:600;color:' + (reached ? "var(--green)" : "") + '">' +
          (reached ? "🎉 You reach your " + esc(name) + " goal" + (reachM ? " in about " + Math.floor(reachM / 12) + "y " + (reachM % 12) + "m." : ".") : "At this pace you fall short of " + money(target) + ". Increase monthly investing or time.") + '</div>';
      var save = el('<button class="btn btn-primary" style="margin-top:12px">💾 Save this dream</button>');
      save.addEventListener("click", function () { CM.addDream({ name: name, emoji: emoji, target: target, start: start, monthly: monthly, rate: rate, years: years }); go("dreams"); render(); });
      out.appendChild(save);
      out.appendChild(el('<p class="hint" style="margin-top:10px"><span class="mock-tag">ILLUSTRATIVE</span> A projection using your assumed return — not a guarantee. Markets go up and down. Discipline + time is the real edge.</p>'));
    }
    v.appendChild(resultsCard);   // chart above
    v.appendChild(c);             // inputs below

    // saved dreams
    var saved = CM.dreams();
    if (saved.length) {
      var sc = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>Your dreams</h3></div></div>');
      saved.forEach(function (d) {
        var p = CM.project(d.start, d.monthly, d.rate, d.years);
        var pct = Math.min(100, Math.round(p.fv / d.target * 100));
        var row = el('<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;align-items:center"><div><b>' + esc(d.emoji) + ' ' + esc(d.name) + '</b> <span class="hint">· ₹' + (d.monthly).toLocaleString("en-IN") + '/mo · ' + d.years + 'y</span></div><span class="mono ' + (pct >= 100 ? "pos" : "") + '">' + pct + '% of ' + fmtShortMoney(d.target) + '</span></div><div class="bar" style="margin-top:6px"><i style="width:' + pct + '%"></i></div></div>');
        var del = el('<button class="btn btn-sm btn-ghost" style="margin-top:2px">remove</button>'); del.addEventListener("click", function () { CM.deleteDream(d.id); render(); });
        row.appendChild(del); sc.appendChild(row);
      });
      sc.appendChild(el('<p class="hint" style="margin-top:8px"><b>Plus</b> sends you a monthly dream-progress report so you stay on track.</p>'));
      v.appendChild(sc);
    }
    run();
    return v;
  };
  function fmtShortMoney(n) { var a = Math.abs(n); return a >= 1e7 ? "₹" + (n / 1e7).toFixed(1) + "Cr" : a >= 1e5 ? "₹" + (n / 1e5).toFixed(1) + "L" : money(n); }

  // ---- Modal dialog --------------------------------------------------------
  function dialog(title, bodyHtml, onMount) {
    var back = el('<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:120;display:grid;place-items:center;padding:18px"></div>');
    var box = el('<div style="background:var(--surface);border:1px solid var(--line-2);border-radius:18px;max-width:620px;width:100%;max-height:88vh;overflow:auto;box-shadow:var(--shadow-lg)"></div>');
    var hd = el('<div style="display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface)"><h3 style="margin:0;flex:1">' + title + '</h3></div>');
    var x = el('<button class="btn btn-sm">✕</button>'); x.addEventListener("click", close); hd.appendChild(x);
    var body = el('<div style="padding:20px"></div>'); body.innerHTML = bodyHtml;
    box.appendChild(hd); box.appendChild(body); back.appendChild(box); document.body.appendChild(back);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    function close() { if (back.parentNode) document.body.removeChild(back); }
    if (onMount) onMount(body, close);
    return { close: close, body: body };
  }

  // Lightweight toast — non-blocking feedback for minor actions.
  var _toastWrap = null;
  function toast(msg, kind) {
    if (!_toastWrap) { _toastWrap = el('<div class="toast-wrap"></div>'); document.body.appendChild(_toastWrap); }
    var t = el('<div class="toast' + (kind ? " " + kind : "") + '">' + esc(msg) + '</div>');
    _toastWrap.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 2600);
  }

  // Lightweight confetti burst — celebrates disciplined behaviour (no library).
  function confetti() {
    try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    var colors = ["#22e08a", "#f5b849", "#8b5cf6", "#19d3c5", "#ff5a6a", "#7cc7ff"];
    var wrap = el('<div class="confetti-wrap"></div>');
    for (var i = 0; i < 40; i++) {
      var p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.2) + "s";
      p.style.animationDuration = (0.9 + Math.random() * 0.7) + "s";
      p.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 1900);
  }

  // ---- RISK CALCULATOR -----------------------------------------------------
  var calcSide = "long";
  VIEWS.calc = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Risk & Position-Size Calculator", "Size every trade before you click. The #1 discipline habit."));
    // If we arrived from a chart, size that market; otherwise start blank.
    var pre = handoff.calc; handoff.calc = null;
    var preSym = pre ? pre.label : "";
    var preLot = pre ? (lotFor(pre.label) || lotFor(pre.tv) || 1) : 1;
    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<div class="grid g2" style="margin-bottom:12px">' +
        '<label class="fld"><span>Symbol</span><input id="kSym" list="symList" placeholder="NIFTY, RELIANCE, Gold…" value="' + esc(preSym) + '" autocomplete="off"/><datalist id="symList">' + symOptions() + '</datalist></label>' +
        '<div class="fld"><span>Direction</span><div style="display:flex;gap:8px"><button class="btn btn-sm" id="kLong" style="flex:1">▲ Long / Buy</button><button class="btn btn-sm" id="kShort" style="flex:1">▼ Short / Sell</button></div></div></div>' +
      '<div class="grid g3">' +
        '<label class="fld"><span>Account capital (₹)</span><input id="kCap" type="number" value="100000"/></label>' +
        '<label class="fld"><span>Risk per trade (%)</span><input id="kRisk" type="number" value="1" step="0.1"/></label>' +
        '<label class="fld"><span>Lot / multiplier</span><input id="kLot" type="number" value="' + preLot + '" min="1"/></label>' +
        '<label class="fld"><span>Entry price</span><input id="kEntry" type="number" value="100" step="0.05"/></label>' +
        '<label class="fld"><span>Stop-loss</span><input id="kStop" type="number" value="95" step="0.05"/></label>' +
        '<label class="fld"><span>Target (optional)</span><input id="kTarget" type="number" value="110" step="0.05"/></label>' +
      '</div>' +
      '<div id="kOut" style="margin-top:6px"></div>';
    v.appendChild(c);

    var lastUnits = 0;
    function n(id) { var x = parseFloat(c.querySelector(id).value); return isNaN(x) ? 0 : x; }
    function inr(x) { return "₹" + Math.round(x).toLocaleString("en-IN"); }
    function run() {
      var cap = n("#kCap"), rp = n("#kRisk"), entry = n("#kEntry"), stop = n("#kStop"),
          target = n("#kTarget"), lot = Math.max(1, n("#kLot") || 1);
      var riskAmt = cap * rp / 100, perUnit = Math.abs(entry - stop);
      var units = perUnit > 0 ? Math.floor(riskAmt / perUnit / lot) * lot : 0;
      lastUnits = units;
      var value = units * entry;
      var stopOK = calcSide === "long" ? stop < entry : stop > entry;
      var rr = 0, reward = 0, rewUnit = 0, tOK = true;
      if (target > 0) { rewUnit = calcSide === "long" ? target - entry : entry - target; tOK = rewUnit > 0; reward = units * Math.max(0, rewUnit); rr = perUnit > 0 ? Math.max(0, rewUnit) / perUnit : 0; }
      var badge = !stopOK ? '<span class="badge b-red">⚠ stop on wrong side</span>'
        : (target > 0 && !tOK) ? '<span class="badge b-red">⚠ target on wrong side</span>'
        : rr >= 2 ? '<span class="badge b-green">▲ strong setup · R:R ' + rr.toFixed(1) + '</span>'
        : rr && rr < 1 ? '<span class="badge b-yellow">⚠ poor risk:reward</span>'
        : '<span class="badge b-navy">' + (calcSide === "long" ? "long" : "short") + ' setup</span>';
      var rows = [["You risk", inr(riskAmt), "neg"], ["Position size", units.toLocaleString("en-IN") + (lot > 1 ? " (" + (units / lot) + " lots)" : " units"), ""],
        ["Position value", inr(value), ""], ["Risk : Reward", rr ? "1 : " + rr.toFixed(2) : "—", rr >= 2 ? "pos" : ""],
        ["Potential reward", reward ? inr(reward) : "—", "pos"], ["Reward %", value && reward ? "+" + (reward / value * 100).toFixed(1) + "%" : "—", "pos"]];
      c.querySelector("#kOut").innerHTML = '<div style="margin:10px 0">' + badge + '</div><div class="grid g3">' +
        rows.map(function (r) { return '<div class="card" style="padding:12px"><div class="hint">' + r[0] + '</div><div class="mono ' + r[2] + '" style="font-size:1.2rem;font-weight:800">' + r[1] + '</div></div>'; }).join("") + '</div>';
    }
    ["#kCap", "#kRisk", "#kLot", "#kEntry", "#kStop", "#kTarget"].forEach(function (id) { c.querySelector(id).addEventListener("input", run); });
    function markSide() {
      c.querySelector("#kLong").classList.toggle("btn-primary", calcSide === "long");
      c.querySelector("#kShort").classList.toggle("btn-primary", calcSide === "short");
    }
    c.querySelector("#kLong").addEventListener("click", function () { calcSide = "long"; markSide(); run(); });
    c.querySelector("#kShort").addEventListener("click", function () { calcSide = "short"; markSide(); run(); });
    markSide();

    // Live chart of the symbol being sized (connects the calculator to the market).
    var chartCard = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>📈 Live chart</h3><span class="hint mono" id="kchSym" style="flex:1"></span><button class="btn btn-sm" id="kchFull" title="Full screen">⛶</button></div><div id="kchBox"></div></div>');
    function mountCalcChart() {
      var raw = c.querySelector("#kSym").value.trim(); if (!raw) { chartCard.hidden = true; return; }
      chartCard.hidden = false;
      var sym = tvSymbolFor(raw); chartCard.querySelector("#kchSym").textContent = sym;
      var box = chartCard.querySelector("#kchBox"); box.innerHTML = ""; box.appendChild(tvChart(sym, 420, false));
    }
    chartCard.querySelector("#kchFull").addEventListener("click", function () { goFullscreen(chartCard.querySelector("#kchBox")); });
    var kct; c.querySelector("#kSym").addEventListener("input", function () {
      var lot = lotFor(c.querySelector("#kSym").value);
      if (lot && isLotValue(c.querySelector("#kLot").value)) { c.querySelector("#kLot").value = lot; run(); }
      clearTimeout(kct); kct = setTimeout(mountCalcChart, 700);
    });
    v.appendChild(chartCard);

    // Carry the sized trade straight into the log (feeds the Report Card).
    var logRow = el('<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn btn-primary" id="kLog">Log this trade →</button>' +
      '<span class="hint">Carries the symbol, direction, size, entry &amp; stop into your journal.</span></div>');
    logRow.querySelector("#kLog").addEventListener("click", function () {
      var sym = c.querySelector("#kSym").value.trim();
      if (!sym) { c.querySelector("#kSym").focus(); return; }
      handoff.log = {
        symbol: sym, side: calcSide === "long" ? "Buy" : "Sell",
        qty: lastUnits || null, entry: n("#kEntry") || null,
        plannedSL: n("#kStop") || null, target: n("#kTarget") || null
      };
      go("log"); // hashchange triggers render; a 2nd render() would wipe the handoff
    });
    v.appendChild(logRow);

    run();
    mountCalcChart();
    return v;
  };

  // ---- CSV export / import -------------------------------------------------
  var CSV_COLS = ["symbol", "side", "qty", "entry", "exit", "plannedSL", "setup", "exit_reason", "emotion", "note", "date"];
  function exportCSV() {
    var tr = CM.load().trades;
    var rows = [CSV_COLS.join(",")].concat(tr.map(function (t) {
      return CSV_COLS.map(function (k) { var val = t[k] == null ? "" : String(t[k]); return /[",\n]/.test(val) ? '"' + val.replace(/"/g, '""') + '"' : val; }).join(",");
    }));
    var blob = new Blob([rows.join("\n")], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "chintasmoney-trades.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importCSV() {
    var body = '<p class="hint">Upload a CSV with columns:<br><code>' + CSV_COLS.join(", ") + '</code><br>Only <b>symbol</b> is required; missing stop-loss counts as “no SL”.</p>' +
      '<input type="file" id="csvf" accept=".csv,text/csv" style="margin-top:10px" /><p class="hint" id="csvnote" style="margin-top:8px"></p>';
    dialog("Import trades from CSV", body, function (b, close) {
      b.querySelector("#csvf").addEventListener("change", function (e) {
        var f = e.target.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var n = parseCSV(String(rd.result));
            b.querySelector("#csvnote").innerHTML = '<span class="pos">Imported ' + n + ' trade(s).</span>';
            setTimeout(function () { close(); go("home"); render(); toast("Imported " + n + " trade(s) ✓", "ok"); }, 700);
          } catch (err) { b.querySelector("#csvnote").innerHTML = '<span class="neg">Could not read that file.</span>'; }
        };
        rd.readAsText(f);
      });
    });
  }
  function parseCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return 0;
    var head = splitCSVLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var idx = {}; CSV_COLS.forEach(function (k) { idx[k] = head.indexOf(k.toLowerCase()); });
    var count = 0;
    for (var i = 1; i < lines.length; i++) {
      var cells = splitCSVLine(lines[i]);
      var get = function (k) { return idx[k] >= 0 ? (cells[idx[k]] || "").trim() : ""; };
      var sym = get("symbol"); if (!sym) continue;
      var sl = get("plannedSL");
      CM.addTrade({ symbol: sym, side: get("side") || "Buy", qty: +get("qty") || 0, entry: +get("entry") || 0,
        exit: +get("exit") || 0, plannedSL: sl === "" ? null : +sl, target: null,
        setup: get("setup") || "Other", exit_reason: get("exit_reason") || "Hit target",
        emotion: get("emotion") || "Calm", note: (get("note") || "").slice(0, 500), date: get("date") || new Date().toISOString() });
      count++;
    }
    return count;
  }
  function splitCSVLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
    }
    out.push(cur); return out;
  }

  // ---- Trade preview ladder (self-contained, always works) -----------------
  // Draws Entry / Stop-loss / Target / Exit on a price scale with the risk (red)
  // and reward (green) zones, plus the outcome — so a trader can *see* what the
  // trade would do. No external data needed, so it never fails like an embed.
  function tradeLadder(o) {
    function nz(v) { v = parseFloat(v); return isFinite(v) ? v : null; }
    var entry = nz(o.entry), sl = nz(o.sl), target = nz(o.target), exit = nz(o.exit);
    var qty = Math.abs(nz(o.qty) || 0) || 1, isLong = !/sell/i.test(o.side || "Buy");
    if (entry == null) return null;
    var marks = [{ v: entry, label: "Entry", color: "#7aa2ff" }];
    if (sl != null) marks.push({ v: sl, label: "Stop-loss", color: "#ff5a6a" });
    if (target != null) marks.push({ v: target, label: "Target", color: "#22e08a" });
    if (exit != null) marks.push({ v: exit, label: "Exit", color: "#f5b849" });
    if (marks.length < 2) return null;
    var vals = marks.map(function (m) { return m.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || Math.abs(entry) * 0.02 || 1; lo -= span * 0.2; hi += span * 0.2;
    var W = 340, H = 180, top = 14, bot = 14, RX = W - 150;
    function y(v) { return top + (hi - v) / (hi - lo) * (H - top - bot); }
    function money(n) { return (n < 0 ? "-₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN"); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block;overflow:visible">';
    // risk zone entry <-> stop
    if (sl != null) { var y1 = Math.min(y(entry), y(sl)), y2 = Math.max(y(entry), y(sl)); s += '<rect x="10" y="' + y1 + '" width="' + (RX - 10) + '" height="' + (y2 - y1) + '" fill="rgba(255,90,106,.14)"/>'; }
    // reward zone entry <-> target
    if (target != null) { var g1 = Math.min(y(entry), y(target)), g2 = Math.max(y(entry), y(target)); s += '<rect x="10" y="' + g1 + '" width="' + (RX - 10) + '" height="' + (g2 - g1) + '" fill="rgba(34,224,138,.14)"/>'; }
    marks.forEach(function (m) {
      var yy = y(m.v);
      s += '<line x1="10" y1="' + yy + '" x2="' + RX + '" y2="' + yy + '" stroke="' + m.color + '" stroke-width="2" stroke-dasharray="' + (m.label === "Entry" ? "0" : "5 4") + '"/>';
      s += '<circle cx="10" cy="' + yy + '" r="3.5" fill="' + m.color + '"/>';
      s += '<text x="' + (RX + 8) + '" y="' + (yy + 4) + '" fill="' + m.color + '" font-size="12" font-weight="700">' + m.label + ' ' + m.v + '</text>';
    });
    s += '</svg>';
    // Outcome numbers
    var riskPer = sl != null ? Math.abs(entry - sl) : null;
    var rewPer = target != null ? (isLong ? target - entry : entry - target) : (exit != null ? (isLong ? exit - entry : entry - exit) : null);
    var rr = (riskPer && rewPer != null && riskPer > 0) ? Math.abs(rewPer) / riskPer : null;
    var pnl = exit != null ? (isLong ? exit - entry : entry - exit) * qty : null;
    var chips = '<div class="tl-chips">';
    if (riskPer != null) chips += '<span class="tl-chip"><b class="neg">' + money(riskPer * qty) + '</b> at risk</span>';
    if (rr != null) chips += '<span class="tl-chip"><b class="' + (rr >= 2 ? "pos" : rr >= 1 ? "" : "neg") + '">1:' + rr.toFixed(2) + '</b> R:R</span>';
    if (pnl != null) chips += '<span class="tl-chip"><b class="' + (pnl >= 0 ? "pos" : "neg") + '">' + money(pnl) + '</b> outcome</span>';
    if (sl == null) chips += '<span class="tl-chip"><b class="neg">no stop-loss</b></span>';
    chips += '</div>';
    var wrap = el('<div class="tl-wrap"><div class="tl-svg">' + s + '</div>' + chips + '</div>');
    return wrap;
  }

  // Map a user's symbol to a Yahoo symbol our /api/candles endpoint can fetch.
  function yfSymbolFor(sym) {
    sym = (sym || "").trim().toUpperCase().replace(/^(NSE|BSE|BINANCE|OANDA|TVC|NASDAQ|NYMEX|FX_IDC):/, "");
    var map = { NIFTY: "^NSEI", "NIFTY 50": "^NSEI", NIFTY50: "^NSEI", BANKNIFTY: "^NSEBANK", "BANK NIFTY": "^NSEBANK",
      FINNIFTY: "^CNXFIN", SENSEX: "^BSESN", NIFTYBEES: "^NSEI", BANKBEES: "^NSEBANK", BTCUSDT: "BTC-USD", ETHUSDT: "ETH-USD",
      XAUUSD: "GC=F", USOIL: "CL=F", SPX: "^GSPC", NDX: "^NDX", DJI: "^DJI" };
    if (map[sym]) return map[sym];
    if (/BANKNIFTY/.test(sym)) return "^NSEBANK";
    if (/NIFTY/.test(sym)) return "^NSEI";
    if (/SENSEX/.test(sym)) return "^BSESN";
    if (/^BTC/.test(sym)) return "BTC-USD";
    if (/^ETH/.test(sym)) return "ETH-USD";
    if (/XAU|GOLD/.test(sym)) return "GC=F";
    var first = sym.split(/\s+/)[0].replace(/[^A-Z0-9&.\-=^]/g, "");
    return first ? first + ".NS" : "^NSEI";
  }
  // Lazy-load TradingView's free lightweight-charts library (once).
  var _lwcPromise = null;
  function loadLWC() {
    if (window.LightweightCharts) return Promise.resolve();
    if (_lwcPromise) return _lwcPromise;
    _lwcPromise = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return _lwcPromise;
  }
  // Live candlestick chart (our own data) with the trade's Entry/Stop/Target/Exit
  // drawn as price lines. Falls back to the self-contained ladder if anything fails,
  // so it never leaves an empty/broken chart.
  function liveTradeChart(box, userSym, levels, h) {
    h = h || 320; box.innerHTML = "";
    var host = el('<div style="height:' + h + 'px;width:100%"></div>'); box.appendChild(host);
    var done = false;
    function fallback() { if (done) return; done = true; box.innerHTML = ""; var l = tradeLadder(levels || {}); box.appendChild(l || el('<p class="hint">Live chart unavailable right now.</p>')); }
    var ysym = yfSymbolFor(userSym);
    Promise.all([
      loadLWC(),
      fetch("/api/candles?symbol=" + encodeURIComponent(ysym) + "&range=3mo").then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (a) {
      var data = a[1];
      if (done || !window.LightweightCharts || !data || !data.candles || data.candles.length < 3) { fallback(); return; }
      done = true;
      var chart = LightweightCharts.createChart(host, {
        height: h, autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#8a83a6", fontFamily: "inherit" },
        grid: { vertLines: { color: "rgba(255,255,255,.05)" }, horzLines: { color: "rgba(255,255,255,.05)" } },
        timeScale: { borderColor: "rgba(255,255,255,.1)" }, rightPriceScale: { borderColor: "rgba(255,255,255,.1)" },
        crosshair: { mode: 0 }
      });
      var series = chart.addCandlestickSeries({ upColor: "#22e08a", downColor: "#ff5a6a", borderVisible: false, wickUpColor: "#22e08a", wickDownColor: "#ff5a6a" });
      series.setData(data.candles.map(function (c) { return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }; }));
      chart.timeScale().fitContent();
      var lines = {};
      function setLine(key, v, color, title) {
        var n = parseFloat(v);
        if (lines[key]) { try { series.removePriceLine(lines[key]); } catch (e) {} lines[key] = null; }
        if (isFinite(n)) lines[key] = series.createPriceLine({ price: n, color: color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: title });
      }
      box._cmSetLevels = function (lv) { lv = lv || {}; setLine("entry", lv.entry, "#7aa2ff", "Entry"); setLine("sl", lv.sl, "#ff5a6a", "Stop"); setLine("target", lv.target, "#22e08a", "Target"); setLine("exit", lv.exit, "#f5b849", "Exit"); };
      box._cmSetLevels(levels);
      new ResizeObserver(function () { try { chart.applyOptions({ width: host.clientWidth }); } catch (e) {} }).observe(host);
    }).catch(fallback);
  }

  // ---- Analyse a trade on the real TradingView chart -----------------------
  function analyseTrade(t) {
    var sym = tvSymbolFor(t.symbol), p = CM.pnl(t), d = CM.tradeDiscipline(t);
    var body =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<span class="chip">' + esc(t.side) + ' ' + t.qty + '</span>' +
        '<span class="chip">Entry ' + t.entry + '</span>' +
        '<span class="chip">Exit ' + t.exit + '</span>' +
        (CM.hasSL(t) ? '<span class="chip">SL ' + t.plannedSL + '</span>' : '<span class="badge b-red">no SL</span>') +
        '<span class="chip">' + esc(t.setup) + '</span>' +
        '<span class="badge ' + (p >= 0 ? "b-green" : "b-red") + '">P&L ' + money(p) + '</span>' +
        '<span class="badge b-navy">discipline ' + d + '</span>' +
      '</div>' +
      '<div style="font-size:.82rem;color:var(--muted);margin-bottom:6px">Live chart for <b style="color:var(--ink)">' + sym + '</b> · exit reason: ' + esc(t.exit_reason) + ' · felt: ' + esc(t.emotion) + '</div>' +
      (t.note ? '<div style="font-size:.85rem;font-style:italic;color:var(--ink-soft,var(--ink));margin-bottom:8px">💬 ' + esc(t.note) + '</div>' : '') +
      '<div id="anBox"></div>' +
      '<p class="hint" style="margin-top:8px">Compare your entry/exit/stop against what the real market did. Would a disciplined trader have taken this?</p>';
    dialog(esc(t.symbol) + " · analyse", body, function (b) {
      liveTradeChart(b.querySelector("#anBox"), t.symbol,
        { entry: t.entry, sl: t.plannedSL, exit: t.exit, target: t.target, side: t.side, qty: t.qty }, 460);
    });
  }

  // ---- TRADE REPLAY (premium) ---------------------------------------------
  // What would have actually happened: read the real candles after the entry
  // date and check the market against the trader's plan.
  function analyzeReplay(candles, t) {
    var entry = +t.entry, sl = (t.plannedSL == null ? null : +t.plannedSL), target = (t.target ? +t.target : null),
        exit = +t.exit, qty = Math.abs(+t.qty || 0) || 1, isLong = !/sell/i.test(t.side || "Buy");
    if (!isFinite(entry) || !candles.length) return null;
    var ed = new Date(t.date).getTime() / 1000;
    var i0 = 0; while (i0 < candles.length && candles[i0].time < ed - 86400) i0++;
    if (i0 >= candles.length) i0 = Math.max(0, candles.length - 20);
    var fwd = candles.slice(i0, i0 + 30); if (!fwd.length) return null;
    var maxH = Math.max.apply(null, fwd.map(function (c) { return c.high; }));
    var minL = Math.min.apply(null, fwd.map(function (c) { return c.low; }));
    var stopHit = sl != null && (isLong ? minL <= sl : maxH >= sl);
    var targetHit = target != null && (isLong ? maxH >= target : minL <= target);
    var bestExit = isLong ? maxH : minL, worst = isLong ? minL : maxH;
    var actualPnl = (isLong ? exit - entry : entry - exit) * qty;
    var bestPnl = (isLong ? bestExit - entry : entry - bestExit) * qty;
    return { stopHit: stopHit, targetHit: targetHit, bestExit: bestExit, worst: worst,
      actualPnl: actualPnl, bestPnl: bestPnl, left: Math.max(0, bestPnl - actualPnl), days: fwd.length };
  }
  function replayPanel(a, t) {
    var isLong = !/sell/i.test(t.side || "Buy"), rows = [];
    if (t.plannedSL != null) rows.push(a.stopHit
      ? ["Your stop-loss would have been hit", "The market reached your stop — good you had one to cap the loss.", "neg"]
      : ["Your stop-loss held", "The market never touched your stop in the days after entry.", "pos"]);
    else rows.push(["You had no stop-loss", "The market moved to ₹" + Math.round(a.worst) + " against you — with no stop, that was your full exposure.", "neg"]);
    if (t.target) rows.push(a.targetHit
      ? ["Target reached", "The market hit your target — the plan worked.", "pos"]
      : ["Target not reached", "The market didn't reach your target in this window.", ""]);
    rows.push(["Best exit the market offered", "₹" + Math.round(a.bestExit) + " (" + money(a.bestPnl) + "). You exited at ₹" + t.exit + " (" + money(a.actualPnl) + ").", a.left > 0 ? "" : "pos"]);
    if (a.left > 0) rows.push(["Left on the table", money(a.left) + " — you exited before the best price the market gave.", ""]);
    return '<div class="rp-panel"><h4>What actually happened <span class="hint" style="font-weight:400">· ' + a.days + ' trading days after entry</span></h4>' +
      rows.map(function (r) { return '<div class="rp-row ' + r[2] + '"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>'; }).join("") + '</div>';
  }
  function behaviourPanel(t) {
    var d = CM.tradeDiscipline(t);
    return '<div class="rp-panel"><h4>Your behaviour on this trade</h4>' +
      '<div class="rp-row"><b>Discipline</b><span style="color:' + scoreColor(d) + '">' + d + '/100 · ' + scoreLabel(d) + '</span></div>' +
      '<div class="rp-row"><b>Stop-loss</b><span>' + (CM.hasSL(t) ? "Set at ₹" + t.plannedSL : "Not set — you traded without a stop") + '</span></div>' +
      '<div class="rp-row"><b>Why you exited</b><span>' + esc(t.exit_reason || "—") + '</span></div>' +
      '<div class="rp-row"><b>How you felt</b><span>' + esc(t.emotion || "—") + '</span></div>' +
      (t.note ? '<div class="rp-row"><b>Your note</b><span>💬 ' + esc(t.note) + '</span></div>' : '') + '</div>';
  }
  function openReplay(t) {
    var levels = { entry: t.entry, sl: t.plannedSL, exit: t.exit, target: t.target, side: t.side, qty: t.qty };
    var body = '<div id="rpChart"></div><div id="rpOut" style="margin-top:12px"><p class="hint">Loading the real market for ' + esc(t.symbol) + '…</p></div>';
    dialog(esc(t.symbol) + " · trade replay", body, function (b) {
      liveTradeChart(b.querySelector("#rpChart"), t.symbol, levels, 380);
      var ysym = yfSymbolFor(t.symbol);
      var age = (Date.now() - new Date(t.date).getTime()) / 86400000;
      var range = age > 200 ? "1y" : age > 80 ? "6mo" : "3mo";
      fetch("/api/candles?symbol=" + encodeURIComponent(ysym) + "&range=" + range).then(function (r) { return r.json(); }).then(function (data) {
        var out = b.querySelector("#rpOut");
        if (!data || !data.candles || !data.candles.length) { out.innerHTML = behaviourPanel(t); return; }
        var a = analyzeReplay(data.candles, t);
        out.innerHTML = (a ? replayPanel(a, t) : "") + behaviourPanel(t);
      }).catch(function () { b.querySelector("#rpOut").innerHTML = behaviourPanel(t); });
    });
  }
  VIEWS.replay = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Trade Replay", "Replay any trade on the real market for its actual dates — see what would have happened."));
    var trades = CM.load().trades.filter(function (t) { return !/^s\d+$/.test(t.id || ""); });
    var c = el('<div class="card"></div>');
    if (!trades.length) { c.appendChild(el('<p class="hint">Log a trade first — then replay it here to see exactly what the market did after your entry.</p>')); v.appendChild(c); return v; }
    c.appendChild(el('<p class="hint" style="margin:0 0 12px">Pick a trade to replay on the real market chart of its dates, with your entry, stop and exit drawn on it.</p>'));
    var listEl = el('<div class="replay-list"></div>');
    trades.slice(0, 60).forEach(function (t) {
      var p = CM.pnl(t), d = CM.tradeDiscipline(t);
      var row = el('<button class="replay-row"><div class="rr-main"><b>' + esc(t.symbol) + '</b><span class="hint">' + esc(t.side) + ' ' + t.qty + ' · ' + new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) + '</span></div><div class="rr-side"><span class="' + (p >= 0 ? "pos" : "neg") + '">' + money(p) + '</span><span class="badge b-navy">D' + d + '</span><span class="rr-go">Replay →</span></div></button>');
      row.addEventListener("click", function () { openReplay(t); });
      listEl.appendChild(row);
    });
    c.appendChild(listEl); v.appendChild(c);
    return v;
  };

  // ---- MISTAKE INSIGHTS ----------------------------------------------------
  VIEWS.insights = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Mistake Insights", "Your repeating leaks — ranked by how often they happen."));
    var ms = CM.mistakes();
    var c = el('<div class="card"></div>');
    if (!ms.length) c.appendChild(el('<p class="hint">Clean sheet so far. Keep logging honestly.</p>'));
    ms.forEach(function (m) {
      var max = ms[0].n || 1;
      c.appendChild(el('<div style="margin:10px 0"><div style="display:flex;justify-content:space-between"><b>' + esc(m.name) + '</b><span class="muted">×' + m.n + '</span></div><div class="bar coral" style="margin:6px 0"><i style="width:' + Math.round(m.n / max * 100) + '%"></i></div><div class="hint">' + esc(m.tip) + '</div></div>'));
    });
    v.appendChild(c);
    return v;
  };

  // ---- SETUP PERFORMANCE (Pro) ---------------------------------------------
  VIEWS.strategy = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Setup Performance", "Which of your setups actually make money?"));
    var sp = CM.setupPerformance();
    var c = el('<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Setup</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Net P&L</th></tr></thead><tbody></tbody></table></div>');
    var tb = c.querySelector("tbody");
    sp.forEach(function (r) { tb.appendChild(el('<tr><td><b>' + esc(r.setup) + '</b></td><td class="num">' + r.n + '</td><td class="num">' + r.winRate + '%</td><td class="num ' + (r.pnl >= 0 ? "pos" : "neg") + '">' + money(r.pnl) + '</td></tr>')); });
    v.appendChild(c);
    if (sp.length) { var best = sp[0], worst = sp[sp.length - 1]; v.appendChild(el('<div class="notice" style="margin-top:12px">Your <b>' + esc(best.setup) + '</b> setup is your money-maker. Your <b>' + esc(worst.setup) + '</b> setup is bleeding — do you even need it?</div>')); }
    return v;
  };

  // ---- DISCIPLINE COACH ----------------------------------------------------
  var chat = [];
  VIEWS.coach = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Discipline Coach", "Asks about YOUR data. Coaches behaviour — never gives buy/sell tips."));
    var c = el('<div class="card"></div>');
    var box = el('<div class="chat"></div>');
    if (!chat.length) chat.push({ r: "a", t: "I'm your discipline coach. I won't tell you what to trade — I'll show you how you trade. Ask me something." });
    chat.forEach(function (m) { box.appendChild(bubble(m)); });
    c.appendChild(box);
    var sug = el('<div class="suggest"></div>');
    ["Why is my discipline score low?", "What's my biggest mistake?", "Am I improving this week?", "How's my win rate and R:R?", "Which setup should I drop?", "Am I overtrading?", "How do I stop revenge trading?"].forEach(function (q) { var b = el('<button>' + q + '</button>'); b.addEventListener("click", function () { ask(q, box); }); sug.appendChild(b); });
    c.appendChild(sug);
    var comp = el('<div class="composer"><input placeholder="Ask your coach…" /><button class="btn btn-primary">Ask</button></div>');
    var i = comp.querySelector("input"), b = comp.querySelector("button");
    function send() { var q = i.value.trim(); if (q) { i.value = ""; ask(q, box); } }
    b.addEventListener("click", send); i.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
    c.appendChild(comp); v.appendChild(c); return v;
  };
  function bubble(m) { var e = el('<div class="msg ' + m.r + '">' + esc(m.t).replace(/\n/g, "<br>") + '</div>'); if (m.ev) e.appendChild(el('<div class="ev"><b>From your data:</b> ' + esc(m.ev) + '</div>')); return e; }
  function ask(q, box) { chat.push({ r: "u", t: q }); box.appendChild(bubble(chat[chat.length - 1])); var a = coach(q); chat.push({ r: "a", t: a.t, ev: a.ev }); box.appendChild(bubble(chat[chat.length - 1])); box.scrollTop = box.scrollHeight; CM.load().usage.aiQuestions++; CM.save(); }
  function coach(q) {
    var st = CM.stats(), lc = q.toLowerCase(), ms = CM.mistakes();
    if (/discipline|score|low|why/.test(lc)) return { t: "Your discipline score is " + st.discipline + " (" + scoreLabel(st.discipline) + "). The biggest drags: " + (st.noSL ? st.noSL + " trades with no stop-loss, " : "") + st.emotional + " emotional exits" + (st.overtradeDays ? ", and " + st.overtradeDays + " overtrading day(s)" : "") + ". Fix stops first — it's the fastest 40-point swing.", ev: st.count + " trades analysed" };
    if (/mistake|biggest|wrong/.test(lc)) return { t: ms.length ? "Your #1 leak is “" + ms[0].name + "” (×" + ms[0].n + "). " + ms[0].tip : "No repeating mistake stands out yet.", ev: ms.length ? ms.map(function (m) { return m.name + " ×" + m.n; }).join(", ") : "clean" };
    if (/setup|drop|strategy/.test(lc)) { var sp = CM.setupPerformance(); var w = sp[sp.length - 1]; return { t: w ? "Your weakest setup is “" + w.setup + "” (" + w.winRate + "% win, " + money(w.pnl) + "). If it keeps bleeding, cut it and double down on “" + sp[0].setup + "”." : "Log more trades to compare setups.", ev: "setup P&L from your logs" }; }
    if (/overtrad/.test(lc)) return { t: st.overtradeDays ? "Yes — " + st.overtradeDays + " day(s) you took more than 3 trades. More trades ≠ more money; it usually means chasing." : "No — you're not overtrading. Good.", ev: st.overtradeDays + " overtrading days" };
    if (/revenge/.test(lc)) return { t: "Revenge trading is the account-killer. Rule: after any red trade, hands off the keyboard for 10 minutes. Set a hard daily loss limit and stop when you hit it. I'll track whether you actually followed it.", ev: null };
    if (/stop.?loss|stop|no.?sl/.test(lc)) return { t: st.noSL ? "You've traded without a stop-loss " + st.noSL + " time(s) — each one costs 40 discipline points and risks your whole account. Decide the stop before you enter, every time. Not one exception." : "You set a stop on every trade so far — that's the single best habit you have. Protect it.", ev: st.noSL + " no-SL trades of " + st.count };
    if (/win.?rate|winrate|profitable|r.?:?.?r|reward|ratio/.test(lc)) return { t: "Your win rate is " + st.winRate + "% and your risk:reward is " + (st.rr ? st.rr.toFixed(2) + "×" : "not enough data") + ". " + (st.rr && st.rr >= 1.5 ? "That R:R means you can be wrong often and still make money — protect it." : "A low R:R means even a good win rate leaks money. Aim to let winners run to at least 1.5× your risk.") , ev: st.winRate + "% win · " + (st.rr ? st.rr.toFixed(2) + "× R:R" : "R:R n/a") };
    if (/week|improv|progress|better|getting|trend|doing/.test(lc)) {
      var trs = CM.load().trades, now = Date.now(), DAY = 864e5;
      function avgD(from, to) { var xs = trs.filter(function (t) { var tm = new Date(t.date).getTime(); return isFinite(tm) && tm >= from && tm < to; }); return xs.length ? { n: xs.length, avg: Math.round(xs.reduce(function (a, t) { return a + CM.tradeDiscipline(t); }, 0) / xs.length) } : { n: 0, avg: null }; }
      var tw = avgD(now - 7 * DAY, now + DAY), lw = avgD(now - 14 * DAY, now - 7 * DAY);
      if (!tw.n) return { t: "You haven't logged any trades in the last 7 days. Discipline is a habit — log even the trades you're not proud of. That's where the growth is.", ev: "0 trades this week" };
      var line = "This week your average discipline is " + tw.avg + " across " + tw.n + " trade(s). ";
      if (lw.avg == null) line += "Log another week and I'll show you the trend."; else if (tw.avg > lw.avg) line += "That's up from " + lw.avg + " last week — you're tightening up. Keep going."; else if (tw.avg < lw.avg) line += "That's down from " + lw.avg + " last week — something slipped. Check your no-SL and emotional exits."; else line += "Same as last week (" + lw.avg + ") — steady, but push for cleaner entries.";
      return { t: line, ev: "this week " + tw.avg + (lw.avg != null ? " vs last week " + lw.avg : "") };
    }
    return { t: "I answer from your own trades: discipline score, mistakes, setups, overtrading, revenge, stop-losses, win rate and your weekly progress. Try a suggestion above.", ev: null };
  }

  // ---- BADGES & STREAKS ----------------------------------------------------
  VIEWS.badges = function () {
    var v = el('<div></div>');
    v.appendChild(topbar("Streaks & Badges", "Earn these by trading with discipline — not by winning."));
    var e = CM.engagement(), all = CM.badges(), got = all.filter(function (b) { return b.got; }).length, pct = Math.round(got / all.length * 100);
    var hero = el('<div class="today-hero" style="max-width:none"></div>');
    hero.innerHTML =
      '<div class="th-row"><div><div class="th-hi">🏅 ' + got + ' of ' + all.length + ' badges earned</div>' +
        '<div class="th-sub">Every badge is a discipline habit locked in.</div></div>' +
        '<div class="th-rank">🔥 ' + e.streak + '-day streak</div></div>' +
      '<div class="th-xp"><i style="width:' + pct + '%"></i></div>' +
      '<div class="th-xpt">' + (got === all.length ? "All badges unlocked — legend. 👑" : (all.length - got) + ' more to collect') + '</div>';
    v.appendChild(hero);

    // Activity heatmap — last 12 weeks of logging (GitHub-style)
    var hmCard = el('<div class="card" style="margin-top:16px"><div class="card-hd"><h3>Your logging activity</h3><span class="hint">last 12 weeks</span></div></div>');
    var counts = {}; CM.load().trades.forEach(function (t) { var d = new Date(t.date); if (!isNaN(d)) { var k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); counts[k] = (counts[k] || 0) + 1; } });
    var WEEKS = 12, today = new Date(); today.setHours(0, 0, 0, 0);
    var end = new Date(today); end.setDate(end.getDate() + (6 - end.getDay())); // Sat of this week
    var days = WEEKS * 7, activeDays = 0, cellsHtml = "";
    var cols = [];
    for (var w = 0; w < WEEKS; w++) cols.push([]);
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(end); d.setDate(end.getDate() - i);
      var k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      var n = counts[k] || 0; if (n > 0 && d <= today) activeDays++;
      var lvl = d > today ? -1 : n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4;
      var colIdx = Math.floor((days - 1 - i) / 7);
      cols[colIdx].push({ lvl: lvl, k: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), n: n });
    }
    var grid = '<div class="heatmap">';
    cols.forEach(function (col) { grid += '<div class="hm-col">' + col.map(function (c) { return c.lvl < 0 ? '<i class="hm-cell hm-future"></i>' : '<i class="hm-cell hm-l' + c.lvl + '" title="' + c.k + ' · ' + c.n + ' trade' + (c.n === 1 ? "" : "s") + '"></i>'; }).join("") + '</div>'; });
    grid += '</div>';
    hmCard.appendChild(el(grid));
    hmCard.appendChild(el('<div class="hm-legend"><span>' + activeDays + ' active day' + (activeDays === 1 ? "" : "s") + '</span><span class="hm-scale">Less <i class="hm-cell hm-l0"></i><i class="hm-cell hm-l1"></i><i class="hm-cell hm-l2"></i><i class="hm-cell hm-l3"></i><i class="hm-cell hm-l4"></i> More</span></div>'));
    v.appendChild(hmCard);

    var g = el('<div class="grid g3" style="margin-top:16px"></div>');
    all.slice().sort(function (a, b) { return (b.got ? 1 : 0) - (a.got ? 1 : 0); }).forEach(function (b) {
      g.appendChild(el('<div class="badge-card' + (b.got ? " got" : "") + '"><div class="bc-em">' + b.em + '</div><div class="bc-name">' + esc(b.name) + '</div><div class="bc-desc">' + esc(b.desc) + '</div><div class="bc-tag">' + (b.got ? '✓ Earned' : '🔒 Locked') + '</div></div>'));
    });
    v.appendChild(g);
    return v;
  };

  // ---- LEADERBOARD (mock, discipline-based) --------------------------------
  function leagueOf(d) {
    if (d >= 90) return { n: "Diamond", em: "💎", c: "#7cc7ff", next: null };
    if (d >= 75) return { n: "Platinum", em: "🛡️", c: "#19d3c5", next: "Diamond" };
    if (d >= 60) return { n: "Gold", em: "🏆", c: "#f5b849", next: "Platinum" };
    if (d >= 40) return { n: "Silver", em: "🥈", c: "#c9d2e3", next: "Gold" };
    return { n: "Bronze", em: "🥉", c: "#cd7f32", next: "Silver" };
  }
  VIEWS.leaderboard = function () {
    var s = CM.load(), st = CM.stats(), e = CM.engagement();
    var v = el('<div></div>');
    v.appendChild(topbar("Discipline League", "Ranked by discipline, NOT by P&L — because P&L lies."));
    var lg = leagueOf(st.discipline);
    var daysLeft = 7 - (new Date().getDay() || 7) + 1;
    // Weekly field (demo rivals) with the player inserted.
    var field = [
      { h: "@steady_sniper", d: 92, s: 21 }, { h: "@nifty_ninja", d: 88, s: 16 }, { h: "@calm_capital", d: 84, s: 12 },
      { h: "@sl_samurai", d: 80, s: 9 }, { h: "@zen_trader", d: 77, s: 30 }, { h: "@process_pete", d: 72, s: 7 },
      { h: "@chart_monk", d: 68, s: 5 }, { h: "@patient_priya", d: 64, s: 11 }, { h: "@swingqueen", d: 58, s: 4 },
      { h: "@fomo_fan", d: 44, s: 1 }, { h: "@yolo_options", d: 39, s: 0 }, { h: "@revenge_raj", d: 27, s: 0 }
    ];
    field.push({ h: s.profile.handle || "you", d: st.discipline, s: e.streak, me: true });
    field.sort(function (a, b) { return b.d - a.d; });
    var myRank = field.findIndex(function (r) { return r.me; }) + 1, total = field.length;
    // Header hero
    var hero = el('<div class="lg-hero"><div class="lg-badge" style="background:' + lg.c + '22;border-color:' + lg.c + '66;color:' + lg.c + '">' + lg.em + ' ' + lg.n + ' League</div>' +
      '<div class="lg-rank">You\'re <b>#' + myRank + '</b> of ' + total + '</div>' +
      '<div class="lg-sub">' + (myRank <= 3 ? '🚀 In the promotion zone — hold your rank to reach <b>' + (lg.next || "the top") + '</b>!' : 'Climb to <b>top 3</b> to get promoted' + (lg.next ? ' to <b>' + lg.next + '</b>' : '') + '.') + ' · ' + daysLeft + ' day' + (daysLeft > 1 ? 's' : '') + ' left</div></div>');
    v.appendChild(hero);
    var c = el('<div class="card" style="padding:8px 10px"></div>');
    field.forEach(function (r, i) {
      var rank = i + 1, promo = rank <= 3, releg = rank > total - 3;
      var medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
      c.appendChild(el('<div class="lg-row' + (r.me ? " me" : "") + (promo ? " promo" : releg ? " releg" : "") + '">' +
        '<div class="lg-pos">' + medal + '</div>' +
        '<div class="lg-who"><b>' + esc(r.h) + '</b>' + (r.me ? ' <span class="badge b-navy">you</span>' : '') + '<div class="lg-streak">🔥 ' + r.s + '</div></div>' +
        '<div class="lg-score" style="color:' + scoreColor(r.d) + '">' + r.d + '</div></div>'));
      if (rank === 3) c.appendChild(el('<div class="lg-line"><span>▲ promotion</span></div>'));
      if (rank === total - 3) c.appendChild(el('<div class="lg-line down"><span>▼ relegation</span></div>'));
    });
    v.appendChild(c);
    v.appendChild(el('<div class="notice" style="margin-top:12px">Rivals shown are demo accounts — real head-to-head leagues arrive with the backend. The point stands: we reward <b>discipline</b>, never P&amp;L.</div>'));
    return v;
  };

  // ---- SHAREABLE CARD ------------------------------------------------------
  VIEWS.card = function () {
    var s = CM.load(), st = CM.stats(), p = st.personality;
    var v = el('<div></div>');
    v.appendChild(topbar("Your Shareable Card", "Screenshot it. Post it. Tag a trader who needs it."));
    var e = CM.engagement();
    var topPct = Math.max(3, Math.round((100 - st.discipline) * 0.55));
    var rare = st.discipline >= 75;
    function cell(l, val) { return '<div><div style="font-size:1.35rem;font-weight:800">' + val + '</div><div style="color:#8ea3c9;font-size:.72rem">' + l + '</div></div>'; }
    var g = gauge(st.discipline, 168).replace('fill="var(--ink)"', 'fill="#fff"').replace('fill="var(--line)"', 'fill="rgba(255,255,255,.13)"').replace('fill="var(--muted)"', 'fill="#8ea3c9"');
    var card = el('<div class="share-card' + (rare ? " rare" : "") + '"></div>');
    card.innerHTML =
      '<div class="sc-top"><b>ChintasMoney</b><span>TRADER REPORT CARD</span></div>' +
      '<div class="sc-rank">🏆 TOP ' + topPct + '% DISCIPLINED · this week</div>' +
      '<div style="text-align:center;margin:2px 0 0"><span style="display:inline-block;padding:3px 12px;border-radius:999px;font-size:.8rem;font-weight:800;background:' + leagueOf(st.discipline).c + '22;border:1px solid ' + leagueOf(st.discipline).c + '66;color:' + leagueOf(st.discipline).c + '">' + leagueOf(st.discipline).em + ' ' + leagueOf(st.discipline).n + ' League</span></div>' +
      '<div style="text-align:center;margin:6px 0 2px">' + g + '</div>' +
      '<div style="text-align:center"><div style="font-size:1.9rem">' + p.em + '</div><h2 style="margin:2px 0;color:#fff">' + esc(p.key) + '</h2><p style="color:#b7c4dd;font-size:.9rem;margin:0 auto;max-width:34ch">' + esc(p.line) + '</p></div>' +
      '<div class="sc-level"><span class="sc-pill">' + e.em + ' Lv ' + e.level + ' · ' + esc(e.title) + '</span><span class="sc-pill flame">🔥 ' + e.streak + '-day streak</span></div>' +
      '<div class="sc-xp"><i style="width:' + e.pct + '%"></i></div><div class="sc-xpt">' + e.xpToNext + ' XP to level ' + (e.level + 1) + '</div>' +
      '<div class="sc-stats">' + cell("Win rate", st.winRate + "%") + cell("No-SL", st.noSL) + cell("Emo exits", st.emotional) + '</div>' +
      '<div class="sc-flex">Only the disciplined survive F&amp;O. 🧠</div>' +
      '<div class="sc-foot">chintasmoney.com · discipline over profit</div>';
    v.appendChild(card);
    var share = el('<div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap"><button class="btn btn-primary" id="scShare">📤 Share my card</button><button class="btn" id="scChallenge">🏆 Challenge a friend</button></div>');
    share.querySelector("#scShare").addEventListener("click", function () {
      var text = "My ChintasMoney Discipline Score: " + st.discipline + "/100 — " + p.key + " · " + leagueOf(st.discipline).em + " " + leagueOf(st.discipline).n + " League. Top " + topPct + "% this week. Beat me 👉 chintasmoney.com";
      if (navigator.share) navigator.share({ title: "My Trader Report Card", text: text, url: "https://chintasmoney.com" }).catch(function () {});
      else { try { navigator.clipboard.writeText(text); this.textContent = "✓ Copied!"; toast("Card text copied — paste it anywhere 📋", "ok"); } catch (er) {} }
    });
    share.querySelector("#scChallenge").addEventListener("click", function () {
      var text = "I scored " + st.discipline + "/100 on discipline (Top " + topPct + "%). Think you're more disciplined? Prove it 👉 chintasmoney.com";
      if (navigator.share) navigator.share({ title: "Discipline challenge", text: text }).catch(function () {});
      else { try { navigator.clipboard.writeText(text); this.textContent = "✓ Copied!"; toast("Challenge copied — send it to a trader 🔥", "ok"); } catch (er) {} }
    });
    v.appendChild(share);
    v.appendChild(el('<p class="hint" style="text-align:center;margin-top:10px">Screenshot or tap Share. Post it, tag a trader, climb the league. 🔥</p>'));
    return v;
  };

  // ---- PROFILE & PLAN ------------------------------------------------------
  VIEWS.profile = function () {
    var s = CM.load();
    var v = el('<div></div>');
    v.appendChild(topbar("Profile & Plan"));
    var pc = el('<div class="card"><div class="card-hd"><h3>You</h3></div></div>');
    var h = el('<label class="fld"><span>Public handle (for your card &amp; leaderboard)</span><input placeholder="@yourname" /></label>');
    h.querySelector("input").value = s.profile.handle || "";
    h.querySelector("input").addEventListener("change", function (e) { CM.setProfile({ handle: e.target.value }); });
    pc.appendChild(el('<p>Name: <b>' + esc(s.profile.name || "—") + '</b></p>')); pc.appendChild(h);
    v.appendChild(pc);

    v.appendChild(el('<h2 style="margin:22px 0 8px;font-size:1.15rem">Subscription</h2>'));
    // 7-day Pro trial
    var trialLeft = s.profile.trialEndsAt ? Math.ceil((new Date(s.profile.trialEndsAt) - Date.now()) / 86400000) : 0;
    if (trialLeft > 0) {
      v.appendChild(el('<div class="notice" style="background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35);color:#148a3c">🎉 Pro trial active — <b>' + trialLeft + ' day(s)</b> left. Enjoy every feature.</div>'));
    } else if (s.profile.plan === "free") {
      var tb = el('<div class="card" style="border-color:var(--emerald);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>Try Pro free for 7 days</b><div class="hint">Unlock everything — no card needed in this preview.</div></div></div>');
      var tbtn = el('<button class="btn btn-primary">Start 7-day trial</button>');
      tbtn.addEventListener("click", function () { CM.setProfile({ plan: "pro", trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString() }); render(); });
      tb.appendChild(tbtn); v.appendChild(tb);
    }
    var plans = el('<div class="plans"></div>');
    Object.keys(CM.PLANS).forEach(function (id) {
      var p = CM.PLANS[id], cur = s.profile.plan === id;
      var card = el('<div class="plan' + (id === "plus" ? " feat" : "") + '">' + (id === "plus" ? '<span class="badge b-green" style="align-self:flex-start;margin-bottom:8px">Most popular</span>' : '') +
        '<h3>' + p.name + '</h3><div class="amt">' + (p.price ? "₹" + p.price : "Free") + '<span class="hint" style="font-size:.9rem;font-weight:500">' + (p.price ? "/" + p.cadence : "") + '</span></div><p class="hint">' + p.blurb + '</p>' +
        '<ul>' + p.features.slice(0, 7).map(function (f) { return '<li>' + f.replace(/-/g, " ") + '</li>'; }).join("") + '</ul></div>');
      var payMode = window.CM_CONFIG && window.CM_CONFIG.cloud && window.CM_CONFIG.razorpayKeyId && id !== "free";
      var label = cur ? "Current plan" : (payMode ? "Subscribe · ₹" + Math.round((window.CM_CONFIG.planPrices[id] || 0) / 100) : "Switch to " + p.name);
      var b = el('<button class="btn ' + (cur ? "" : "btn-primary") + '"' + (cur ? " disabled" : "") + '>' + label + '</button>');
      b.addEventListener("click", function () {
        if (cur) return;
        if (payMode) {
          // A real purchase must be tied to an account — sign in first, then check out.
          signInThen(function () { window.CMCloud.checkout(id, function () { render(); }); });
        } else { CM.setProfile({ plan: id }); render(); }
      });
      card.appendChild(b); plans.appendChild(card);
    });
    v.appendChild(plans);
    // Data backup / restore (all data lives in this browser — let people take it with them)
    var dataCard = el('<div class="card" style="margin-top:20px"><div class="card-hd"><h3>Your data</h3></div><p class="hint" style="margin:0 0 12px">Download a copy of your journal to keep, or restore one you saved earlier.</p></div>');
    var dataRow = el('<div style="display:flex;gap:10px;flex-wrap:wrap"></div>');
    var backup = el('<button class="btn btn-sm">⬇ Backup (JSON)</button>');
    backup.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(CM.load(), null, 2)], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "chintasmoney-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast("Backup downloaded ⬇", "ok");
    });
    var restore = el('<button class="btn btn-sm">⬆ Restore backup</button>');
    restore.addEventListener("click", function () {
      dialog("Restore from backup", '<p class="hint">Upload a ChintasMoney JSON backup. This <b>replaces</b> your current data in this browser.</p><input type="file" id="bkf" accept=".json,application/json" style="margin-top:10px" /><p class="hint" id="bknote" style="margin-top:8px"></p>', function (b, close) {
        b.querySelector("#bkf").addEventListener("change", function (e) {
          var f = e.target.files[0]; if (!f) return;
          var rd = new FileReader();
          rd.onload = function () {
            try {
              var obj = JSON.parse(String(rd.result));
              if (!obj || typeof obj !== "object" || !obj.profile || !Array.isArray(obj.trades)) throw new Error("bad");
              CM.hydrate(obj);
              b.querySelector("#bknote").innerHTML = '<span class="pos">Restored ' + obj.trades.length + ' trade(s).</span>';
              setTimeout(function () { close(); go("home"); render(); toast("Backup restored ✓", "ok"); }, 700);
            } catch (err) { b.querySelector("#bknote").innerHTML = '<span class="neg">That doesn\'t look like a valid ChintasMoney backup.</span>'; }
          };
          rd.readAsText(f);
        });
      });
    });
    dataRow.appendChild(backup); dataRow.appendChild(restore); dataCard.appendChild(dataRow);
    v.appendChild(dataCard);
    var reset = el('<button class="btn btn-ghost" style="margin-top:20px">↺ Reset demo data</button>'); reset.addEventListener("click", function () { if (confirm("Reset all local data?")) { CM.reset(); go("home"); render(); } });
    v.appendChild(reset);
    if (window.CMCloud && window.CMCloud.state === "authed") {
      v.appendChild(el('<div class="hint" style="margin-top:12px">Signed in as <b>' + esc((window.CMCloud.user && window.CMCloud.user.email) || "") + '</b>. Your journal is saved to your account.</div>'));
      var so = el('<button class="btn btn-ghost btn-sm" style="margin-top:6px">Sign out</button>'); so.addEventListener("click", function () { window.CMCloud.signOut(); });
      v.appendChild(so);
    } else if (window.CM_CONFIG && window.CM_CONFIG.cloud && window.CMCloud && window.CMCloud.state === "anon") {
      v.appendChild(el('<div class="hint" style="margin-top:12px">Create a free account to securely save your journal and access it across your devices.</div>'));
      var si = el('<button class="btn btn-primary btn-sm" style="margin-top:6px">Create free account</button>'); si.addEventListener("click", function () { openAuth("signup"); });
      v.appendChild(si);
    }
    v.appendChild(el('<div class="disclaimer"><b>Important:</b> ChintasMoney is a trading self-awareness &amp; journaling tool. It does <b>not</b> give buy/sell calls, tips, or investment advice, and makes no return claims. Trading in F&O is risky and most traders lose money. Your data stays on your device in this MVP.</div>'));
    return v;
  };

  // ---- Onboarding ----------------------------------------------------------
  var onb = { step: 0, name: "", handle: "" };
  function renderOnboarding() {
    root.innerHTML = "";
    var wrap = el('<div class="onb"></div>'), c = el('<div class="onb-card"></div>');
    c.appendChild(el('<div class="brand" style="padding:0 0 6px"><span class="brand-badge brand-logo-chip"><img src="assets/logo-icon.png" alt="ChintasMoney"/></span><div><b style="color:var(--ink)">ChintasMoney</b><small style="color:var(--muted)">TRADER REPORT CARD</small></div></div>'));
    if (onb.step === 0) {
      c.appendChild(el('<div style="text-align:center;margin:6px 0 -4px">' + mascot(96) + '<div style="font-weight:800;color:var(--ink)">Namaste, I\'m Chintamani 🙏</div><div class="hint">Your old, calm risk-manager.</div></div>'));
      c.appendChild(el('<h2 style="margin:12px 0 4px">Ready for the honest truth? 👀</h2>'));
      c.appendChild(el('<p class="hint">Most traders track P&L. You\'re about to track the thing that actually decides it — your discipline. What should we call you?</p>'));
      var nm = el('<label class="fld"><span>Your name</span><input placeholder="e.g. Basava" /></label>'); nm.querySelector("input").value = onb.name;
      c.appendChild(nm);
      var n = el('<button class="btn btn-primary">Continue →</button>'); n.addEventListener("click", function () { onb.name = nm.querySelector("input").value.trim(); onb.step = 1; renderOnboarding(); });
      c.appendChild(n);
    } else {
      c.appendChild(el('<h2 style="margin:12px 0 4px">Pick a handle</h2>'));
      c.appendChild(el('<p class="hint">Shown on your shareable card &amp; the discipline leaderboard. You can change it later.</p>'));
      var hd = el('<label class="fld"><span>Handle</span><input placeholder="@yourname" /></label>'); hd.querySelector("input").value = onb.handle;
      c.appendChild(hd);
      c.appendChild(el('<div class="notice">We\'ve loaded sample trades so your report card is alive from second one. Reset anytime in Profile.</div>'));
      var d = el('<button class="btn btn-primary" style="margin-top:8px">See my Report Card →</button>');
      d.addEventListener("click", function () { CM.setProfile({ name: onb.name, handle: hd.querySelector("input").value.trim(), onboarded: true }); go("today"); render(); });
      c.appendChild(d);
    }
    var dots = el('<div class="steps-dots"></div>'); [0, 1].forEach(function (i) { dots.appendChild(el('<i class="' + (i <= onb.step ? "on" : "") + '"></i>')); }); c.appendChild(dots);
    wrap.appendChild(c); root.appendChild(wrap);
  }

  // ---- PWA install prompt (custom, dismissible) ----------------------------
  var DISMISS_KEY = "chintasmoney.installDismissed.v1";
  var deferredInstall = null;
  function installDismissed() { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; } }
  function showInstallBanner() {
    if (deferredInstall == null || installDismissed() || document.querySelector(".install-banner")) return;
    var bar = el('<div class="install-banner"><span class="ib-ic"><img src="assets/logo-icon.png" alt=""/></span>' +
      '<div class="ib-txt"><b>Install ChintasMoney</b><small>Add it to your home screen — works offline, opens instantly.</small></div>' +
      '<button class="btn btn-primary btn-sm" id="ibGo">Install</button><button class="ib-x" id="ibX" aria-label="Dismiss">✕</button></div>');
    bar.querySelector("#ibGo").addEventListener("click", function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function (c) {
        if (c && c.outcome === "accepted" && typeof toast === "function") toast("Installing ChintasMoney… 🎉", "ok");
        deferredInstall = null; if (bar.parentNode) bar.parentNode.removeChild(bar);
      });
    });
    bar.querySelector("#ibX").addEventListener("click", function () {
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    document.body.appendChild(bar);
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredInstall = e; showInstallBanner(); });
  window.addEventListener("appinstalled", function () { deferredInstall = null; var bar = document.querySelector(".install-banner"); if (bar) bar.remove(); });

  // ---- Offline / online awareness ------------------------------------------
  // The service worker serves the app shell offline; reassure the user their
  // data is safe locally, and confirm when connectivity returns.
  window.addEventListener("offline", function () { if (typeof toast === "function") toast("You're offline — your data is safe on this device 📴", "err"); });
  window.addEventListener("online", function () { if (typeof toast === "function") toast("Back online ✓", "ok"); });

  // ---- Keyboard shortcuts (power users) ------------------------------------
  var SHORTCUTS = [["l", "log", "Log a trade"], ["t", "today", "Today"], ["h", "home", "Report Card"], ["c", "markets", "Charts"], ["j", "trades", "Journal"], ["a", "analytics", "Analytics"], ["k", "checklist", "Pre-Trade Check"]];
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (document.querySelector('[style*="z-index:120"]')) return; // a modal dialog is open
    var key = (e.key || "").toLowerCase();
    if (key === "?") { e.preventDefault(); showShortcuts(); return; }
    for (var i = 0; i < SHORTCUTS.length; i++) {
      if (SHORTCUTS[i][0] === key) { e.preventDefault(); go(SHORTCUTS[i][1]); return; }
    }
  });
  function showShortcuts() {
    if (typeof dialog !== "function") return;
    var rows = SHORTCUTS.concat([["?", "", "This help"]]).map(function (s) {
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)"><span>' + s[2] + '</span><kbd class="kbd">' + s[0].toUpperCase() + '</kbd></div>';
    }).join("");
    dialog("Keyboard shortcuts", '<p class="hint" style="margin:0 0 10px">Press a key anywhere (outside a text field) to jump around.</p>' + rows);
  }

  render();
})();
