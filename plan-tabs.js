/* ChintasMoney — logged-out Plan Tabs.
 * Mirrors the in-app Profile & Plans tabbed view EXACTLY: a one-line tab bar
 * (Free / Go Plus / Platinum / Diamond) and a detail card with the blurb,
 * benefit copy, Trades/Tokens/Daily tiles and every service WITH a one-line
 * description. Mounts into <div id="planTabs"></div>. CTA goes to the app. */
(function () {
  "use strict";
  var mount = document.getElementById("planTabs");
  if (!mount) return;

  var PLANS = {
    free:    { name: "Free",     price: 0,   cadence: "forever", blurb: "Score your discipline.",
      features: ["log-trades-5", "discipline-score", "trader-personality", "last-30-days", "basic-mistakes", "free-calculators"] },
    plus:    { name: "Go Plus",  price: 199, cadence: "month",   blurb: "Journal more, see your leaks.",
      features: ["everything-free", "tokens-600", "unlimited-history", "full-mistake-analysis", "money-leak-report", "streaks-and-badges", "pro-shareable-card"] },
    pro:     { name: "Platinum", price: 499, cadence: "month",   blurb: "For serious, systematic traders.",
      features: ["everything-plus", "tokens-1200", "time-day-edge", "strategy-performance", "trade-grades", "edge-expectancy", "rules-adherence", "trade-replay", "csv-import-export", "weekly-report", "monthly-deep-dive"] },
    diamond: { name: "Diamond",  price: 999, cadence: "month",   blurb: "Everything + AI, white-glove.",
      features: ["everything-pro", "tokens-3000", "ai-discipline-coach", "what-if-simulator", "trading-playbook", "priority-ai", "monthly-1-1-review", "multi-year-backtest", "early-access"] }
  };
  var SPEC = {
    free: { trades: "5", tokens: "150" }, plus: { trades: "20", tokens: "600" },
    pro: { trades: "40", tokens: "1200" }, diamond: { trades: "100", tokens: "3000" }
  };
  var BADGEF = { plus: "plus", pro: "platinum", diamond: "diamond" };
  var PLAN_SELL = {
    free: "See the truth about how you trade — free. 150 tokens/month (5 logs) + a free daily bonus, your Discipline Score, personality and basic mistakes.",
    plus: "Where most traders finally improve. 600 tokens/month, unlimited history, full mistake analysis and the 💸 Money Leak Report — the exact ₹ your habits cost you.",
    pro: "1200 tokens/month, setup performance, trade grades A–F, edge & expectancy, Trade Replay, broker import and weekly + monthly deep-dives.",
    diamond: "The complete edge + AI. 3000 tokens/month plus the AI Discipline Coach, What-If simulator, Personal Playbook, priority AI, a monthly 1:1 and multi-year backtesting."
  };
  var PLAN_WORTH = {
    plus: "Worth it if one avoided revenge-trade saves you more than ₹199.",
    pro: "Worth it if a sharper edge saves you one bad trade a month.",
    diamond: "The only plan with the AI coach — worth it if it keeps you disciplined."
  };
  var FEATURE_LABELS = {
    "log-trades-5": "Log 5 trades / month (150 tokens)", "discipline-score": "Discipline Score", "trader-personality": "Trader Personality",
    "last-30-days": "Last 30 days of history", "basic-mistakes": "Basic mistake spotting", "free-calculators": "Free risk & position calculators",
    "tokens-600": "600 tokens / month (~20 trade logs)", "tokens-1200": "1200 tokens / month (~40 trade logs)", "tokens-3000": "3000 tokens / month (~100 trade logs)",
    "everything-free": "Everything in Free", "everything-plus": "Everything in Go Plus", "everything-pro": "Everything in Platinum",
    "unlimited-history": "Unlimited trade history", "full-mistake-analysis": "Full mistake analysis", "money-leak-report": "💸 Money Leak Report (₹ cost of habits)",
    "streaks-and-badges": "Streaks & badges", "pro-shareable-card": "Pro shareable card", "time-day-edge": "Time & Day Edge",
    "strategy-performance": "Setup performance analytics", "trade-grades": "🎓 Trade Grades (A–F per trade)", "edge-expectancy": "📐 Edge & Expectancy analytics",
    "rules-adherence": "📏 Rules & Adherence tracker", "trade-replay": "🎬 Trade Replay on real charts", "csv-import-export": "CSV / broker import & export",
    "weekly-report": "Weekly report", "monthly-deep-dive": "📅 Monthly deep-dive report", "ai-discipline-coach": "AI Discipline Coach",
    "what-if-simulator": "🔮 What-If Simulator", "trading-playbook": "📖 Personal Trading Playbook", "priority-ai": "Priority AI coach",
    "monthly-1-1-review": "Monthly 1:1 discipline review", "multi-year-backtest": "Multi-year backtesting", "early-access": "Early access to new tools"
  };
  var FEATURE_DESC = {
    "log-trades-5": "Journal up to 5 trades a month (150 tokens).",
    "discipline-score": "A 0–100 score of how disciplined each trade was.",
    "trader-personality": "Your dominant trading behaviour, named.",
    "last-30-days": "See your last 30 days of history.",
    "basic-mistakes": "Spot your top repeating mistakes.",
    "free-calculators": "Risk, position-size & R:R calculators — always free.",
    "tokens-600": "600 tokens every month (~20 trade logs).",
    "tokens-1200": "1200 tokens every month (~40 trade logs).",
    "tokens-3000": "3000 tokens every month (~100 trade logs).",
    "everything-free": "Everything in the Free plan.",
    "everything-plus": "Everything in Go Plus.",
    "everything-pro": "Everything in Platinum.",
    "unlimited-history": "Keep & analyse your entire trade history.",
    "full-mistake-analysis": "Deep breakdown of every leak, ranked by ₹ cost.",
    "money-leak-report": "The exact rupees your habits cost you.",
    "streaks-and-badges": "Build streaks and earn discipline badges.",
    "pro-shareable-card": "A polished card to share your stats.",
    "time-day-edge": "Which days & times you trade best.",
    "strategy-performance": "Win-rate & P&L broken down by setup.",
    "trade-grades": "An A–F grade on every single trade.",
    "edge-expectancy": "Your true edge & expectancy per trade.",
    "rules-adherence": "Track how well you follow your own rules.",
    "trade-replay": "Replay a trade on the real market chart (30 tokens).",
    "csv-import-export": "Import from your broker, export anytime.",
    "weekly-report": "A weekly discipline email.",
    "monthly-deep-dive": "A branded monthly deep-dive report (50 tokens).",
    "ai-discipline-coach": "An AI that coaches YOUR behaviour (30 tokens/question).",
    "what-if-simulator": "See the ₹ your habits cost — simulated (30 tokens).",
    "trading-playbook": "Your personal, data-built trading playbook.",
    "priority-ai": "Faster, priority AI responses.",
    "monthly-1-1-review": "A monthly 1:1 discipline review.",
    "multi-year-backtest": "Backtest your discipline over years of data.",
    "early-access": "First access to new tools."
  };
  var DAILY_BONUS = 30;
  var order = ["free", "plus", "pro", "diamond"];
  var active = "pro"; // default-highlight the most popular plan
  var tabEls = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function styleTab(id) {
    var t = tabEls[id], on = id === active;
    t.style.cssText = "flex:1 0 auto;min-width:80px;cursor:pointer;border-radius:12px;padding:9px 10px;text-align:center;font-weight:800;font-size:.85rem;border:1.5px solid " + (on ? "var(--green)" : "var(--line)") + ";background:" + (on ? "rgba(34,224,138,.12)" : "var(--panel)") + ";color:var(--ink)";
    t.innerHTML = esc(PLANS[id].name) + '<div style="font-size:.72rem;font-weight:700;color:var(--muted)">' + (PLANS[id].price ? "₹" + PLANS[id].price : "Free") + '</div>';
  }

  function renderDetail(id) {
    var p = PLANS[id], bf = BADGEF[id], sp = SPEC[id];
    var accent = id === "pro" ? "var(--violet)" : "var(--line)";
    var cta = id === "free" ? "Start free" : (id === "pro" ? "Start 3-day trial" : "Choose " + p.name);
    detail.innerHTML =
      '<div style="box-sizing:border-box;border:1.5px solid ' + accent + ';border-radius:16px;padding:18px;background:var(--panel);display:flex;flex-direction:column">' +
        (id === "pro" ? '<span class="badge" style="align-self:flex-start;margin-bottom:8px">Most popular · 3-day trial</span>' : '') +
        '<div style="display:flex;align-items:center;gap:12px">' +
        (bf ? '<img src="/assets/badge-' + bf + '.png" alt="" width="46" height="46" loading="lazy" decoding="async" style="width:46px;height:46px"/>' : '<div style="font-size:2rem">🆓</div>') +
        '<div><div style="font-weight:800;font-size:1.3rem;color:var(--ink)">' + esc(p.name) + '</div><div style="font-size:.85rem;color:var(--muted)">' + esc(p.blurb) + '</div></div></div>' +
        '<div style="margin:12px 0 2px"><span style="font-size:2rem;font-weight:800;color:var(--ink)">' + (p.price ? "₹" + p.price : "Free") + '</span><span style="color:var(--muted)"> ' + (p.price ? "/ " + p.cadence : "forever") + '</span></div>' +
        (p.price ? '<div style="color:var(--green);font-size:.82rem;font-weight:700;margin:0 0 6px">or ₹' + (p.price * 10) + '/yr — 2 months free</div>' : '') +
        '<p style="font-size:.86rem;color:var(--ink-soft);margin:0 0 12px;line-height:1.55">' + esc(PLAN_SELL[id]) + '</p>' +
        '<div style="display:flex;gap:8px;margin:0 0 14px">' +
          tile("📝 Trades / mo", sp.trades) + tile("🎟️ Tokens / mo", sp.tokens) + tile("🎁 Daily", "+" + DAILY_BONUS) +
        '</div>' +
        '<div style="font-weight:800;font-size:.9rem;margin:0 0 8px">Everything included</div>' +
        '<ul style="list-style:none;padding:0;margin:0 0 14px;display:grid;gap:10px">' +
          p.features.map(function (f) {
            var d = FEATURE_DESC[f];
            return '<li style="display:flex;gap:9px"><span style="color:var(--green);font-weight:800;flex:0 0 auto">✓</span><span><b style="font-size:.86rem;color:var(--ink)">' + esc(FEATURE_LABELS[f] || f) + '</b>' + (d ? '<div style="font-size:.78rem;color:var(--muted);margin-top:1px">' + esc(d) + '</div>' : '') + '</span></li>';
          }).join("") +
        '</ul>' +
        (PLAN_WORTH[id] ? '<p style="font-size:.76rem;margin:0 0 10px;color:var(--green)">💡 ' + esc(PLAN_WORTH[id]) + '</p>' : '') +
        '<a href="app/" class="btn ' + (id === "pro" ? "btn-primary" : "btn-ghost") + '" style="width:100%;text-align:center">' + cta + ' →</a>' +
      '</div>';
  }
  function tile(label, val) {
    return '<div style="flex:1;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center"><div style="font-size:.66rem;color:var(--muted)">' + label + '</div><div style="font-weight:800;font-size:.92rem;color:var(--ink)">' + val + '</div></div>';
  }

  var wrap = document.createElement("div");
  wrap.style.cssText = "max-width:520px;margin:0 auto";
  var tabBar = document.createElement("div");
  tabBar.style.cssText = "display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px;margin:0 0 14px";
  var detail = document.createElement("div");
  order.forEach(function (id) {
    var t = document.createElement("button");
    tabEls[id] = t;
    t.addEventListener("click", function () { active = id; order.forEach(styleTab); renderDetail(id); });
    tabBar.appendChild(t); styleTab(id);
  });
  wrap.appendChild(tabBar); wrap.appendChild(detail);
  mount.appendChild(wrap);
  renderDetail(active);
})();
