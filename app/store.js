/* ChintasMoney — Trader Report Card
 * -----------------------------------------------------------------------------
 * The gap: every app shows P&L; none honestly mirror WHY traders lose — their
 * own behaviour. This scores DISCIPLINE (not tips), names a Trader Personality,
 * surfaces repeating mistakes, tracks streaks & badges, and makes a shareable
 * card. NOT financial advice. No buy/sell calls. Works with the trader's own
 * logged data — no paid market feed needed.
 *
 * Persists to localStorage in the MVP; all logic behind window.CM so a backend
 * can replace it later.
 * ---------------------------------------------------------------------------*/
(function (global) {
  "use strict";
  var KEY = "chintasmoney.trader.v1";

  // ---- Plans (admin-configurable) -------------------------------------------
  var PLANS = {
    free:  { id: "free",  name: "Free",  price: 0,   cadence: "forever",
      blurb: "Score your discipline.",
      features: ["log-trades", "discipline-score", "trader-personality", "last-30-days", "basic-mistakes"],
      limits: { history: 30, tradesPerMonth: 15 } },
    plus:  { id: "plus",  name: "Go Plus",  price: 199, cadence: "month",
      blurb: "See every leak in your trading.",
      features: ["everything-free", "unlimited-history", "full-mistake-analysis", "setup-and-time-insights", "streaks-and-badges", "ai-discipline-coach", "pro-shareable-card"],
      limits: { history: Infinity } },
    pro:   { id: "pro",   name: "Platinum",   price: 499, cadence: "month",
      blurb: "For serious, systematic traders.",
      features: ["everything-plus", "strategy-performance", "csv-import-export", "risk-and-r-multiples", "weekly-report", "goal-rules-engine"],
      limits: { history: Infinity } },
    diamond: { id: "diamond", name: "Diamond", price: 999, cadence: "month",
      blurb: "Everything, white-glove.",
      features: ["everything-pro", "priority-ai", "monthly-1-1-review", "multi-year-backtest", "early-access"],
      limits: { history: Infinity } }
  };
  var FEATURE_MATRIX = {
    home: "free", log: "free", trades: "free", card: "free", profile: "free", calc: "free", analytics: "free", markets: "free", today: "free", report: "free", dreams: "free",
    insights: "plus", coach: "plus", badges: "plus", leaderboard: "plus",
    strategy: "pro", replay: "pro"
  };
  var PLAN_RANK = { free: 0, plus: 1, pro: 2, diamond: 3 };
  function planAllows(p, area) { return PLAN_RANK[p] >= PLAN_RANK[FEATURE_MATRIX[area] || "free"]; }

  var SETUPS = ["Breakout", "Reversal", "Momentum", "Scalp", "News", "Gap", "Trend-follow", "Other"];
  var EXITS  = ["Hit target", "Hit stop-loss", "Booked early (fear)", "Held too long (greed)", "Revenge exit", "FOMO exit", "Bored/random"];
  var EMOTIONS = ["Calm", "FOMO", "Revenge", "Fear", "Greed", "Overconfident"];

  // ---- Admin config ----------------------------------------------------------
  var ADMIN_KEY = "chintasmoney.admin.v1";
  function adminConfig() {
    var def = { priceOverrides: {}, flags: { aiCoach: true, leaderboard: true, badges: true, csvImport: true } };
    try { var raw = localStorage.getItem(ADMIN_KEY); return raw ? Object.assign(def, JSON.parse(raw)) : def; } catch (e) { return def; }
  }
  function saveAdmin(c) { try { localStorage.setItem(ADMIN_KEY, JSON.stringify(c)); } catch (e) {} applyOverrides(); }
  function applyOverrides() { var c = adminConfig(); Object.keys(c.priceOverrides || {}).forEach(function (id) { if (PLANS[id]) PLANS[id].price = c.priceOverrides[id]; }); }
  applyOverrides();

  // ---- Seed sample trades ----------------------------------------------------
  function iso(daysAgo) { var d = new Date(); d.setHours(10 - (daysAgo % 5), 15, 0, 0); d.setDate(d.getDate() - daysAgo); return d.toISOString(); }
  function T(o) { return o; }
  function seed() {
    return {
      meta: { createdAt: new Date().toISOString(), seeded: true },
      profile: { name: "", onboarded: false, plan: "free", handle: "" },
      usage: { aiQuestions: 0 },
      dreams: [
        { id: "dm1", name: "Dream home", emoji: "🏡", target: 10000000, start: 200000, monthly: 25000, rate: 14, years: 12 }
      ],
      // New accounts start empty — real users log their own trades.
      trades: []
    };
  }

  var _s = null;
  function load() { if (_s) return _s; try { var r = localStorage.getItem(KEY); _s = r ? JSON.parse(r) : seed(); } catch (e) { _s = seed(); } return _s; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch (e) {} }
  function reset() { _s = seed(); save(); return _s; }
  function uid(p) { return (p || "t") + Math.random().toString(36).slice(2, 9); }

  // ---- Trade math ------------------------------------------------------------
  function pnl(t) { var dir = /sell/i.test(t.side) ? -1 : 1; return dir * (t.exit - t.entry) * t.qty; }
  function isWin(t) { return pnl(t) > 0; }
  function hasSL(t) { return t.plannedSL != null && t.plannedSL !== ""; }
  function plannedExit(t) { return /target|stop-loss/i.test(t.exit_reason); }
  function emotionalExit(t) { return /revenge|fomo|fear|greed|bored/i.test(t.exit_reason) || /revenge|fomo|fear|greed|overconfident/i.test(t.emotion); }

  // Per-trade discipline (transparent, 0-100).
  function tradeDiscipline(t) {
    var score = 100;
    if (!hasSL(t)) score -= 40;                 // trading without a stop
    if (!plannedExit(t)) score -= 25;           // didn't exit by plan
    if (emotionalExit(t)) score -= 25;          // emotional decision
    return Math.max(0, score);
  }

  // Overtrading: days with > 3 trades lose points.
  function stats() {
    var s = load(), tr = s.trades.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    if (!tr.length) return { count: 0, discipline: 0, winRate: 0, totalPnl: 0, avgWin: 0, avgLoss: 0, rr: 0, noSL: 0, emotional: 0, overtradeDays: 0, personality: personality([]), byDay: {}, trades: [] };
    var wins = tr.filter(isWin), losses = tr.filter(function (t) { return !isWin(t); });
    var avgWin = wins.length ? wins.reduce(function (a, t) { return a + pnl(t); }, 0) / wins.length : 0;
    var avgLoss = losses.length ? losses.reduce(function (a, t) { return a + pnl(t); }, 0) / losses.length : 0;
    var byDay = {}; tr.forEach(function (t) { var k = t.date.slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; });
    var overtradeDays = Object.keys(byDay).filter(function (k) { return byDay[k] > 3; }).length;
    var base = tr.reduce(function (a, t) { return a + tradeDiscipline(t); }, 0) / tr.length;
    var discipline = Math.max(0, Math.round(base - overtradeDays * 5));
    return {
      count: tr.length, discipline: discipline,
      winRate: Math.round(wins.length / tr.length * 100),
      totalPnl: tr.reduce(function (a, t) { return a + pnl(t); }, 0),
      avgWin: avgWin, avgLoss: avgLoss,
      rr: avgLoss ? Math.abs(avgWin / avgLoss) : 0,
      noSL: tr.filter(function (t) { return !hasSL(t); }).length,
      emotional: tr.filter(emotionalExit).length,
      overtradeDays: overtradeDays,
      personality: personality(tr), byDay: byDay, trades: tr
    };
  }

  // Trader personality from dominant behaviour.
  function personality(tr) {
    if (!tr.length) return { key: "Rookie", em: "🐣", line: "Log a few trades and I'll reveal your trading personality." };
    var c = { revenge: 0, fear: 0, greed: 0, fomo: 0, nosl: 0, disc: 0 };
    tr.forEach(function (t) {
      if (/revenge/i.test(t.exit_reason + t.emotion)) c.revenge++;
      if (/fear|booked early/i.test(t.exit_reason + t.emotion)) c.fear++;
      if (/greed|held too long/i.test(t.exit_reason + t.emotion)) c.greed++;
      if (/fomo/i.test(t.exit_reason + t.emotion)) c.fomo++;
      if (!hasSL(t)) c.nosl++;
      if (hasSL(t) && plannedExit(t) && !emotionalExit(t)) c.disc++;
    });
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    var map = {
      revenge: { key: "The Revenge Trader", em: "😤", line: "After a loss, you fire back fast — and it's costing you." },
      fear:    { key: "The Early Exiter", em: "🐇", line: "You cut winners too soon. Your fear closes trades your plan wanted to keep." },
      greed:   { key: "The Diamond-Hands Gambler", em: "💎", line: "You hold past your target hoping for more — and give it back." },
      fomo:    { key: "The FOMO Chaser", em: "🏃", line: "You jump in late on moves everyone's already talking about." },
      nosl:    { key: "The No-Stop Gambler", em: "🎲", line: "You trade without stops. One bad day can undo months." },
      disc:    { key: "The Disciplined Sniper", em: "🎯", line: "You wait, you plan, you follow it. Rare — protect this edge." }
    };
    if (c[top] === 0) top = "disc";
    return map[top];
  }

  // Badges (earned from own data).
  function badges() {
    var st = stats(), tr = st.trades || [], out = [];
    function add(cond, em, name, desc) { out.push({ got: !!cond, em: em, name: name, desc: desc }); }
    add(tr.length >= 1, "📓", "First Log", "Logged your first trade.");
    add(tr.length && tr.every(hasSL), "🛡️", "Stop-loss Respecter", "Every trade had a stop-loss.");
    add(st.discipline >= 80, "🏅", "Discipline 80+", "Kept your discipline score above 80.");
    add(tr.filter(function (t) { return /revenge/i.test(t.exit_reason + t.emotion); }).length === 0 && tr.length >= 5, "🧘", "No-Revenge Week", "No revenge trades in your recent history.");
    add(tr.filter(function (t) { return /target/i.test(t.exit_reason); }).length >= 5, "🎯", "Planned Exit ×5", "Exited on target 5+ times.");
    add(st.overtradeDays === 0 && tr.length >= 5, "⏳", "No Overtrading", "No days with more than 3 trades.");
    return out;
  }

  // Mistake breakdown.
  function mistakes() {
    var tr = load().trades, m = [];
    function tally(pred) { return tr.filter(pred).length; }
    m.push({ name: "Traded without a stop-loss", n: tally(function (t) { return !hasSL(t); }), tip: "A stop is not optional. Decide your exit before you enter." });
    m.push({ name: "Revenge trades after a loss", n: tally(function (t) { return /revenge/i.test(t.exit_reason + t.emotion); }), tip: "After a red trade, step away for 10 minutes before the next." });
    m.push({ name: "Cut winners early (fear)", n: tally(function (t) { return /fear|booked early/i.test(t.exit_reason + t.emotion); }), tip: "Let winners run to target. Trust the plan you set." });
    m.push({ name: "Held losers too long (greed)", n: tally(function (t) { return /greed|held too long/i.test(t.exit_reason + t.emotion); }), tip: "Your target was the plan. Book it." });
    m.push({ name: "FOMO entries", n: tally(function (t) { return /fomo/i.test(t.exit_reason + t.emotion); }), tip: "If you're chasing, you're late. Wait for your setup." });
    return m.filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
  }

  // Cumulative P&L (equity curve), oldest -> newest.
  function equityCurve() {
    var tr = load().trades.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    var cum = 0; return tr.map(function (t) { cum += pnl(t); return { cum: cum, pnl: pnl(t), date: t.date, symbol: t.symbol }; });
  }
  // Per-trade discipline over time (oldest -> newest).
  function disciplineTrend() {
    var tr = load().trades.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    return tr.map(function (t) { return tradeDiscipline(t); });
  }
  function winLoss() {
    var tr = load().trades, w = tr.filter(isWin).length; return { wins: w, losses: tr.length - w, total: tr.length };
  }
  function emotionBreakdown() {
    var by = {}; load().trades.forEach(function (t) { by[t.emotion] = (by[t.emotion] || 0) + 1; });
    return Object.keys(by).map(function (k) { return { label: k, n: by[k] }; }).sort(function (a, b) { return b.n - a.n; });
  }

  function setupPerformance() {
    var tr = load().trades, by = {};
    tr.forEach(function (t) { (by[t.setup] = by[t.setup] || { n: 0, pnl: 0, wins: 0 }); by[t.setup].n++; by[t.setup].pnl += pnl(t); if (isWin(t)) by[t.setup].wins++; });
    return Object.keys(by).map(function (k) { return { setup: k, n: by[k].n, pnl: by[k].pnl, winRate: Math.round(by[k].wins / by[k].n * 100) }; }).sort(function (a, b) { return b.pnl - a.pnl; });
  }

  // ---- Engagement: XP, levels, streak (the "keep coming back" layer) --------
  var LEVELS = [
    { t: "Street Trader", em: "🥷" }, { t: "Apprentice", em: "📗" }, { t: "Disciplined", em: "🎯" },
    { t: "Sniper", em: "🏹" }, { t: "Risk Master", em: "🛡️" }, { t: "Chintamani's Student", em: "🧘" },
    { t: "Market Monk", em: "🧙" }
  ];
  function earnedBadges() { return badges().filter(function (b) { return b.got; }).length; }
  function streakDays() {
    var days = {}; load().trades.forEach(function (t) { days[t.date.slice(0, 10)] = true; });
    var d = new Date(); d.setHours(0, 0, 0, 0); var streak = 0;
    // allow today OR yesterday to start the streak
    var key = d.toISOString().slice(0, 10);
    if (!days[key]) { d.setDate(d.getDate() - 1); key = d.toISOString().slice(0, 10); if (!days[key]) return 0; }
    while (days[d.toISOString().slice(0, 10)]) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }
  function loggedToday() { var k = new Date().toISOString().slice(0, 10); return load().trades.some(function (t) { return t.date.slice(0, 10) === k; }); }
  function engagement() {
    var st = stats();
    var xp = st.count * 25 + earnedBadges() * 75 + Math.round(st.discipline || 0) + streakDays() * 20;
    var per = 350, level = Math.min(LEVELS.length, 1 + Math.floor(xp / per));
    var inLvl = xp % per, pct = Math.round(inLvl / per * 100);
    var lv = LEVELS[level - 1];
    // next badge to chase
    var next = badges().filter(function (b) { return !b.got; })[0] || null;
    return { xp: xp, level: level, title: lv.t, em: lv.em, pct: pct, xpToNext: per - inLvl, streak: streakDays(), loggedToday: loggedToday(), nextBadge: next };
  }

  // ---- Chintamani — the wise old risk-managing mentor -----------------------
  var CHINTA_TIPS = [
    "A stop-loss is not a suggestion. Decide your exit before you enter — every single time.",
    "After a red trade, close the laptop for ten minutes. Revenge is the account-killer.",
    "Risk 1% and you can be wrong 20 times in a row and survive. Risk 10% and one bad day ends you.",
    "You don't need more trades. You need better ones. Boredom is not a setup.",
    "Book your target. Greed turns winners into losers.",
    "Position size first, prediction second. Size decides survival.",
    "The market rewards patience, not effort. Sit on your hands.",
    "Your best edge is not a strategy — it's not breaking your own rules.",
    "Green days make you brave; bear days make you scared. Your risk should ignore your mood.",
    "Journal the trade you skipped too. Discipline is also what you don't do."
  ];
  function chintaTip(seed) { return CHINTA_TIPS[(seed || Math.floor(Date.now() / 86400000)) % CHINTA_TIPS.length]; }

  // ---- Wealth / dream projection (compounding — illustrative, not a promise) -
  function project(start, monthly, ratePct, years) {
    var rm = ratePct / 100 / 12, months = Math.round(years * 12), bal = start || 0, series = [bal];
    for (var m = 1; m <= months; m++) { bal = bal * (1 + rm) + (monthly || 0); if (m % 12 === 0) series.push(bal); }
    return { fv: bal, series: series, invested: (start || 0) + (monthly || 0) * months };
  }
  function monthsToTarget(start, monthly, ratePct, target) {
    var rm = ratePct / 100 / 12, bal = start || 0, m = 0;
    while (bal < target && m < 1200) { bal = bal * (1 + rm) + (monthly || 0); m++; }
    return m >= 1200 ? null : m;
  }

  var adapters = {
    brokerImport: { isLive: false, note: "Import trades from broker/CSV (mock in MVP)." },
    notifications: { isLive: false }
  };

  global.CM = {
    PLANS: PLANS, FEATURE_MATRIX: FEATURE_MATRIX, planAllows: planAllows,
    SETUPS: SETUPS, EXITS: EXITS, EMOTIONS: EMOTIONS,
    adminConfig: adminConfig, saveAdmin: saveAdmin,
    setPlanPrice: function (id, p) { var c = adminConfig(); c.priceOverrides[id] = p; saveAdmin(c); },
    setFlag: function (k, v) { var c = adminConfig(); c.flags[k] = v; saveAdmin(c); },
    load: load, save: save, reset: reset, uid: uid, adapters: adapters,
    hydrate: function (obj) { if (obj && typeof obj === "object") { _s = obj; save(); } },
    pnl: pnl, isWin: isWin, hasSL: hasSL, tradeDiscipline: tradeDiscipline,
    stats: stats, personality: personality, badges: badges, mistakes: mistakes, setupPerformance: setupPerformance,
    equityCurve: equityCurve, disciplineTrend: disciplineTrend, winLoss: winLoss, emotionBreakdown: emotionBreakdown,
    engagement: engagement, chintaTip: chintaTip, CHINTA_TIPS: CHINTA_TIPS,
    project: project, monthsToTarget: monthsToTarget,
    dreams: function () { return load().dreams || (load().dreams = []); },
    addDream: function (d) { d.id = uid("dm"); (load().dreams = load().dreams || []).unshift(d); save(); return d; },
    deleteDream: function (id) { var s = load(); s.dreams = (s.dreams || []).filter(function (d) { return d.id !== id; }); save(); },
    setProfile: function (patch) { Object.assign(load().profile, patch); save(); },
    // Analysis tokens: each account gets FREE_TOKENS free replays ONCE (lifetime,
    // not daily); after that, only purchased tokens (profile.tokens) work.
    FREE_TOKENS: 5,
    // Plan token entitlements: Platinum/Diamond = unlimited; Go Plus = 50/month.
    _planMonthly: function (plan) { return plan === "plus" ? 50 : 0; },
    _syncPlan: function (p) {
      var plan = p.plan || "free";
      if (plan === "pro" || plan === "diamond") return { unlimited: true, monthly: 0 };
      var allow = this._planMonthly(plan);
      if (allow > 0) {
        var d = new Date(), key = d.getFullYear() + "-" + d.getMonth();
        if (p.planMonth !== key) { p.planMonth = key; p.planTokens = allow; save(); }
        return { unlimited: false, monthly: Math.max(0, p.planTokens || 0) };
      }
      return { unlimited: false, monthly: 0 };
    },
    tokenState: function () {
      var p = load().profile;
      var ps = this._syncPlan(p);
      var free = Math.max(0, this.FREE_TOKENS - (p.freeUsedTotal || 0));
      var bal = p.tokens || 0;
      if (ps.unlimited) return { unlimited: true, freeLeft: free, freeLimit: this.FREE_TOKENS, balance: bal, monthly: 0, total: Infinity, canUse: true };
      return { unlimited: false, freeLeft: free, freeLimit: this.FREE_TOKENS, balance: bal, monthly: ps.monthly, total: free + ps.monthly + bal, canUse: (free + ps.monthly + bal) > 0 };
    },
    useToken: function () {
      var p = load().profile;
      var ps = this._syncPlan(p);
      if (ps.unlimited) return true; // Platinum/Diamond — never decrement
      var free = Math.max(0, this.FREE_TOKENS - (p.freeUsedTotal || 0));
      if (free > 0) { p.freeUsedTotal = (p.freeUsedTotal || 0) + 1; save(); return true; }
      if ((p.planTokens || 0) > 0) { p.planTokens = p.planTokens - 1; save(); return true; }
      if ((p.tokens || 0) > 0) { p.tokens = p.tokens - 1; save(); return true; }
      return false;
    },
    addTokens: function (n) { var p = load().profile; p.tokens = (p.tokens || 0) + (+n || 0); save(); return p.tokens; },
    // Free-plan monthly logging quota (paid plans are unlimited).
    quota: function () {
      var s = load(), plan = PLANS[s.profile.plan] || PLANS.free;
      var limit = (plan.limits && plan.limits.tradesPerMonth) || Infinity;
      var now = new Date(), m = now.getMonth(), y = now.getFullYear();
      var used = s.trades.filter(function (t) {
        var d = new Date(t.date);
        return !/^s\d+$/.test(t.id || "") && d.getMonth() === m && d.getFullYear() === y;
      }).length;
      return { plan: s.profile.plan, used: used, limit: limit,
        remaining: limit === Infinity ? Infinity : Math.max(0, limit - used),
        allowed: limit === Infinity || used < limit };
    },
    addTrade: function (t) { t.id = uid("t"); load().trades.unshift(t); save(); return t; },
    deleteTrade: function (id) { var s = load(); s.trades = s.trades.filter(function (t) { return t.id !== id; }); save(); },
    updateTrade: function (id, patch) { var s = load(), t = null; for (var i = 0; i < s.trades.length; i++) { if (s.trades[i].id === id) { t = s.trades[i]; break; } } if (t) { Object.assign(t, patch); save(); } return t; }
  };
})(window);
