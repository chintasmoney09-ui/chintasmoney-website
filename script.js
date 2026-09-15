// ChintasMoney landing — interactions & motion
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // year
  var y = $("#year"); if (y) y.textContent = new Date().getFullYear();

  // mobile nav drawer
  var tgl = $("#navToggle"), links = $("#navLinks"),
      closeBtn = $("#navClose"), backdrop = $("#navBackdrop");
  if (backdrop) backdrop.removeAttribute("hidden");
  function openNav() {
    links.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
    if (tgl) { tgl.classList.add("open"); tgl.setAttribute("aria-expanded", "true"); }
    document.body.style.overflow = "hidden";
  }
  function closeNav() {
    links.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
    if (tgl) { tgl.classList.remove("open"); tgl.setAttribute("aria-expanded", "false"); }
    document.body.style.overflow = "";
  }
  if (tgl && links) {
    tgl.addEventListener("click", function () {
      links.classList.contains("open") ? closeNav() : openNav();
    });
    links.addEventListener("click", function (e) { if (e.target.tagName === "A") closeNav(); });
    if (closeBtn) closeBtn.addEventListener("click", closeNav);
    if (backdrop) backdrop.addEventListener("click", closeNav);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeNav(); });
  }

  // Live market ticker — real quotes from our own /api/quotes endpoint
  var tk = $("#ticker"), tkWrap = $("#tickerWrap");
  function renderTicker(quotes) {
    if (!tk || !quotes || !quotes.length) return;
    var row = quotes.map(function (s) {
      var up = Number(s.change) >= 0, sign = up ? "+" : "";
      return '<span class="t"><b>' + s.name + '</b> ' + s.price +
        ' <span class="' + (up ? "up" : "down") + '">' + sign + s.changePct + '%</span></span>';
    }).join("");
    tk.innerHTML = row + row; // duplicate for seamless -50% scroll loop
    if (tkWrap) tkWrap.hidden = false;
  }
  // Shared: charts block sets this so snapshot cards can load a symbol
  var loadMarketChart = null;
  var QUOTE_TV = { "NIFTY 50": "NSE:NIFTYBEES", "BANK NIFTY": "NSE:BANKBEES", "RELIANCE": "NSE:RELIANCE", "TCS": "NSE:TCS", "HDFC BANK": "NSE:HDFCBANK", "INFY": "NSE:INFY", "TATA MOTORS": "NSE:TATAMOTORS" };
  var quoteGrid = $("#quoteGrid"), snapSection = $("#snapshot");
  function renderSnapshot(quotes) {
    if (!quoteGrid || !quotes || !quotes.length) return;
    quoteGrid.innerHTML = quotes.map(function (s) {
      var up = Number(s.change) >= 0, sign = up ? "+" : "", sym = QUOTE_TV[s.name] || "";
      return '<button class="quote-card" data-sym="' + sym + '"><div class="q-name">' + s.name + '</div>' +
        '<div class="q-price">' + s.price + '</div>' +
        '<div class="q-chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") + " " + sign + s.changePct + '%</div></button>';
    }).join("");
    quoteGrid.querySelectorAll(".quote-card").forEach(function (b) {
      b.addEventListener("click", function () {
        var sym = b.dataset.sym; if (!sym) return;
        if (loadMarketChart) loadMarketChart(sym);
        var t = document.getElementById("charts"); if (t) t.scrollIntoView({ behavior: "smooth" });
      });
    });
    if (snapSection) snapSection.hidden = false;
  }
  if (tk || quoteGrid) {
    fetch("/api/quotes", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.quotes) { renderTicker(d.quotes); renderSnapshot(d.quotes); } })
      .catch(function () { /* leave strips hidden if quotes are unavailable */ });
  }
  window.__cmSetChartLoader = function (fn) { loadMarketChart = fn; };

  // ---- Top movers (live from /api/movers) ----
  var MOVER_TV = { "RELIANCE": "NSE:RELIANCE", "TCS": "NSE:TCS", "HDFC BANK": "NSE:HDFCBANK", "INFOSYS": "NSE:INFY", "ICICI BANK": "NSE:ICICIBANK", "SBI": "NSE:SBIN", "AXIS BANK": "NSE:AXISBANK", "KOTAK": "NSE:KOTAKBANK", "ITC": "NSE:ITC", "L&T": "NSE:LT", "AIRTEL": "NSE:BHARTIARTL", "HUL": "NSE:HINDUNILVR", "MARUTI": "NSE:MARUTI", "SUN PHARMA": "NSE:SUNPHARMA", "TATA MOTORS": "NSE:TATAMOTORS", "TATA STEEL": "NSE:TATASTEEL", "ADANI ENT": "NSE:ADANIENT", "BAJAJ FIN": "NSE:BAJFINANCE", "WIPRO": "NSE:WIPRO", "ZOMATO": "NSE:ZOMATO" };
  var moversSection = $("#movers"), gainersList = $("#gainersList"), losersList = $("#losersList");
  function moverRow(s) {
    var pct = Number(s.changePct), up = pct >= 0, sign = up ? "+" : "", sym = MOVER_TV[s.name] || "";
    return '<button class="mv-row" data-sym="' + sym + '"><span class="mv-name">' + s.name + '</span>' +
      '<span class="mv-px mono">' + s.price + '</span>' +
      '<span class="mv-pct mono ' + (up ? "up" : "down") + '">' + sign + pct.toFixed(2) + '%</span></button>';
  }
  function wireMoverClicks(container) {
    container.querySelectorAll(".mv-row").forEach(function (b) {
      b.addEventListener("click", function () {
        var sym = b.dataset.sym; if (!sym) return;
        if (loadMarketChart) loadMarketChart(sym);
        var t = document.getElementById("charts"); if (t) t.scrollIntoView({ behavior: "smooth" });
      });
    });
  }
  if (gainersList && losersList) {
    fetch("/api/movers", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.gainers || !d.gainers.length) return;
        gainersList.innerHTML = d.gainers.map(moverRow).join("");
        losersList.innerHTML = (d.losers || []).map(moverRow).join("");
        wireMoverClicks(gainersList); wireMoverClicks(losersList);
        if (moversSection) moversSection.hidden = false;
      })
      .catch(function () { /* keep hidden if unavailable */ });
  }

  // candles (random up/down bars)
  var cw = $("#candles");
  if (cw) {
    var html = "";
    for (var i = 0; i < 22; i++) {
      var up = Math.random() > 0.42;
      var h = 24 + Math.round(Math.random() * 52);
      html += '<span class="candle ' + (up ? "g" : "r") + '" style="height:' + h + '%;animation-delay:' + (i * 0.04) + 's"></span>';
    }
    cw.innerHTML = html;
  }

  // count-up numbers when visible
  function countUp(elm) {
    var target = parseFloat(elm.getAttribute("data-count")) || 0;
    var suffix = elm.getAttribute("data-suffix") || "";
    var dur = 1100, start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / dur);
      var val = Math.round((1 - Math.pow(1 - p, 3)) * target);
      elm.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // gauge draw to 42
  function drawGauge() {
    var arc = $("#gaugeArc"), num = $("#gaugeNum");
    if (!arc) return;
    var C = 389.5, score = 42, dur = 1300, start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
      arc.setAttribute("stroke-dashoffset", C * (1 - (score / 100) * e));
      if (num) num.textContent = Math.round(score * e);
      // colour shifts with value
      arc.setAttribute("stroke", score < 50 ? "#f5b849" : "#22e08a");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // reveal on scroll + trigger counters/gauge
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add("in");
      en.target.querySelectorAll && en.target.querySelectorAll("[data-count]").forEach(countUp);
      if (en.target.querySelector && en.target.querySelector("#gaugeArc")) drawGauge();
      io.unobserve(en.target);
    });
  }, { threshold: 0.2 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  // if hero already in view on load, kick gauge
  setTimeout(drawGauge, 400);

  // ---- Risk & position-size calculator ----
  var side = "long";
  function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function num(id) { var v = parseFloat(($(id) || {}).value); return isNaN(v) ? 0 : v; }
  function calc() {
    if (!$("#calcForm")) return;
    var cap = num("#cCapital"), riskPct = num("#cRisk"), entry = num("#cEntry"),
        stop = num("#cStop"), target = num("#cTarget"), lot = Math.max(1, num("#cLot") || 1);
    var riskAmt = cap * riskPct / 100;
    var perUnit = Math.abs(entry - stop);
    var units = perUnit > 0 ? Math.floor(riskAmt / perUnit / lot) * lot : 0;
    var value = units * entry;
    // validity of stop relative to side
    var stopValid = side === "long" ? stop < entry : stop > entry;
    var rr = 0, reward = 0, rewardPct = 0, targetValid = true;
    if (target > 0) {
      var rewUnit = side === "long" ? (target - entry) : (entry - target);
      targetValid = rewUnit > 0;
      reward = units * Math.max(0, rewUnit);
      rr = perUnit > 0 ? Math.max(0, rewUnit) / perUnit : 0;
      rewardPct = value > 0 ? reward / value * 100 : 0;
    }
    $("#oRisk").textContent = inr(riskAmt);
    $("#oQty").textContent = units.toLocaleString("en-IN") + (lot > 1 ? " (" + (units / lot) + " lots)" : " units");
    $("#oValue").textContent = inr(value);
    $("#oRR").textContent = rr ? "1 : " + rr.toFixed(2) : "—";
    $("#oReward").textContent = reward ? inr(reward) : "—";
    $("#oRewardPct").textContent = rewardPct ? "+" + rewardPct.toFixed(1) + "%" : "—";

    var v = $("#cVerdict"), note = $("#cNote");
    if (!stopValid) {
      v.innerHTML = '<span class="warn">⚠ CHECK YOUR STOP</span>';
      note.textContent = side === "long" ? "For a long, your stop-loss should be BELOW your entry." : "For a short, your stop-loss should be ABOVE your entry.";
    } else if (target > 0 && !targetValid) {
      v.innerHTML = '<span class="warn">⚠ CHECK YOUR TARGET</span>';
      note.textContent = side === "long" ? "For a long, your target should be ABOVE your entry." : "For a short, your target should be BELOW your entry.";
    } else if (rr && rr >= 2) {
      v.innerHTML = side === "long" ? '<span class="bull">▲ STRONG SETUP · R:R ' + rr.toFixed(1) + '</span>' : '<span class="bear">▼ STRONG SHORT · R:R ' + rr.toFixed(1) + '</span>';
      note.textContent = "A 1:2 or better risk:reward keeps you profitable even at a 40% win rate. Disciplined.";
    } else if (rr && rr < 1) {
      v.innerHTML = '<span class="warn">⚠ POOR RISK : REWARD</span>';
      note.textContent = "You're risking more than you stand to make. Most disciplined traders skip these.";
    } else {
      v.innerHTML = side === "long" ? '<span class="bull">▲ LONG SETUP</span>' : '<span class="bear">▼ SHORT SETUP</span>';
      note.textContent = "You risk " + inr(riskAmt) + " to make " + (reward ? inr(reward) : "your target") + ". Size fixed before you click.";
    }
  }
  var cf = $("#calcForm");
  if (cf) {
    cf.addEventListener("input", calc);
    $("#segLong").addEventListener("click", function () { side = "long"; this.classList.add("active"); this.classList.remove("bear"); $("#segShort").classList.remove("active", "bear"); calc(); });
    $("#segShort").addEventListener("click", function () { side = "short"; this.classList.add("active", "bear"); $("#segLong").classList.remove("active"); calc(); });
    calc();
  }

  // ---- Cost of indiscipline (interactive) ----
  var ccLoss = $("#ccLoss"), ccCount = $("#ccCount");
  function ccInr(n){ return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function ccUpdate(){
    if (!ccLoss || !ccCount) return;
    var loss = parseFloat(ccLoss.value) || 0, cnt = parseFloat(ccCount.value) || 0;
    var week = loss * cnt, month = week * 4.33, year = week * 52;
    var lv = $("#ccLossV"), cv = $("#ccCountV");
    if (lv) lv.textContent = ccInr(loss);
    if (cv) cv.textContent = cnt;
    var w = $("#ccWeek"), m = $("#ccMonth"), y = $("#ccYear");
    if (w) w.textContent = ccInr(week);
    if (m) m.textContent = ccInr(month);
    if (y) y.textContent = ccInr(year);
  }
  if (ccLoss && ccCount){
    ccLoss.addEventListener("input", ccUpdate);
    ccCount.addEventListener("input", ccUpdate);
    ccUpdate();
  }

  // ---- Free live-market chart (TradingView iframe) ----
  var MKT_GROUPS = [
    ["Indian Indices", [["NIFTY 50", "NSE:NIFTYBEES"], ["BANK NIFTY", "NSE:BANKBEES"], ["SENSEX", "BSE:SENSEX"]]],
    ["NSE Stocks", [["RELIANCE", "NSE:RELIANCE"], ["TCS", "NSE:TCS"], ["HDFC BANK", "NSE:HDFCBANK"], ["INFOSYS", "NSE:INFY"], ["ICICI BANK", "NSE:ICICIBANK"], ["SBI", "NSE:SBIN"], ["TATA MOTORS", "NSE:TATAMOTORS"], ["ADANI ENT", "NSE:ADANIENT"]]],
    ["Commodities", [["Gold · XAU/USD", "OANDA:XAUUSD"], ["Silver · XAG/USD", "OANDA:XAGUSD"], ["Crude Oil · WTI", "TVC:USOIL"], ["Brent Oil", "TVC:UKOIL"], ["Natural Gas", "NYMEX:NG1!"]]],
    ["Crypto", [["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"], ["Solana", "BINANCE:SOLUSDT"], ["Dogecoin", "BINANCE:DOGEUSDT"]]],
    ["Global Indices", [["S&P 500", "TVC:SPX"], ["Nasdaq 100", "TVC:NDX"], ["Dow Jones", "TVC:DJI"]]],
    ["Forex", [["USD/INR", "FX_IDC:USDINR"], ["EUR/USD", "OANDA:EURUSD"], ["GBP/USD", "OANDA:GBPUSD"]]]
  ];
  var MKT_QUICK = [["NIFTY 50", "NSE:NIFTYBEES"], ["BANK NIFTY", "NSE:BANKBEES"], ["Gold", "OANDA:XAUUSD"], ["Bitcoin", "BINANCE:BTCUSDT"], ["Crude Oil", "TVC:USOIL"], ["S&P 500", "TVC:SPX"]];
  var mktSel = $("#mktSelect"), mktBox = $("#mktChartBox"), mktChips = $("#chartChips"), mktFull = $("#mktFull");
  if (mktSel && mktBox) {
    var mktCur = "NSE:NIFTYBEES";
    mktSel.innerHTML = MKT_GROUPS.map(function (g) {
      return '<optgroup label="' + g[0] + '">' + g[1].map(function (o) {
        return '<option value="' + o[1] + '"' + (o[1] === mktCur ? " selected" : "") + '>' + o[0] + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
    if (mktChips) mktChips.innerHTML = MKT_QUICK.map(function (o) {
      return '<button class="chart-chip' + (o[1] === mktCur ? " on" : "") + '" data-sym="' + o[1] + '">' + o[0] + '</button>';
    }).join("");
    function mountMkt(sym) {
      mktCur = sym;
      var params = ["symbol=" + encodeURIComponent(sym), "interval=D", "theme=dark", "style=1", "timezone=Asia/Kolkata", "locale=in", "withdateranges=1", "hideideas=1", "symboledit=0", "saveimage=0", "hidesidetoolbar=0"].join("&");
      mktBox.innerHTML = '<iframe src="https://s.tradingview.com/widgetembed/?' + params + '" frameborder="0" allowtransparency="true" scrolling="no" allowfullscreen style="width:100%;height:100%;border:0;display:block"></iframe>';
      if (mktChips) mktChips.querySelectorAll(".chart-chip").forEach(function (b) { b.classList.toggle("on", b.dataset.sym === sym); });
      if (mktSel.value !== sym) mktSel.value = sym;
    }
    mktSel.addEventListener("change", function () { mountMkt(this.value); });
    if (mktChips) mktChips.addEventListener("click", function (e) { var b = e.target.closest(".chart-chip"); if (b) mountMkt(b.dataset.sym); });
    if (mktFull) mktFull.addEventListener("click", function () { if (mktBox.requestFullscreen) mktBox.requestFullscreen(); else if (mktBox.webkitRequestFullscreen) mktBox.webkitRequestFullscreen(); });
    mountMkt(mktCur);
    if (window.__cmSetChartLoader) window.__cmSetChartLoader(mountMkt);
  }
})();

/* Intro logo splash (once per session) + scroll-shrink header logo */
(function () {
  // Smoothly shrink the big centered logo as the page scrolls.
  var hdr = document.querySelector(".hdr");
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle("scrolled", (window.scrollY || window.pageYOffset) > 40); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  // One-time entry splash: the logo eases in, then reveals the site.
  try {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && !sessionStorage.getItem("cm.introSeen")) {
      var ov = document.createElement("div");
      ov.className = "intro";
      ov.innerHTML = '<div class="intro-inner"><img src="assets/logo-tile.png" alt="ChintasMoney" /><div class="intro-name">Chinta\'s <span>🤑</span> <b>Money</b></div></div>';
      document.body.appendChild(ov);
      document.body.style.overflow = "hidden";
      requestAnimationFrame(function () { ov.classList.add("run"); });
      var done = function () { ov.classList.add("out"); document.body.style.overflow = ""; setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 550); };
      setTimeout(done, 1500);
      ov.addEventListener("click", done);
      sessionStorage.setItem("cm.introSeen", "1");
    }
  } catch (e) {}
})();

/* On mobile, sections moved off the home are reached via the app / pricing
   page — repoint any in-page anchors that now point to hidden sections. */
(function () {
  try {
    if (!window.matchMedia || !window.matchMedia("(max-width:640px)").matches) return;
    var map = {
      "#calc": "app/index.html#/calc",
      "#charts": "app/index.html#/markets",
      "#league": "app/index.html#/leaderboard",
      "#pricing": "pricing.html",
      "#faq": "pricing.html#faq"
    };
    document.querySelectorAll("a[href]").forEach(function (a) {
      var h = a.getAttribute("href");
      if (map[h]) a.setAttribute("href", map[h]);
    });
  } catch (e) {}
})();

/* How-it-works video: lazy YouTube facade. Paste a video ID into
   #ytFacade[data-yt] and it loads on click (no ID yet -> opens the app). */
(function () {
  var f = document.getElementById("ytFacade");
  if (!f) return;
  function play() {
    var id = (f.getAttribute("data-yt") || "").trim();
    if (!id) { window.location.href = "app/index.html"; return; }
    var ifr = document.createElement("iframe");
    ifr.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
    ifr.setAttribute("title", "ChintasMoney walkthrough");
    ifr.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    ifr.setAttribute("allowfullscreen", "");
    f.innerHTML = "";
    f.appendChild(ifr);
    f.style.cursor = "default";
  }
  f.addEventListener("click", play);
  f.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });
})();
