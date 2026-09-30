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
  var LIVE = { state: "idle", users: null, invoices: null, refunds: null, leads: null, pushCount: 0, error: "" };
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
        LIVE.users = d.users || []; LIVE.invoices = d.invoices || []; LIVE.refunds = d.refunds || []; LIVE.leads = d.leads || []; LIVE.pushCount = d.pushCount || 0;
        LIVE.state = "live"; _lastSig = dataSig(d); _lastPaid = paidStats(d); adminAskNotify(); startPoll(); render();
      })
      .catch(function () { LIVE.state = "demo"; LIVE.error = "Network error — showing demo data."; render(); });
  }
  function liveOn() { return LIVE.state === "live"; }

  // Auto-refresh: quietly re-pull live data and re-render only when something
  // actually changed (new user, new payment, new refund) — so the owner never
  // has to tap Refresh or check constantly.
  var _lastSig = "", _pollTimer = null, _lastPaid = null;
  function paidStats(d) {
    var paid = (d.invoices || []).filter(function (i) { return i.status === "paid"; });
    return { count: paid.length, gross: paid.reduce(function (a, i) { return a + (i.amount || 0); }, 0) };
  }
  function dataSig(d) {
    var inv = d.invoices || [], u = d.users || [], rf = d.refunds || [], ld = d.leads || [];
    var gross = inv.reduce(function (a, i) { return a + (i.amount || 0); }, 0);
    return u.length + "|" + inv.length + "|" + rf.length + "|" + gross + "|" + ld.length;
  }
  function pollLive() {
    if (token() === "1" || !isAuthed()) return;
    fetch("/api/admin/data", { headers: { Authorization: "Bearer " + token() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var sig = dataSig(d);
        var ps = paidStats(d);
        if (_lastPaid && (ps.count > _lastPaid.count || ps.gross > _lastPaid.gross)) {
          adminPaymentAlert(ps.count - _lastPaid.count, ps.gross - _lastPaid.gross);
        }
        _lastPaid = ps;
        LIVE.users = d.users || []; LIVE.invoices = d.invoices || []; LIVE.refunds = d.refunds || []; LIVE.leads = d.leads || []; LIVE.pushCount = d.pushCount || 0; LIVE.state = "live";
        if (_lastSig && sig !== _lastSig) { _lastSig = sig; render(); } else { _lastSig = sig; }
      })
      .catch(function () {});
  }
  function startPoll() { if (_pollTimer) return; _pollTimer = setInterval(pollLive, 30000); }
  function stopPoll() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

  // POST a JSON body to an admin endpoint with the session token. Returns a
  // parsed JSON object (or {error} on failure) — never throws.
  function adminPost(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + token() }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return { error: "bad_response" }; }); })
      .catch(function () { return { error: "network" }; });
  }

  // Open a clean, printable invoice in a new window (customer can Save as PDF).
  function printInvoice(i) {
    var win = window.open("", "_blank");
    if (!win) { alert("Allow pop-ups to open the invoice."); return; }
    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>Invoice ' + esc(i.id) + '</title>' +
      '<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f1730;max-width:640px;margin:32px auto;padding:0 20px}' +
      'h1{margin:0 0 2px}.muted{color:#5b6b8c}table{width:100%;border-collapse:collapse;margin:20px 0}' +
      'td,th{padding:10px 8px;border-bottom:1px solid #e6ebf5;text-align:left}.r{text-align:right}' +
      '.tot{font-size:1.3rem;font-weight:800}.badge{display:inline-block;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:.8rem}' +
      '.btn{display:inline-block;margin-top:16px;padding:10px 16px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;background:#8b5cf6;color:#fff;cursor:pointer;font-size:.9rem}</style></head><body>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>ChintasMoney</h1><div class="muted">Trader Report Card — educational software (SaaS)</div></div>' +
      '<div class="r"><div style="font-weight:800">INVOICE</div><div class="muted">' + esc(i.date) + '</div></div></div>' +
      '<table><tr><th>Bill to</th><td class="r">' + esc(i.email || "—") + '</td></tr>' +
      '<tr><th>Invoice / Payment ID</th><td class="r">' + esc(i.id) + '</td></tr>' +
      '<tr><th>Item</th><td class="r">' + esc(productName(i.product)) + '</td></tr>' +
      '<tr><th>Method</th><td class="r">' + esc(i.method) + '</td></tr>' +
      '<tr><th>Status</th><td class="r"><span class="badge">' + esc(i.status) + '</span></td></tr>' +
      '<tr><th class="tot">Total paid</th><td class="r tot">' + money(i.amount) + '</td></tr></table>' +
      '<div class="muted" style="font-size:.85rem">Thank you. This is a receipt for a software subscription. Not investment advice. ' +
      'Refunds: support@chintasmoney.com · https://chintasmoney.com/refund</div>' +
      '<button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button>' +
      '</body></html>';
    win.document.write(html); win.document.close();
  }

  // Process a refund (full or partial) through Razorpay, then reload the view.
  function doRefund(paymentId, maxPaise, email, after) {
    var msg = "Refund how much to " + (email || "the customer") + "?\n\nEnter an amount in ₹ (max ₹" + (maxPaise / 100) + "), or leave as-is for a FULL refund.";
    var input = prompt(msg, String(maxPaise / 100));
    if (input === null) return; // cancelled
    var rupees = parseFloat(input);
    if (isNaN(rupees) || rupees <= 0 || rupees > maxPaise / 100) { alert("Enter a valid amount up to ₹" + (maxPaise / 100) + "."); return; }
    var body = { payment_id: paymentId };
    if (Math.round(rupees * 100) !== maxPaise) body.amount = Math.round(rupees * 100); // partial
    if (!confirm("Refund ₹" + rupees + " to " + (email || "the customer") + "? This cannot be undone.")) return;
    adminPost("/api/admin/refund", body).then(function (r) {
      if (r.ok) { adminConfetti(); alert("Refund of ₹" + rupees + " processed ✓"); RZP_CACHE = {}; fetchLive(); if (after) after(); }
      else alert(r.detail || "Refund failed.");
    });
  }

  // Render one Razorpay item (payment / refund / settlement / dispute).
  function rzpCard(it, kind) {
    var card = el('<div class="cm-inv"></div>');
    var amt = money((it.amount || 0) / 100);
    var when = it.created_at ? new Date(it.created_at * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
    if (kind === "payments") {
      var sb = it.status === "captured" ? "b-ok" : it.status === "refunded" ? "b-warn" : it.status === "failed" ? "b-bad" : "b-warn";
      card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(it.id) + '</span><span class="cm-badge ' + sb + '">' + esc(it.status || "") + '</span></div>'));
      card.appendChild(el('<div class="cm-inv-amt">' + amt + '</div>'));
      card.appendChild(el('<div class="cm-uc-mail">' + esc(it.email || it.contact || "—") + '</div>'));
      card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">' + esc(it.method || "") + '</span><span class="cm-muted">' + esc(when) + '</span></div>'));
      var refunded = (it.amount_refunded || 0);
      if (it.status === "captured" && refunded < it.amount) {
        var acts = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>');
        var refBtn = el('<button class="cm-btn sm danger">↩ Refund' + (refunded ? " remaining" : "") + '</button>');
        refBtn.addEventListener("click", function () { doRefund(it.id, it.amount - refunded, it.email || it.contact); });
        acts.appendChild(refBtn);
        card.appendChild(acts);
      } else if (refunded >= it.amount && it.amount > 0) {
        card.appendChild(el('<div style="font-size:.8rem;color:#854d0e;margin-top:6px">Fully refunded</div>'));
      }
    } else if (kind === "refunds") {
      card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(it.id) + '</span><span class="cm-badge b-warn">' + esc(it.status || "refund") + '</span></div>'));
      card.appendChild(el('<div class="cm-inv-amt">' + amt + '</div>'));
      card.appendChild(el('<div class="cm-uc-mail">for ' + esc(it.payment_id || "") + '</div>'));
      card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">' + esc((it.notes && it.notes.reason) || "refund") + '</span><span class="cm-muted">' + esc(when) + '</span></div>'));
    } else if (kind === "settlements") {
      card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(it.id) + '</span><span class="cm-badge b-ok">' + esc(it.status || "") + '</span></div>'));
      card.appendChild(el('<div class="cm-inv-amt">' + amt + '</div>'));
      card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">fees ' + money((it.fees || 0) / 100) + ' · tax ' + money((it.tax || 0) / 100) + '</span><span class="cm-muted">' + esc(when) + '</span></div>'));
    } else { // disputes
      card.appendChild(el('<div class="cm-inv-top"><span class="code">' + esc(it.id) + '</span><span class="cm-badge b-bad">' + esc(it.status || "dispute") + '</span></div>'));
      card.appendChild(el('<div class="cm-inv-amt">' + amt + '</div>'));
      card.appendChild(el('<div class="cm-uc-foot"><span class="cm-muted">' + esc(it.reason_code || "") + '</span><span class="cm-muted">' + esc(when) + '</span></div>'));
    }
    return card;
  }

  // Edit a user: name, plan, and grant/remove tokens. Writes via the server.
  function openEditUser(u) {
    var back = el('<div style="position:fixed;inset:0;background:rgba(11,21,51,.55);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:50px 16px;overflow:auto"></div>');
    var box = el('<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:20px"></div>');
    box.appendChild(el('<h3 style="margin:0 0 2px">Edit user</h3><div class="cm-uc-mail" style="margin-bottom:14px">' + esc(u.email) + '</div>'));
    var nameF = el('<label class="cm-fld"><span>Name</span><input id="euName"/></label>'); nameF.querySelector("input").value = u.name || "";
    var planF = el('<label class="cm-fld"><span>Plan</span><select id="euPlan">' +
      ["free", "plus", "pro", "diamond"].map(function (p) { return '<option value="' + p + '"' + (u.plan === p ? " selected" : "") + '">' + CM.PLANS[p].name + '</option>'; }).join("") + '</select></label>');
    var tokF = el('<label class="cm-fld"><span>Grant tokens (+) or remove (−)</span><input id="euTok" type="number" value="0" step="1"/></label>');
    box.appendChild(nameF); box.appendChild(planF); box.appendChild(tokF);
    var msg = el('<div class="cm-err" style="color:#475569"></div>'); box.appendChild(msg);
    var row = el('<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px"></div>');
    var cancel = el('<button class="cm-btn sm">Cancel</button>'); cancel.addEventListener("click", close);
    var save = el('<button class="cm-btn sm p">Save changes</button>');
    save.addEventListener("click", function () {
      var body = { user_id: u.id, name: box.querySelector("#euName").value.trim(), plan: box.querySelector("#euPlan").value };
      var td = parseInt(box.querySelector("#euTok").value, 10); if (td) body.tokensDelta = td;
      save.disabled = true; save.textContent = "Saving…"; msg.style.color = "#475569"; msg.textContent = "";
      adminPost("/api/admin/update-user", body).then(function (r) {
        if (r.ok) { close(); adminConfetti(); fetchLive(); }
        else { save.disabled = false; save.textContent = "Save changes"; msg.style.color = "#dc2626"; msg.textContent = r.detail || "Couldn't save. Try again."; }
      });
    });
    row.appendChild(cancel); row.appendChild(save); box.appendChild(row);
    back.appendChild(box); document.body.appendChild(back);
    function close() { if (back.parentNode) document.body.removeChild(back); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
  }

  // Lightweight confetti for admin celebrations (no library).
  function adminConfetti() {
    try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    var colors = ["#22e08a", "#f5b849", "#8b5cf6", "#19d3c5", "#ff5a6a", "#7cc7ff"];
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:300;overflow:hidden";
    for (var i = 0; i < 36; i++) {
      var p = document.createElement("i");
      p.style.cssText = "position:absolute;top:-10px;width:9px;height:14px;border-radius:2px;left:" + (Math.random() * 100) + "%;background:" + colors[i % colors.length] + ";transform:rotate(" + (Math.random() * 360) + "deg);animation:cmfall " + (0.9 + Math.random() * 0.8) + "s ease-in forwards;animation-delay:" + (Math.random() * 0.2) + "s";
      wrap.appendChild(p);
    }
    if (!document.getElementById("cm-confetti-kf")) { var st = document.createElement("style"); st.id = "cm-confetti-kf"; st.textContent = "@keyframes cmfall{to{top:100%;opacity:.2;transform:translateY(20px) rotate(400deg)}}"; document.head.appendChild(st); }
    document.body.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 1900);
  }

  // ---- Live payment alert (fires the moment money comes in) -----------------
  function adminBeep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      var ctx = new Ctx(); var o = ctx.createOscillator(); var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.18, ctx.currentTime); o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4); o.stop(ctx.currentTime + 0.42);
    } catch (e) {}
  }
  function adminBanner(text) {
    var b = document.createElement("div");
    b.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:400;background:#16a34a;color:#fff;font-weight:800;padding:12px 20px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:inherit;font-size:.95rem;max-width:90vw";
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(function () { b.style.transition = "opacity .5s"; b.style.opacity = "0"; }, 5000);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 5600);
  }
  function adminPaymentAlert(nNew, amount) {
    adminBeep(); adminConfetti();
    var msg = "💰 " + (nNew > 1 ? nNew + " new payments" : "New payment") + (amount > 0 ? " · " + money(amount) : "") + " just came in!";
    adminBanner(msg);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ChintasMoney — 💰 payment received!", { body: (amount > 0 ? money(amount) + " " : "") + "just landed. Tap to open admin.", icon: "assets/logo-icon.png", tag: "cm-pay" });
      }
    } catch (e) {}
  }
  function adminAskNotify() {
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {}
  }

  // Gift a plan or tokens to a user (grants + emails a gift message).
  function openGiftUser(u) {
    var back = el('<div style="position:fixed;inset:0;background:rgba(11,21,51,.55);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:50px 16px;overflow:auto"></div>');
    var box = el('<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:20px"></div>');
    box.appendChild(el('<h3 style="margin:0 0 2px">🎁 Gift to user</h3><div class="cm-uc-mail" style="margin-bottom:14px">' + esc(u.email) + '</div>'));
    var planF = el('<label class="cm-fld"><span>Gift a plan (optional)</span><select id="gPlan"><option value="">— none —</option>' +
      ["plus", "pro", "diamond"].map(function (p) { return '<option value="' + p + '">' + CM.PLANS[p].name + '</option>'; }).join("") + '</select></label>');
    var tokF = el('<label class="cm-fld"><span>Gift tokens (optional)</span><input id="gTok" type="number" value="0" min="0" step="1"/></label>');
    var msgF = el('<label class="cm-fld"><span>Personal message (optional)</span><input id="gMsg" placeholder="Enjoy — on us!"/></label>');
    box.appendChild(planF); box.appendChild(tokF); box.appendChild(msgF);
    var msg = el('<div class="cm-err" style="color:#475569"></div>'); box.appendChild(msg);
    var row = el('<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px"></div>');
    var cancel = el('<button class="cm-btn sm">Cancel</button>'); cancel.addEventListener("click", close);
    var send = el('<button class="cm-btn sm p">🎁 Send gift</button>');
    send.addEventListener("click", function () {
      var plan = box.querySelector("#gPlan").value, tok = parseInt(box.querySelector("#gTok").value, 10) || 0;
      if (!plan && !tok) { msg.style.color = "#dc2626"; msg.textContent = "Pick a plan or enter tokens to gift."; return; }
      var body = { user_id: u.id, email: u.email, message: box.querySelector("#gMsg").value };
      if (plan) body.plan = plan; if (tok) body.tokens = tok;
      send.disabled = true; send.textContent = "Sending…";
      adminPost("/api/admin/gift", body).then(function (r) {
        if (r.ok) { close(); adminConfetti(); fetchLive(); }
        else { send.disabled = false; send.textContent = "🎁 Send gift"; msg.style.color = "#dc2626"; msg.textContent = r.detail || "Couldn't send the gift."; }
      });
    });
    row.appendChild(cancel); row.appendChild(send); box.appendChild(row);
    back.appendChild(box); document.body.appendChild(back);
    function close() { if (back.parentNode) document.body.removeChild(back); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
  }

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
      ".cm-fld input,.cm-fld select{width:100%;box-sizing:border-box;padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit}",
      ".cm-btn{display:inline-flex;align-items:center;gap:6px;justify-content:center;padding:10px 16px;border-radius:10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;background:#fff;font-weight:600;cursor:pointer;font-family:inherit;font-size:.9rem}",
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
  function allLeads() { return liveOn() ? (LIVE.leads || []) : []; }
  function planPrice(id) { return (CM.PLANS[id] && CM.PLANS[id].price) || 0; }
  function packPrice(id) { var p = TOKEN_PACKS.filter(function (x) { return x.id === id; })[0]; return p ? p.price : 0; }
  function productPrice(id) { return CM.PLANS[id] ? planPrice(id) : packPrice(id); }
  function productName(id) { return CM.PLANS[id] ? CM.PLANS[id].name : (TOKEN_PACKS.filter(function (x) { return x.id === id; })[0] || { name: id }).name; }

  // ---- filter state (persist across re-render within session) ---------------
  var FILTER = { plan: "", status: "", q: "" };
  var TAB = "overview";
  var RZP_SUB = "payments";      // which Razorpay resource is shown
  var RZP_CACHE = {};            // resource -> items | {error} | null(reload)

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
  var TABTITLE = { overview: "Overview", growth: "Growth Cockpit", people: "People Logged", calendar: "Activity Calendar",
    content: "Content Calendar", catalogue: "Product Catalogue & Prices",
    revenue: "Revenue, Invoices & Refunds", razorpay: "Razorpay (live)", gating: "Locked Sections & Gating", flags: "Feature Flags",
    emailer: "Email Marketing", leads: "Leads & CRM", finder: "Lead Finder", push: "Push Alerts",
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

  // ---- Global admin search (jump to any section) ---------------------------
  var SEARCH_ITEMS = [
    ["overview", "▦ Overview", "totals, paying users, revenue, plan mix"],
    ["growth", "📈 Growth cockpit", "funnel, conversion, MRR, ARPU, leads, affiliates, run the business by numbers"],
    ["people", "👥 People logged", "every user, plan, activity"],
    ["calendar", "📅 Activity calendar", "signups & active users per day"],
    ["content", "🗓️ Content calendar", "plan your posts and reels"],
    ["catalogue", "🏷️ Products & prices", "edit plan and token prices"],
    ["revenue", "₹ Revenue & invoices", "money made, invoices, refunds"],
    ["razorpay", "💳 Razorpay (live)", "live payments, refunds, settlements from razorpay"],
    ["gating", "🔒 Locked sections", "which plan unlocks each feature"],
    ["flags", "⚑ Feature flags", "turn features on or off"],
    ["emailer", "✉️ Email marketing", "send campaigns, newsletters, announcements to users and leads"],
    ["leads", "🎯 Leads & CRM", "captured leads, opt-ins, prospects, export contacts"],
    ["finder", "🧭 Lead finder", "find clients: communities, creators, hashtags, outreach scripts, prospecting tracker"],
    ["push", "📲 Push alerts", "send push notifications to users' phones and browsers"],
    ["exportt", "⬇ Export everything", "download users, invoices, refunds"],
    ["privacy", "🛡️ Privacy & security", "admin password & security"]
  ];
  function openAdminSearch() {
    var back = el('<div style="position:fixed;inset:0;background:rgba(11,21,51,.55);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:60px 16px"></div>');
    var box = el('<div style="background:#fff;border-radius:16px;width:100%;max-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden"></div>');
    box.appendChild(el('<div style="padding:14px 16px 0"><input id="cmAdSearch" placeholder="Search sections… e.g. revenue, prices, users" autocomplete="off" style="width:100%;box-sizing:border-box;padding:12px 14px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:1rem;font-family:inherit"/></div>'));
    var list = el('<div id="cmAdList" style="padding:10px 12px 14px;display:grid;gap:6px;max-height:56vh;overflow:auto"></div>');
    box.appendChild(list); back.appendChild(box); document.body.appendChild(back);
    function close() { if (back.parentNode) document.body.removeChild(back); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    var input = box.querySelector("#cmAdSearch");
    function pick(id) { close(); TAB = id; render(); }
    function draw(q) {
      q = (q || "").toLowerCase().trim();
      var rows = SEARCH_ITEMS.filter(function (it) { return !q || it[1].toLowerCase().indexOf(q) !== -1 || it[2].indexOf(q) !== -1; });
      list.innerHTML = "";
      if (!rows.length) { list.appendChild(el('<div style="padding:10px;color:#64748b">No section matches “' + esc(q) + '”.</div>')); return; }
      rows.forEach(function (it, i) {
        var row = el('<button style="display:block;text-align:left;width:100%;padding:11px 12px;border:1px solid #eef2f7;border-radius:10px;background:' + (i === 0 ? "#f5f3ff" : "#fff") + ';cursor:pointer;font-family:inherit"><b style="color:#0f172a">' + it[1] + '</b><div style="font-size:.78rem;color:#64748b;margin-top:1px">' + esc(it[2]) + '</div></button>');
        row.addEventListener("click", function () { pick(it[0]); });
        list.appendChild(row);
      });
    }
    draw("");
    input.addEventListener("input", function () { draw(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var q = input.value.toLowerCase().trim(); var first = SEARCH_ITEMS.filter(function (it) { return !q || it[1].toLowerCase().indexOf(q) !== -1 || it[2].indexOf(q) !== -1; })[0]; if (first) pick(first[0]); }
      if (e.key === "Escape") close();
    });
    setTimeout(function () { input.focus(); }, 40);
  }

  function render() {
    if (!isAuthed()) return renderLogin();
    // Kick off the live fetch once per session for a real (server) token.
    if (LIVE.state === "idle" && token() !== "1") fetchLive();
    root.innerHTML = "";
    var shell = el('<div class="cm-shell"></div>');

    var side = el('<aside class="cm-side"></aside>');
    side.appendChild(el('<a class="cm-brand" href="/app/"><img src="assets/logo.png" alt=""/><span>ChintasMoney<small>CONTROL PANEL</small></span></a>'));
    [["overview", "▦ Overview"], ["growth", "📈 Growth cockpit"], ["people", "👥 People logged"], ["calendar", "📅 Activity calendar"],
     ["content", "🗓️ Content calendar"], ["catalogue", "🏷️ Products & prices"],
     ["revenue", "₹ Revenue & invoices"], ["razorpay", "💳 Razorpay (live)"], ["gating", "🔒 Locked sections"], ["flags", "⚑ Feature flags"],
     ["emailer", "✉️ Email marketing"], ["leads", "🎯 Leads & CRM"], ["finder", "🧭 Lead finder"], ["push", "📲 Push alerts"],
     ["exportt", "⬇ Export everything"], ["privacy", "🛡️ Privacy & security"]].forEach(function (t) {
      var b = el('<button class="cm-nav' + (TAB === t[0] ? " on" : "") + '">' + t[1] + '</button>');
      b.addEventListener("click", function () { TAB = t[0]; render(); });
      side.appendChild(b);
    });
    side.appendChild(el('<div class="cm-sep"></div>'));
    side.appendChild(el('<a class="cm-nav" href="/app/">↩ Back to app</a>'));
    var out = el('<button class="cm-nav">⎋ Sign out</button>');
    out.addEventListener("click", function () { stopPoll(); _lastSig = ""; setToken(""); LIVE = { state: "idle", users: null, invoices: null, refunds: null, leads: null, error: "" }; render(); });
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
      refreshBtn.disabled = true; refreshBtn.textContent = "⏳ Refreshing…";
      fetchLive(); // sets loading, fetches, then re-renders with fresh data
    });
    var searchBtn = el('<button class="cm-btn sm" title="Search sections">🔍 Search</button>');
    searchBtn.addEventListener("click", openAdminSearch);
    var actions = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>');
    // Notifications: today's payments & refunds.
    var today = new Date().toISOString().slice(0, 10);
    var todayPays = allInvoices().filter(function (i) { return i.date === today && i.status === "paid"; });
    var todayRefs = allRefunds().filter(function (r) { return r.date === today; });
    var nCount = todayPays.length + todayRefs.length;
    var notifBtn = el('<button class="cm-btn sm" title="Today\'s activity" style="position:relative">🔔' + (nCount ? '<span style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border-radius:999px;font-size:.62rem;font-weight:800;min-width:16px;height:16px;line-height:16px;text-align:center;padding:0 3px">' + nCount + '</span>' : '') + '</button>');
    notifBtn.addEventListener("click", function () {
      adminAskNotify(); // user gesture — good moment to ask for desktop-alert permission
      var lines = [];
      todayPays.forEach(function (i) { lines.push("💰 " + money(i.amount) + " · " + (i.email || "customer") + " · " + productName(i.product)); });
      todayRefs.forEach(function (r) { lines.push("↩ Refund " + money(r.amount) + " · " + (r.email || "")); });
      var notifyState = (("Notification" in window) && Notification.permission === "granted") ? "\n\n🔔 Live alerts ON — you'll get a sound + popup the moment a payment arrives." : "\n\n(Tip: allow notifications so you get a live alert on every new payment.)";
      alert((nCount ? "Today (" + today + "):\n\n" + lines.join("\n") : "No new payments or refunds today.") + notifyState);
    });
    actions.appendChild(notifBtn); actions.appendChild(searchBtn); actions.appendChild(refreshBtn);
    top.appendChild(actions);
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
    // -------- GROWTH COCKPIT (run the business by numbers) -------------------
    growth: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Your business at a glance — the funnel, conversion, recurring revenue and where growth comes from. ' + (liveOn() ? "Live data." : "Demo data — sign in via the server for live numbers.") + '</div>'));
      var users = allUsers(), leads = allLeads();
      var paying = users.filter(function (u) { return u.plan && u.plan !== "free"; });
      var nUsers = users.length, nPaying = paying.length, nLeads = leads.length;
      var affiliates = leads.filter(function (l) { return (l.source || "").toLowerCase().indexOf("affiliate") !== -1; }).length;
      var conv = nUsers ? Math.round(nPaying / nUsers * 100) : 0;
      var leadConv = nLeads ? Math.round(nUsers / Math.max(nLeads, 1) * 100) : 0;
      var gross = grossRevenue(), refunds = refundTotal(), net = netRevenue(), rec = mrr();
      var arpu = nPaying ? Math.round(net / nPaying) : 0;
      var pushSubs = liveOn() ? (LIVE.pushCount || 0) : 0;

      // ---- Funnel -----------------------------------------------------------
      v.appendChild(el('<h3 style="margin:0 0 8px">Acquisition funnel</h3>'));
      var funnel = el('<div class="cm-card" style="padding:16px;margin-bottom:16px"></div>');
      var stages = [["🎯 Leads captured", nLeads, "#d97706"], ["👥 Signed-up users", nUsers, "#2563eb"], ["💳 Paying customers", nPaying, "#16a34a"]];
      var maxV = Math.max(nLeads, nUsers, nPaying, 1);
      stages.forEach(function (s) {
        var pct = Math.round(s[1] / maxV * 100);
        funnel.appendChild(el('<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:.88rem;font-weight:700;color:#334155"><span>' + s[0] + '</span><span>' + s[1] + '</span></div>' +
          '<div style="background:#eef2f7;border-radius:999px;height:14px;margin-top:4px;overflow:hidden"><div style="width:' + Math.max(pct, 3) + '%;height:100%;background:' + s[2] + '"></div></div></div>'));
      });
      funnel.appendChild(el('<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:.82rem;color:#64748b"><span>Lead→User: <b style="color:#0f172a">' + leadConv + '%</b></span><span>User→Paying: <b style="color:#0f172a">' + conv + '%</b></span></div>'));
      v.appendChild(funnel);

      // ---- KPI cards --------------------------------------------------------
      v.appendChild(el('<h3 style="margin:0 0 8px">Revenue &amp; customers</h3>'));
      var grid = el('<div class="cm-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px"></div>');
      grid.appendChild(stat("Net revenue", money(net), "after refunds"));
      grid.appendChild(stat("MRR", money(rec), "recurring / month"));
      grid.appendChild(stat("ARPU", money(arpu), "net per paying user"));
      grid.appendChild(stat("Gross revenue", money(gross), "all-time"));
      grid.appendChild(stat("Refunds", money(refunds), "all-time"));
      grid.appendChild(stat("Paying customers", nPaying, conv + "% of users"));
      grid.appendChild(stat("Total users", nUsers, "signed-up"));
      grid.appendChild(stat("Leads", nLeads, "opted-in"));
      grid.appendChild(stat("Affiliate applications", affiliates, "from partners page"));
      grid.appendChild(stat("Push subscribers", pushSubs, "opted-in devices"));
      v.appendChild(grid);

      // ---- Plan mix ---------------------------------------------------------
      v.appendChild(el('<h3 style="margin:0 0 8px">Plan mix</h3>'));
      var mix = { free: 0, plus: 0, pro: 0, diamond: 0 };
      users.forEach(function (u) { var p = u.plan || "free"; if (mix[p] == null) mix[p] = 0; mix[p]++; });
      var mixCard = el('<div class="cm-card" style="padding:14px"></div>');
      [["Free", "free", "#94a3b8"], ["Go Plus", "plus", "#16a34a"], ["Platinum", "pro", "#2563eb"], ["Diamond", "diamond", "#8b5cf6"]].forEach(function (p) {
        var n = mix[p[1]] || 0, pct = nUsers ? Math.round(n / nUsers * 100) : 0;
        mixCard.appendChild(el('<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:.85rem;font-weight:700;color:#334155"><span>' + p[0] + '</span><span>' + n + ' · ' + pct + '%</span></div>' +
          '<div style="background:#eef2f7;border-radius:999px;height:10px;margin-top:3px;overflow:hidden"><div style="width:' + Math.max(pct, 2) + '%;height:100%;background:' + p[2] + '"></div></div></div>'));
      });
      v.appendChild(mixCard);

      // ---- Top referrers & affiliates --------------------------------------
      v.appendChild(el('<h3 style="margin:18px 0 8px">Top referrers &amp; affiliates</h3>'));
      var byId = {}; users.forEach(function (u) { if (u.id) byId[u.id] = u; });
      var paidBy = {}; // referrerId -> paid conversions
      users.forEach(function (u) { if (u.referredBy && u.plan && u.plan !== "free") paidBy[u.referredBy] = (paidBy[u.referredBy] || 0) + 1; });
      var referrers = users.filter(function (u) { return (u.referrals || 0) > 0 || paidBy[u.id]; })
        .map(function (u) { return { name: u.name, email: u.email, refs: u.referrals || 0, paid: paidBy[u.id] || 0 }; })
        .sort(function (a, b) { return (b.paid - a.paid) || (b.refs - a.refs); }).slice(0, 15);
      if (!referrers.length) {
        v.appendChild(el('<div class="cm-note">No referrals yet. Users share their link from the app (Refer &amp; Earn); affiliates apply on the partners page and land in Leads &amp; CRM. Approve them and send their link.</div>'));
      } else {
        var rt = el('<div class="cm-card" style="padding:0;overflow:auto"></div>');
        var tb = el('<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:10px 12px">Referrer</th><th style="text-align:left;padding:10px 12px">Signups</th><th style="text-align:left;padding:10px 12px">Paid conversions</th></tr></thead><tbody></tbody></table>');
        var body = tb.querySelector("tbody");
        referrers.forEach(function (r) {
          body.appendChild(el('<tr><td style="padding:9px 12px;border-top:1px solid #eef2f7"><b>' + esc(r.name || "—") + '</b><div class="hint" style="font-size:.78rem;color:#64748b">' + esc(r.email || "") + '</div></td>' +
            '<td style="padding:9px 12px;border-top:1px solid #eef2f7;font-weight:700">' + r.refs + '</td>' +
            '<td style="padding:9px 12px;border-top:1px solid #eef2f7;font-weight:800;color:#16a34a">' + r.paid + '</td></tr>'));
        });
        rt.appendChild(tb); v.appendChild(rt);
        v.appendChild(el('<div class="cm-note" style="margin-top:8px;font-size:.82rem">💡 Reward your top referrers — gift them tokens or a plan from People/Gift to keep them promoting you.</div>'));
      }

      // ---- Next-move hints (turn numbers into action) -----------------------
      var tips = [];
      if (nLeads > 0 && leadConv < 30) tips.push("Only " + leadConv + "% of leads became users — send a welcome campaign from the Emailer to convert more.");
      if (nUsers > 0 && conv < 5) tips.push("Conversion to paid is " + conv + "%. Try a limited-time offer email to free users.");
      if (nLeads === 0) tips.push("No leads yet — share your free tools (Telegram/WhatsApp) and use Prospect Radar to find people to help.");
      if (pushSubs === 0) tips.push("No push subscribers yet — nudge users to turn on alerts (Profile → Turn on alerts).");
      if (affiliates > 0) tips.push(affiliates + " affiliate application(s) waiting — approve them in Leads & CRM and send their partner link.");
      if (tips.length) {
        var t = el('<div class="cm-note" style="margin-top:16px;background:#eff6ff;border-color:#bfdbfe"><b>💡 Suggested next moves</b><ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">' + tips.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div>');
        v.appendChild(t);
      }
      return v;
    },

    // -------- EMAIL MARKETING (broadcast to users / leads) -------------------
    emailer: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Compose a campaign and send it to your users or captured leads — receipts already look professional, and so will this. Emails go out from your verified <b>chintasmoney.com</b> domain via Resend, with your logo header and an unsubscribe line automatically added.</div>'));

      var users = allUsers(), leads = allLeads();
      var paying = users.filter(function (u) { return u.plan && u.plan !== "free"; }).length;
      var chips = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div>');
      chips.appendChild(el('<div class="cm-card cm-stat" style="min-width:120px"><span class="lbl">All users</span><span class="val">' + users.length + '</span><span class="hint">signed-up accounts</span></div>'));
      chips.appendChild(el('<div class="cm-card cm-stat" style="min-width:120px"><span class="lbl">Paying</span><span class="val">' + paying + '</span><span class="hint">on a paid plan</span></div>'));
      chips.appendChild(el('<div class="cm-card cm-stat" style="min-width:120px"><span class="lbl">Leads</span><span class="val">' + leads.length + '</span><span class="hint">opted-in prospects</span></div>'));
      v.appendChild(chips);

      var card = el('<div class="cm-card" style="padding:18px;display:grid;gap:12px;max-width:620px"></div>');
      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Send to</label>'));
      var seg = el('<select style="padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit">' +
        '<option value="leads">Leads only (' + leads.length + ')</option>' +
        '<option value="users">All users (' + users.length + ')</option>' +
        '<option value="plus">Plus plan users</option>' +
        '<option value="pro">Pro plan users</option>' +
        '<option value="diamond">Diamond plan users</option>' +
        '<option value="pick">Pick individually (tick the ones you want)</option>' +
        '<option value="custom">Custom list (paste emails)</option>' +
        '</select>');
      card.appendChild(seg);
      var customWrap = el('<div style="display:none"></div>');
      customWrap.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155;display:block;margin-bottom:5px">Paste emails (comma, space or new line separated)</label>'));
      var customTa = el('<textarea rows="3" placeholder="alice@example.com, bob@example.com" style="width:100%;box-sizing:border-box;padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit"></textarea>');
      customWrap.appendChild(customTa);
      card.appendChild(customWrap);

      // Individual picker — tick specific users/leads from the contacts we have.
      var contacts = [];
      var seenC = {};
      users.forEach(function (u) { if (u.email && !seenC[u.email.toLowerCase()]) { seenC[u.email.toLowerCase()] = 1; contacts.push({ email: u.email, tag: (u.plan && u.plan !== "free" ? u.plan : "user") }); } });
      leads.forEach(function (l) { if (l.email && !seenC[l.email.toLowerCase()]) { seenC[l.email.toLowerCase()] = 1; contacts.push({ email: l.email, tag: "lead" }); } });
      var pickWrap = el('<div style="display:none"></div>');
      var pickHead = el('<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap"></div>');
      var pickSearch = el('<input placeholder="Filter by email…" style="flex:1;min-width:160px;padding:9px 11px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-family:inherit"/>');
      var selAll = el('<button class="cm-btn sm ghost" type="button">Select all</button>');
      var selNone = el('<button class="cm-btn sm ghost" type="button">Clear</button>');
      var pickCount = el('<span style="font-size:.82rem;color:#64748b;font-weight:700">0 selected</span>');
      pickHead.appendChild(pickSearch); pickHead.appendChild(selAll); pickHead.appendChild(selNone); pickHead.appendChild(pickCount);
      pickWrap.appendChild(pickHead);
      var pickList = el('<div style="max-height:260px;overflow:auto;border:1px solid #eef2f7;border-radius:10px;padding:6px"></div>');
      var picked = {};
      function refreshCount() { var n = Object.keys(picked).filter(function (k) { return picked[k]; }).length; pickCount.textContent = n + " selected"; }
      function drawPick(filter) {
        filter = (filter || "").toLowerCase().trim();
        pickList.innerHTML = "";
        var shown = contacts.filter(function (c) { return !filter || c.email.toLowerCase().indexOf(filter) !== -1; });
        if (!contacts.length) { pickList.appendChild(el('<div style="padding:10px;color:#64748b;font-size:.88rem">No contacts yet. Users and leads appear here once you have them.</div>')); return; }
        if (!shown.length) { pickList.appendChild(el('<div style="padding:10px;color:#64748b;font-size:.88rem">No contact matches that filter.</div>')); return; }
        shown.forEach(function (c) {
          var row = el('<label style="display:flex;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer"></label>');
          var cb = el('<input type="checkbox"' + (picked[c.email] ? " checked" : "") + ' style="width:16px;height:16px"/>');
          cb.addEventListener("change", function () { picked[c.email] = cb.checked; refreshCount(); });
          var tagColor = c.tag === "lead" ? "#d97706" : (c.tag === "user" ? "#64748b" : "#16a34a");
          row.appendChild(cb);
          row.appendChild(el('<span style="flex:1;font-size:.9rem;color:#0f172a">' + esc(c.email) + '</span>'));
          row.appendChild(el('<span style="font-size:.7rem;font-weight:700;color:' + tagColor + ';text-transform:uppercase">' + esc(c.tag) + '</span>'));
          pickList.appendChild(row);
        });
      }
      selAll.addEventListener("click", function () {
        var filter = pickSearch.value.toLowerCase().trim();
        contacts.forEach(function (c) { if (!filter || c.email.toLowerCase().indexOf(filter) !== -1) picked[c.email] = true; });
        drawPick(pickSearch.value); refreshCount();
      });
      selNone.addEventListener("click", function () { picked = {}; drawPick(pickSearch.value); refreshCount(); });
      pickSearch.addEventListener("input", function () { drawPick(pickSearch.value); });
      pickWrap.appendChild(pickList);
      card.appendChild(pickWrap);
      drawPick("");

      seg.addEventListener("change", function () {
        customWrap.style.display = seg.value === "custom" ? "block" : "none";
        pickWrap.style.display = seg.value === "pick" ? "block" : "none";
      });

      // Ready-made templates — pick one to fill subject + message instantly.
      var TEMPLATES = {
        welcome: { s: "Welcome to ChintasMoney, {{name}} 🎉", m: "Hi {{name}},\n\nThank you for being our valued customer — we're genuinely thrilled to have you. 💚\n\nChintasMoney is your Trader Report Card: it scores how disciplined you actually trade (no tips, no noise) so every trade makes the next one sharper.\n\n👉 Log a few trades this week and watch your Discipline Score grow.\n\nWe're rooting for you.\n— Team ChintasMoney" },
        feature: { s: "✨ New in ChintasMoney: {{name}}, check this out", m: "Hi {{name}},\n\nWe just shipped something we think you'll love. 🚀\n\n[Describe the new feature in a line or two here.]\n\nOpen the app and give it a try — it takes 2 minutes.\n\nHappy (disciplined) trading!\n— Team ChintasMoney" },
        offer: { s: "🎁 A little something for you, {{name}}", m: "Hi {{name}},\n\nAs a thank-you for being with us, here's a special offer just for you:\n\n[Describe the offer — e.g. 20% off your first month, or bonus analysis tokens.]\n\nTap below to claim it. Offer ends soon!\n— Team ChintasMoney" },
        tip: { s: "💡 One trading-discipline tip, {{name}}", m: "Hi {{name}},\n\nQuick tip that separates calm traders from the rest:\n\n\"Risk a fixed 1–2% per trade — never a gut-feeling amount.\"\n\nDo that, and one bad day can never wipe you out. Log your trades in ChintasMoney to see your own risk patterns.\n\nStay sharp,\n— Team ChintasMoney" }
      };
      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Ready-made template (optional)</label>'));
      var tpl = el('<select style="padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit">' +
        '<option value="">— Start from scratch —</option>' +
        '<option value="welcome">🎉 Welcome / valued customer</option>' +
        '<option value="feature">✨ New feature announcement</option>' +
        '<option value="offer">🎁 Special offer</option>' +
        '<option value="tip">💡 Trading tip</option>' +
        '</select>');
      card.appendChild(tpl);

      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Subject</label>'));
      var subj = el('<input placeholder="e.g. New: your free Money Leak Report is ready" style="padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit"/>');
      card.appendChild(subj);

      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">📷 Image / photo URL (optional)</label>'));
      var imgUrl = el('<input placeholder="https://chintasmoney.com/assets/logo-full.png" style="padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit"/>');
      card.appendChild(imgUrl);
      card.appendChild(el('<div style="font-size:.78rem;color:#94a3b8;margin-top:-4px">Paste a public image link to show a banner at the top of the email. Tip: upload your image to the site or any host, then paste its URL.</div>'));

      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Message</label>'));
      var msg = el('<textarea rows="9" placeholder="Write your message here. Plain text — line breaks are kept. Your logo, footer and unsubscribe line are added automatically." style="width:100%;box-sizing:border-box;padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit;line-height:1.6"></textarea>');
      card.appendChild(msg);
      card.appendChild(el('<div style="font-size:.78rem;color:#94a3b8;margin-top:-4px">✨ Type <b>{{name}}</b> anywhere and it\'s replaced with each person\'s first name automatically (falls back to "there").</div>'));
      tpl.addEventListener("change", function () {
        var t = TEMPLATES[tpl.value];
        if (!t) return;
        if (!subj.value.trim() || confirm("Replace the current subject & message with this template?")) { subj.value = t.s; msg.value = t.m; }
      });

      var status = el('<div style="font-size:.85rem;color:#64748b;min-height:18px"></div>');
      var sendBtn = el('<button class="cm-btn" style="justify-self:start">✉️ Send campaign</button>');
      sendBtn.addEventListener("click", function () {
        if (!liveOn()) { alert("Live data isn't connected yet, so sending is disabled in demo mode."); return; }
        var subject = subj.value.trim(), message = msg.value.trim(), segv = seg.value;
        if (!subject || !message) { status.textContent = "Please fill in both a subject and a message."; status.style.color = "#dc2626"; return; }
        var emails = "";
        if (segv === "custom") { emails = customTa.value.trim(); if (!emails) { status.textContent = "Paste at least one email address."; status.style.color = "#dc2626"; return; } }
        if (segv === "pick") {
          emails = Object.keys(picked).filter(function (k) { return picked[k]; }).join(", ");
          if (!emails) { status.textContent = "Tick at least one contact to send to."; status.style.color = "#dc2626"; return; }
        }
        // Individual picks are sent through the same custom-list path on the server.
        var sendSeg = segv === "pick" ? "custom" : segv;
        if (!confirm("Send \"" + subject + "\" to the selected recipients?\n\nThis emails real people. Make sure it's ready.")) return;
        sendBtn.disabled = true; sendBtn.textContent = "Sending…"; status.style.color = "#64748b"; status.textContent = "Sending campaign…";
        adminPost("/api/admin/broadcast", { subject: subject, message: message, segment: sendSeg, emails: emails, imageUrl: imgUrl.value.trim() }).then(function (r) {
          sendBtn.disabled = false; sendBtn.textContent = "✉️ Send campaign";
          if (r && r.ok) {
            adminConfetti();
            status.style.color = "#166534";
            status.textContent = "✓ Sent to " + r.sent + " recipient" + (r.sent === 1 ? "" : "s") + (r.capped ? " (capped at " + r.sent + " of " + r.total + " — send the rest in a second batch)." : ".");
            subj.value = ""; msg.value = "";
          } else {
            status.style.color = "#dc2626";
            status.textContent = "Couldn't send: " + ((r && (r.detail || r.error)) || "unknown error") + ".";
          }
        });
      });
      card.appendChild(sendBtn);
      card.appendChild(status);
      v.appendChild(card);
      v.appendChild(el('<div class="cm-note" style="margin-top:14px;background:#fef9c3;border-color:#fde68a">⚠️ <b>Only email people who signed up or opted in.</b> Buying or scraping lists is spam — it violates Resend\'s terms and gets your domain blacklisted (breaking your receipts and login emails). Every message includes an unsubscribe line, as the law requires.</div>'));
      return v;
    },

    // -------- LEADS & CRM (opt-in captured prospects) ------------------------
    leads: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">People who opted in through your site — the free Position-Size Calculator, newsletter box, or any lead form. These are permission-based contacts you can email from the <b>Email marketing</b> tab. Grow this list and you grow your funnel.</div>'));
      var leads = allLeads();
      v.appendChild(el('<div class="cm-card cm-stat" style="max-width:200px;margin-bottom:14px"><span class="lbl">Total leads</span><span class="val">' + leads.length + '</span><span class="hint">opted-in contacts</span></div>'));

      if (!liveOn()) { v.appendChild(el('<div class="cm-note">Connect live data (sign in via the server) to see real captured leads.</div>')); return v; }
      if (!leads.length) {
        v.appendChild(el('<div class="cm-note">No leads captured yet. Share your free tool — <b>chintasmoney.com/position-size-calculator</b> — and its email box will fill this list. Each opt-in shows up here automatically.</div>'));
        return v;
      }

      var bar = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>');
      var mailBtn = el('<button class="cm-btn sm">✉️ Email these leads</button>');
      mailBtn.addEventListener("click", function () { TAB = "emailer"; render(); });
      var csvBtn = el('<button class="cm-btn sm ghost">⬇ Export CSV</button>');
      csvBtn.addEventListener("click", function () {
        var rows = [["email", "source", "note", "date"]].concat(leads.map(function (l) {
          return [l.email || "", l.source || "", (l.note || "").replace(/[\r\n,]+/g, " "), l.date || ""];
        }));
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
        var a = document.createElement("a");
        a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
        a.download = "chintasmoney-leads.csv"; a.click();
      });
      bar.appendChild(mailBtn); bar.appendChild(csvBtn);
      v.appendChild(bar);

      var tbl = el('<div class="cm-card" style="padding:0;overflow:auto"></div>');
      var t = el('<table class="cm-table" style="width:100%;border-collapse:collapse"></table>');
      t.appendChild(el('<thead><tr><th style="text-align:left;padding:10px 12px">Email</th><th style="text-align:left;padding:10px 12px">Source</th><th style="text-align:left;padding:10px 12px">Note</th><th style="text-align:left;padding:10px 12px">Date</th></tr></thead>'));
      var tb = el('<tbody></tbody>');
      leads.forEach(function (l) {
        tb.appendChild(el('<tr><td style="padding:9px 12px;border-top:1px solid #eef2f7">' + esc(l.email || "") + '</td>' +
          '<td style="padding:9px 12px;border-top:1px solid #eef2f7">' + esc(l.source || "site") + '</td>' +
          '<td style="padding:9px 12px;border-top:1px solid #eef2f7;color:#64748b">' + esc(l.note || "") + '</td>' +
          '<td style="padding:9px 12px;border-top:1px solid #eef2f7;color:#64748b">' + esc((l.date || "").slice(0, 10)) + '</td></tr>'));
      });
      t.appendChild(tb); tbl.appendChild(t); v.appendChild(tbl);
      return v;
    },

    // -------- PUSH ALERTS (Web Push to phones/browsers) ----------------------
    push: function () {
      var v = el('<div></div>');
      var IN = 'padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit;background:#fff;color:#0f172a';
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">Send a notification straight to the phones and browsers of users who turned on alerts (Profile → 🔔 Turn on alerts in the app). It pops up even when the app is closed.</div>'));
      var subsCount = liveOn() ? (LIVE.pushCount || 0) : 0;
      v.appendChild(el('<div class="cm-card cm-stat" style="max-width:220px;margin-bottom:14px"><span class="lbl">Subscribed devices</span><span class="val">' + subsCount + '</span><span class="hint">opted in to push</span></div>'));

      var card = el('<div class="cm-card" style="padding:18px;display:grid;gap:12px;max-width:620px"></div>');
      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Title</label>'));
      var title = el('<input placeholder="e.g. New feature just dropped 🎉" style="' + IN + '"/>');
      card.appendChild(title);
      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Message</label>'));
      var body = el('<textarea rows="3" placeholder="Short and punchy — this shows on the lock screen." style="width:100%;box-sizing:border-box;' + IN + '"></textarea>');
      card.appendChild(body);
      card.appendChild(el('<label style="font-weight:700;font-size:.85rem;color:#334155">Opens (in-app path)</label>'));
      var link = el('<input value="/app/" style="' + IN + '"/>');
      card.appendChild(link);

      var status = el('<div style="font-size:.85rem;color:#64748b;min-height:18px"></div>');
      var sendBtn = el('<button class="cm-btn" style="justify-self:start">📲 Send push</button>');
      sendBtn.addEventListener("click", function () {
        if (!liveOn()) { alert("Live data isn't connected yet, so sending is disabled in demo mode."); return; }
        var t = title.value.trim(), bd = body.value.trim();
        if (!t || !bd) { status.style.color = "#dc2626"; status.textContent = "Please fill in a title and a message."; return; }
        if (!confirm("Send this push to " + subsCount + " device(s)?")) return;
        sendBtn.disabled = true; sendBtn.textContent = "Sending…"; status.style.color = "#64748b"; status.textContent = "Sending…";
        adminPost("/api/admin/push", { title: t, body: bd, url: link.value.trim() || "/app/" }).then(function (r) {
          sendBtn.disabled = false; sendBtn.textContent = "📲 Send push";
          if (r && r.ok) {
            adminConfetti(); status.style.color = "#166534";
            status.textContent = "✓ Delivered to " + r.sent + " of " + r.total + " device(s)" + (r.removed ? " (" + r.removed + " expired, cleaned up)." : ".");
            title.value = ""; body.value = "";
          } else {
            status.style.color = "#dc2626";
            status.textContent = "Couldn't send: " + ((r && (r.detail || r.error)) || "unknown error") + ".";
          }
        });
      });
      card.appendChild(sendBtn); card.appendChild(status);
      v.appendChild(card);
      v.appendChild(el('<div class="cm-note" style="margin-top:14px;background:#eff6ff;border-color:#bfdbfe">ℹ️ Push needs <b>VAPID_PUBLIC_KEY</b> + <b>VAPID_PRIVATE_KEY</b> set in Cloudflare, and the <b>push_subscriptions</b> table in Supabase. If sending says "not configured," those aren\'t set yet.</div>'));
      return v;
    },

    // -------- LEAD FINDER (legal prospecting hub + outreach tracker) ---------
    finder: function () {
      var v = el('<div></div>');
      var IN2 = 'padding:11px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-size:.95rem;font-family:inherit';

      // ===== PROSPECT RADAR — live search of real people asking right now =====
      v.appendChild(el('<h3 style="margin:0 0 6px">🔴 Prospect Radar <span style="font-size:.7rem;color:#dc2626;font-weight:800;vertical-align:middle">LIVE</span></h3>'));
      v.appendChild(el('<div class="cm-note" style="margin-bottom:12px">Your unfair advantage. Search public <b>Reddit</b> for people asking about risk/discipline right now, or <b>YouTube</b> to find Indian trading creators to partner with. Save anyone straight into your tracker with <b>＋ Track</b>.</div>'));
      var radar = el('<div class="cm-card" style="padding:14px;margin-bottom:10px;display:grid;gap:8px"></div>');
      // Source toggle
      var RADAR_SRC = "reddit";
      var srcRow = el('<div style="display:flex;gap:6px"></div>');
      var bReddit = el('<button type="button" class="cm-btn sm">💬 Reddit — conversations</button>');
      var bYt = el('<button type="button" class="cm-btn sm ghost">▶️ YouTube — creators</button>');
      function setSrc(s) { RADAR_SRC = s; bReddit.className = "cm-btn sm" + (s === "reddit" ? "" : " ghost"); bYt.className = "cm-btn sm" + (s === "youtube" ? "" : " ghost"); subIn.style.display = s === "reddit" ? "" : "none"; qIn.value = s === "youtube" ? "trading psychology" : "how much to risk per trade"; setChips(s); }
      bReddit.addEventListener("click", function () { setSrc("reddit"); }); bYt.addEventListener("click", function () { setSrc("youtube"); });
      srcRow.appendChild(bReddit); srcRow.appendChild(bYt);
      radar.appendChild(srcRow);
      var qIn = el('<input placeholder="What are they asking about?" value="how much to risk per trade" style="' + IN2 + '"/>');
      var subIn = el('<input placeholder="Subreddit (optional, e.g. IndianStockMarket)" style="' + IN2 + '"/>');
      var chips = el('<div style="display:flex;gap:6px;flex-wrap:wrap"></div>');
      var CHIPS = {
        reddit: ["how much to risk per trade", "revenge trading", "blew my account", "position sizing", "trading discipline", "keep losing money", "overtrading"],
        youtube: ["trading psychology", "how to stop revenge trading", "risk management india", "intraday discipline", "why traders lose money", "trading journal"]
      };
      function setChips(s) { chips.innerHTML = ""; CHIPS[s].forEach(function (q) { var c = el('<button type="button" class="cm-btn sm ghost" style="font-size:.78rem">' + esc(q) + '</button>'); c.addEventListener("click", function () { qIn.value = q; runRadar(); }); chips.appendChild(c); }); }
      var goBtn = el('<button class="cm-btn" style="justify-self:start">🔍 Find prospects now</button>');
      var results = el('<div style="display:grid;gap:8px;margin-top:6px"></div>');
      radar.appendChild(qIn); radar.appendChild(subIn); radar.appendChild(chips); radar.appendChild(goBtn); radar.appendChild(results);
      v.appendChild(radar);
      setChips("reddit");

      function timeAgo(sec) {
        if (!sec) return "";
        var s = Math.floor(Date.now() / 1000) - sec;
        if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m ago";
        if (s < 86400) return Math.floor(s / 3600) + "h ago";
        return Math.floor(s / 86400) + "d ago";
      }
      var REPLY = "The mistake most people make isn't picking the wrong stock — it's sizing too big. Risk a fixed 1–2% per trade so no single loss hurts. I built a free calculator that does the math for you: chintasmoney.com/position-size-calculator — no signup needed.";
      var DM = "Hi [name], love your content on trading. I built ChintasMoney — it scores how disciplined a trader actually is (a Discipline Score), not tips. I'd love to give your audience a free tool and set you up with an affiliate commission on anyone who upgrades. Worth a quick chat?";
      function runRadar() {
        results.innerHTML = "";
        results.appendChild(el('<div style="color:#64748b;font-size:.9rem;padding:6px">Searching live…</div>'));
        var url = "/api/admin/prospects?source=" + RADAR_SRC + "&q=" + encodeURIComponent(qIn.value.trim() || "position sizing") + (RADAR_SRC === "reddit" && subIn.value.trim() ? "&sub=" + encodeURIComponent(subIn.value.trim()) : "");
        fetch(url, { headers: { Authorization: "Bearer " + token() } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            results.innerHTML = "";
            if (!d || d.error || !d.items) { results.appendChild(el('<div class="cm-note">Couldn\'t search right now' + (d && d.detail ? " (" + esc(d.detail) + ")" : "") + '. Try again in a moment.</div>')); return; }
            if (!d.items.length) { results.appendChild(el('<div class="cm-note">No results for that. Try another phrase.</div>')); return; }
            d.items.forEach(function (it) {
              var yt = it.platform === "youtube";
              var card = el('<div style="border:1px solid #eef2f7;border-radius:10px;padding:11px 12px"></div>');
              var metaLine = (yt ? "▶️ " : "") + esc(it.who || "") + (it.created ? " · " + esc(timeAgo(it.created)) : "") + (it.meta ? " · " + esc(it.meta) : "");
              card.appendChild(el('<div style="font-size:.72rem;color:#64748b;font-weight:700">' + metaLine + '</div>'));
              card.appendChild(el('<div style="font-weight:700;color:#0f172a;margin:3px 0">' + esc(it.title) + '</div>'));
              if (it.snippet) card.appendChild(el('<div style="font-size:.83rem;color:#64748b;margin-bottom:6px">' + esc(it.snippet) + '…</div>'));
              var row = el('<div style="display:flex;gap:8px;flex-wrap:wrap"></div>');
              row.appendChild(el('<a class="cm-btn sm" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + (yt ? "Watch ↗" : "Open thread ↗") + '</a>'));
              if (yt && it.channelUrl) row.appendChild(el('<a class="cm-btn sm ghost" href="' + esc(it.channelUrl) + '" target="_blank" rel="noopener">Channel ↗</a>'));
              var cp = el('<button class="cm-btn sm ghost">📋 ' + (yt ? "Copy DM" : "Copy reply") + '</button>');
              cp.addEventListener("click", function () { var txt = yt ? DM : REPLY; if (navigator.clipboard) { navigator.clipboard.writeText(txt); cp.textContent = "✓ Copied"; setTimeout(function () { cp.textContent = "📋 " + (yt ? "Copy DM" : "Copy reply"); }, 1500); } else alert(txt); });
              row.appendChild(cp);
              var track = el('<button class="cm-btn sm" style="background:#16a34a;color:#fff">＋ Track</button>');
              track.addEventListener("click", function () {
                var who = (yt ? it.who : it.who) + (yt ? " (YouTube)" : "");
                var p = prospects(); p.unshift({ who: who || it.title, note: it.title + " — " + it.url, status: "to-contact", date: new Date().toISOString().slice(0, 10) });
                saveProspects(p); track.textContent = "✓ Tracked"; track.disabled = true; renderTracker && renderTracker();
              });
              row.appendChild(track);
              card.appendChild(row);
              results.appendChild(card);
            });
          })
          .catch(function () { results.innerHTML = ""; results.appendChild(el('<div class="cm-note">Network error — try again.</div>')); });
      }
      goBtn.addEventListener("click", runRadar);

      v.appendChild(el('<h3 style="margin:22px 0 6px">📍 Where your buyers gather</h3>'));
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">And the playbook: go to these places, add value, drop your link (chintasmoney.com), and log who you contacted below. No scraping, no spam — just showing up where Indian traders already are.</div>'));

      // ---- The hit-list of places to find leads -----------------------------
      var SPOTS = [
        { cat: "Reddit communities", why: "Indian traders asking for help daily. Answer a question, mention your free tool.", items: [
          "r/IndianStockMarket", "r/IndianStreetBets", "r/DalalStreetTalks", "r/StockMarketIndia",
          "r/IndianStockMarketLive", "r/options (global, sizing questions)"
        ] },
        { cat: "Telegram groups", why: "Huge Indian trading crowds. Join, be helpful, share the calculator when relevant.", items: [
          "Search Telegram: 'Indian stock market', 'intraday traders India', 'options trading India'",
          "Nifty/BankNifty discussion groups", "Prop-firm & funded-trader India groups"
        ] },
        { cat: "Discord servers", why: "Active trading chats — many run 'psychology' and 'risk' channels perfect for you.", items: [
          "Search disboard.org: 'India trading', 'stock market India'",
          "Trading psychology / day-trading servers"
        ] },
        { cat: "Twitter / X hashtags", why: "Reply with value under these tags; pin a post linking your free tool.", items: [
          "#StockMarketIndia", "#Nifty50", "#BankNifty", "#Intraday", "#OptionsTrading", "#TradingPsychology", "#RiskManagement"
        ] },
        { cat: "YouTube / Instagram creators", why: "Partner or affiliate — they have the audience, you have the tool. Offer revenue share.", items: [
          "Comment on Indian trading reels/videos with a genuine tip",
          "DM small/mid finfluencers (5k–100k) for an affiliate deal (use your partners.html page)",
          "Offer them a free Diamond plan + commission per referral"
        ] },
        { cat: "Quora", why: "Answer 'how much to risk per trade', 'why do traders lose' — evergreen traffic to your tool.", items: [
          "Search & answer: position sizing, trading discipline, why traders lose money",
          "Link the free position-size calculator in your answer"
        ] },
        { cat: "Facebook groups", why: "Older but massive Indian trading groups; less competition for attention.", items: [
          "Search FB: 'Indian stock market', 'intraday trading India', 'F&O traders'"
        ] }
      ];
      SPOTS.forEach(function (s) {
        var card = el('<div class="cm-card" style="padding:14px;margin-bottom:10px"></div>');
        card.appendChild(el('<div style="font-weight:800;color:#0f172a;font-size:1rem">' + esc(s.cat) + '</div>'));
        card.appendChild(el('<div style="color:#64748b;font-size:.85rem;margin:2px 0 8px">' + esc(s.why) + '</div>'));
        var ul = el('<ul style="margin:0;padding-left:18px;color:#334155;font-size:.9rem;line-height:1.7"></ul>');
        s.items.forEach(function (it) { ul.appendChild(el('<li>' + esc(it) + '</li>')); });
        card.appendChild(ul);
        v.appendChild(card);
      });

      // ---- Copy-paste outreach scripts --------------------------------------
      v.appendChild(el('<h3 style="margin:22px 0 8px">Outreach scripts (copy, tweak, paste)</h3>'));
      var SCRIPTS = [
        { t: "Community reply (helpful, not salesy)", body: "The mistake most people make isn't picking the wrong stock — it's sizing too big. Risk a fixed 1–2% per trade so no single loss hurts. I built a free calculator that does the math for you: chintasmoney.com/position-size-calculator — no signup needed." },
        { t: "Creator / affiliate DM", body: "Hi [name], love your content on [topic]. I built ChintasMoney — it scores how disciplined a trader actually is (a 'Discipline Score'), not tips. I'd love to give your audience a free tool and set you up with an affiliate commission on anyone who upgrades. Worth a quick chat?" },
        { t: "Quora / long answer closer", body: "If you want to see exactly where your own trading leaks money — oversizing, holding losers, revenge trades — ChintasMoney scores your discipline for free: chintasmoney.com. It's not tips; it's a mirror for how you actually trade." }
      ];
      SCRIPTS.forEach(function (sc) {
        var card = el('<div class="cm-card" style="padding:14px;margin-bottom:10px"></div>');
        card.appendChild(el('<div style="font-weight:700;color:#0f172a;margin-bottom:6px">' + esc(sc.t) + '</div>'));
        var box = el('<div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:10px;font-size:.88rem;color:#334155;line-height:1.6;white-space:pre-wrap">' + esc(sc.body) + '</div>');
        card.appendChild(box);
        var copy = el('<button class="cm-btn sm" style="margin-top:8px">📋 Copy</button>');
        copy.addEventListener("click", function () {
          if (navigator.clipboard) { navigator.clipboard.writeText(sc.body); copy.textContent = "✓ Copied"; setTimeout(function () { copy.textContent = "📋 Copy"; }, 1500); }
          else { alert(sc.body); }
        });
        card.appendChild(copy);
        v.appendChild(card);
      });

      // ---- Prospecting tracker (mini-CRM, per-device) -----------------------
      v.appendChild(el('<h3 style="margin:22px 0 8px">Prospecting tracker</h3>'));
      v.appendChild(el('<div class="cm-note" style="margin-bottom:10px">Log who you reach out to so you can follow up. Saved on this device.</div>'));
      function prospects() { var c = CM.adminConfig(); return c.prospects || []; }
      function saveProspects(p) { var c = CM.adminConfig(); c.prospects = p; CM.saveAdmin(c); }
      var form = el('<div class="cm-card" style="padding:14px;display:grid;gap:8px;max-width:560px;margin-bottom:12px"></div>');
      var who = el('<input placeholder="Who / where (e.g. @trader_ravi on X, or r/IndianStreetBets)" style="padding:10px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-family:inherit"/>');
      var note = el('<input placeholder="Note (e.g. sent affiliate DM, waiting reply)" style="padding:10px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-family:inherit"/>');
      var stsel = el('<select style="padding:10px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;font-family:inherit"><option value="to-contact">To contact</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="partner">Partner / converted 🎉</option></select>');
      var add = el('<button class="cm-btn" style="justify-self:start">➕ Add prospect</button>');
      add.addEventListener("click", function () {
        var w = who.value.trim(); if (!w) { who.focus(); return; }
        var p = prospects(); p.unshift({ who: w, note: note.value.trim(), status: stsel.value, date: new Date().toISOString().slice(0, 10) });
        saveProspects(p); who.value = ""; note.value = ""; renderTracker();
      });
      form.appendChild(who); form.appendChild(note); form.appendChild(stsel); form.appendChild(add);
      v.appendChild(form);

      var trkBar = el('<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"></div>');
      var trkCount = el('<span style="font-size:.82rem;color:#64748b;font-weight:700"></span>');
      var trkCsv = el('<button class="cm-btn sm ghost">⬇ Export CSV</button>');
      trkCsv.addEventListener("click", function () {
        var rows = [["who", "note", "status", "date"]].concat(prospects().map(function (p) { return [p.who || "", (p.note || "").replace(/[\r\n,]+/g, " "), p.status || "", p.date || ""]; }));
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
        var a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "chintasmoney-prospects.csv"; a.click();
      });
      trkBar.appendChild(trkCount); trkBar.appendChild(trkCsv);
      v.appendChild(trkBar);
      var trackerWrap = el('<div></div>'); v.appendChild(trackerWrap);
      function renderTracker() {
        var list = prospects();
        trkCount.textContent = list.length + " prospect" + (list.length === 1 ? "" : "s");
        trackerWrap.innerHTML = "";
        if (!list.length) { trackerWrap.appendChild(el('<div class="cm-note">No prospects yet. Use ＋ Track on a result above, or add one manually.</div>')); return; }
        var STL = { "to-contact": ["To contact", "#64748b"], contacted: ["Contacted", "#2563eb"], replied: ["Replied", "#d97706"], partner: ["Partner 🎉", "#16a34a"] };
        var tbl = el('<div class="cm-card" style="padding:0;overflow:auto"></div>');
        var t = el('<table style="width:100%;border-collapse:collapse"></table>');
        t.appendChild(el('<thead><tr><th style="text-align:left;padding:10px 12px">Who / where</th><th style="text-align:left;padding:10px 12px">Note</th><th style="text-align:left;padding:10px 12px">Status</th><th style="text-align:left;padding:10px 12px">Date</th><th></th></tr></thead>'));
        var tb = el('<tbody></tbody>');
        list.forEach(function (p, idx) {
          var st = STL[p.status] || STL["to-contact"];
          var tr = el('<tr></tr>');
          tr.appendChild(el('<td style="padding:9px 12px;border-top:1px solid #eef2f7">' + esc(p.who) + '</td>'));
          tr.appendChild(el('<td style="padding:9px 12px;border-top:1px solid #eef2f7;color:#64748b">' + esc(p.note || "") + '</td>'));
          var stTd = el('<td style="padding:9px 12px;border-top:1px solid #eef2f7"></td>');
          var stSel = el('<select style="padding:5px 8px;background:#fff;color:' + st[1] + ';border:1px solid #e2e8f0;border-radius:8px;font-weight:700;font-size:.8rem;font-family:inherit"><option value="to-contact">To contact</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="partner">Partner 🎉</option></select>');
          stSel.value = p.status || "to-contact";
          stSel.addEventListener("change", function () { var pl = prospects(); if (pl[idx]) { pl[idx].status = stSel.value; saveProspects(pl); renderTracker(); } });
          stTd.appendChild(stSel); tr.appendChild(stTd);
          tr.appendChild(el('<td style="padding:9px 12px;border-top:1px solid #eef2f7;color:#64748b">' + esc(p.date || "") + '</td>'));
          var del = el('<button class="cm-btn sm ghost" title="Remove">✕</button>');
          del.addEventListener("click", function () { var pl = prospects(); pl.splice(idx, 1); saveProspects(pl); renderTracker(); });
          var tdd = el('<td style="padding:9px 12px;border-top:1px solid #eef2f7"></td>'); tdd.appendChild(del); tr.appendChild(tdd);
          tb.appendChild(tr);
        });
        t.appendChild(tb); tbl.appendChild(t); trackerWrap.appendChild(tbl);
      }
      renderTracker();

      v.appendChild(el('<div class="cm-note" style="margin-top:14px;background:#dcfce7;border-color:#bbf7d0">✅ <b>This is how you find clients without getting banned.</b> Every place above is where your buyers already are. Show up with value 3–4x a week, drop your free tool, and watch the Leads tab fill up.</div>'));
      return v;
    },

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
      v.appendChild(el('<div class="cm-note" style="margin-top:14px">' + (liveOn()
        ? 'User rows and revenue are <b>live</b> from your database. Prices, gating and flags you change here are real and take effect in the app immediately.'
        : 'Cross-user rows are demo data. Prices, gating and flags you change here are <b>real</b> and take effect in the live app immediately.') + '</div>'));
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
        // Edit (live mode, real accounts only — needs the server user id).
        if (liveOn() && u.id) {
          var foot = el('<div class="cm-uc-foot"></div>');
          var acts = el('<div style="display:flex;gap:8px"></div>');
          var giftBtn = el('<button class="cm-btn sm">🎁 Gift</button>');
          giftBtn.addEventListener("click", function () { openGiftUser(u); });
          var editBtn = el('<button class="cm-btn sm">✎ Edit</button>');
          editBtn.addEventListener("click", function () { openEditUser(u); });
          acts.appendChild(giftBtn); acts.appendChild(editBtn);
          foot.appendChild(el('<span class="cm-muted">Manage</span>')); foot.appendChild(acts);
          card.appendChild(foot);
        }
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
          // Action buttons (live mode only — they call the server).
          if (liveOn()) {
            var acts = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>');
            var dlBtn = el('<button class="cm-btn sm">📄 Invoice</button>');
            dlBtn.addEventListener("click", function () { printInvoice(i); });
            acts.appendChild(dlBtn);
            var mailBtn = el('<button class="cm-btn sm">✉ Email</button>');
            mailBtn.addEventListener("click", function () {
              mailBtn.disabled = true; mailBtn.textContent = "Sending…";
              adminPost("/api/admin/send-invoice", { payment_id: i.id, email: i.email }).then(function (r) {
                mailBtn.disabled = false; mailBtn.textContent = "✉ Email";
                if (r.ok) alert("Invoice emailed to " + (r.sentTo || i.email));
                else alert(r.detail || (r.error === "email_not_configured" ? "Email isn't set up yet (add RESEND_API_KEY in Cloudflare)." : "Couldn't send invoice."));
              });
            });
            acts.appendChild(mailBtn);
            if (i.status === "paid") {
              var refBtn = el('<button class="cm-btn sm danger">↩ Refund</button>');
              refBtn.addEventListener("click", function () { doRefund(i.id, Math.round(i.amount * 100), i.email); });
              acts.appendChild(refBtn);
            }
            card.appendChild(acts);
          }
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
      v.appendChild(el('<div class="cm-note" style="margin-top:14px">' + (liveOn()
        ? '🟢 <b>Live figures</b> — real verified payments &amp; refunds from Razorpay, stored in your database. Tap 🔄 Refresh to pull the latest.'
        : 'Real invoices &amp; refunds appear here once you are signed in via the server. These are demo figures.') + '</div>'));
      return v;
    },

    // -------- RAZORPAY (LIVE MIRROR) ----------------------------------------
    razorpay: function () {
      var v = el('<div></div>');
      v.appendChild(el('<div class="cm-note" style="margin-bottom:14px">💳 <b>Live from Razorpay</b> — this mirrors your Razorpay dashboard exactly. Refund (full or partial) right here; it processes through Razorpay and updates your records.</div>'));
      // Sub-nav for the Razorpay resources.
      var subs = [["payments", "Payments"], ["refunds", "Refunds"], ["settlements", "Settlements"], ["disputes", "Disputes"]];
      var bar = el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div>');
      subs.forEach(function (s) {
        var b = el('<button class="cm-btn sm' + (RZP_SUB === s[0] ? " p" : "") + '">' + s[1] + '</button>');
        b.addEventListener("click", function () { RZP_SUB = s[0]; RZP_CACHE[s[0]] = null; render(); });
        bar.appendChild(b);
      });
      v.appendChild(bar);
      var host = el('<div></div>'); v.appendChild(host);
      var cached = RZP_CACHE[RZP_SUB];
      if (cached === undefined || cached === null) {
        host.appendChild(el('<div class="cm-card cm-muted">Loading live ' + RZP_SUB + ' from Razorpay…</div>'));
        fetch("/api/admin/razorpay?resource=" + RZP_SUB, { headers: { Authorization: "Bearer " + token() } })
          .then(function (r) { return r.json().catch(function () { return { error: "bad" }; }); })
          .then(function (d) { RZP_CACHE[RZP_SUB] = d.ok ? (d.items || []) : { error: d.detail || d.error || "Couldn't load" }; render(); });
        return v;
      }
      if (cached && cached.error) { host.appendChild(el('<div class="cm-card b-bad" style="padding:14px">⚠ ' + esc(cached.error) + '</div>')); return v; }
      if (!cached.length) { host.appendChild(el('<div class="cm-card cm-muted">No ' + RZP_SUB + ' found in Razorpay.</div>')); return v; }
      var grid = el('<div class="cm-cards"></div>');
      cached.forEach(function (it) { grid.appendChild(rzpCard(it, RZP_SUB)); });
      host.appendChild(grid);
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
        var sel = el('<select style="padding:8px 10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:9px;font-family:inherit">' +
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
