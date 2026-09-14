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

  // ticker (mock symbols; duplicated for seamless loop)
  var syms = [
    ["NIFTY", "24,812", "+0.62%", 1], ["BANKNIFTY", "51,240", "-0.34%", 0], ["RELIANCE", "2,984", "+1.10%", 1],
    ["TCS", "3,910", "+0.20%", 1], ["HDFCBANK", "1,502", "-0.48%", 0], ["INFY", "1,648", "+0.72%", 1],
    ["TATAMOTORS", "985", "+2.05%", 1], ["ZOMATO", "168", "-1.30%", 0], ["ADANIENT", "2,988", "+0.90%", 1],
    ["SBIN", "832", "-0.22%", 0]
  ];
  var tk = $("#ticker");
  if (tk) {
    var row = syms.map(function (s) {
      return '<span class="t"><b>' + s[0] + '</b> ' + s[1] + ' <span class="' + (s[3] ? "up" : "down") + '">' + s[2] + '</span></span>';
    }).join("");
    tk.innerHTML = row + row; // duplicate for -50% scroll loop
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
})();
