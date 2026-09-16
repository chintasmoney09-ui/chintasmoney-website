/* ChintasMoney — cloud layer (Supabase auth + sync, Razorpay payments)
 * -----------------------------------------------------------------------------
 * Activates only when window.CM_CONFIG.cloud === true and keys are set.
 * When off, this file does nothing and the app runs offline as before.
 *
 * Sync model (simple + reliable for MVP): the user's entire ChintasMoney state
 * is stored as ONE JSON row per user in a `user_state` table, protected by
 * Row-Level Security so each user can only read/write their own row.
 * ---------------------------------------------------------------------------*/
(function () {
  "use strict";
  var cfg = window.CM_CONFIG || {};
  var Cloud = window.CMCloud = { state: "off", user: null, client: null };
  if (!cfg.cloud || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return; // stay offline
  Cloud.state = "loading";

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function rerender() { if (window.__cmRender) window.__cmRender(); }

  // ---- state sync ----------------------------------------------------------
  var pushTimer = null;
  function schedulePush() {
    if (Cloud.state !== "authed" || !Cloud.client || !Cloud.user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      try {
        Cloud.client.from("user_state").upsert({ user_id: Cloud.user.id, data: window.CM.load(), updated_at: new Date().toISOString() }).then(function () {});
      } catch (e) {}
    }, 800);
  }
  // Patch CM.save so every local change also syncs to the cloud.
  function patchSave() {
    if (!window.CM || CM.__patched) return; CM.__patched = true;
    var orig = CM.save;
    CM.save = function () { orig.apply(CM, arguments); schedulePush(); };
  }
  // Merge two app states so signing in never destroys data logged on another
  // device or while offline. Trades & dreams are unioned by id (never dropped);
  // for single-value fields (profile, plan) the remote copy wins, since that's
  // the account's source of truth, but a paid plan is never downgraded.
  function mergeStates(remote, local) {
    if (!remote || typeof remote !== "object") return local;
    if (!local || typeof local !== "object") return remote;
    function unionById(a, b) {
      var out = [], seen = {};
      (a || []).concat(b || []).forEach(function (it) {
        if (!it) return;
        var k = it.id || JSON.stringify(it);
        if (seen[k]) return; seen[k] = 1; out.push(it);
      });
      return out;
    }
    var merged = Object.assign({}, local, remote);
    merged.trades = unionById(remote.trades, local.trades);
    merged.dreams = unionById(remote.dreams, local.dreams);
    // Keep the higher plan so an offline change can't silently downgrade a payer.
    var rank = { free: 0, plus: 1, platinum: 2, pro: 2, diamond: 3 };
    var rp = (remote.profile && remote.profile.plan) || "free";
    var lp = (local.profile && local.profile.plan) || "free";
    merged.profile = Object.assign({}, local.profile, remote.profile);
    merged.profile.plan = (rank[lp] > rank[rp] ? lp : rp);
    // Onboarding is sticky — once done anywhere, it's done.
    merged.profile.onboarded = !!((remote.profile && remote.profile.onboarded) || (local.profile && local.profile.onboarded));
    return merged;
  }

  function pull() {
    var localBefore = window.CM.load();
    return Cloud.client.from("user_state").select("data").eq("user_id", Cloud.user.id).maybeSingle()
      .then(function (r) {
        if (r && r.data && r.data.data) {
          var merged = mergeStates(r.data.data, localBefore);
          window.CM.hydrate(merged);
          // Push the merged result back so the account row reflects the union.
          return Cloud.client.from("user_state").upsert({ user_id: Cloud.user.id, data: merged, updated_at: new Date().toISOString() });
        } else { // first login → seed a fresh row from current local state
          return Cloud.client.from("user_state").upsert({ user_id: Cloud.user.id, data: localBefore, updated_at: new Date().toISOString() });
        }
      });
  }

  // ---- auth API ------------------------------------------------------------
  Cloud.signUp = function (email, pass) { return Cloud.client.auth.signUp({ email: email, password: pass }); };
  Cloud.signIn = function (email, pass) { return Cloud.client.auth.signInWithPassword({ email: email, password: pass }); };
  Cloud.signInGoogle = function () { return Cloud.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } }); };
  Cloud.signOut = function () { return Cloud.client.auth.signOut().then(function () { location.reload(); }); };

  // ---- Razorpay checkout ---------------------------------------------------
  Cloud.checkout = function (planId, onPaid) {
    if (!cfg.razorpayKeyId) { alert("Payments not configured yet."); return; }
    var amount = (cfg.planPrices && cfg.planPrices[planId]) || 0;
    function open() {
      var rzp = new window.Razorpay({
        key: cfg.razorpayKeyId, amount: amount, currency: "INR",
        name: "ChintasMoney", description: planId === "pro" ? "Pro subscription" : "Plus subscription",
        prefill: { email: (Cloud.user && Cloud.user.email) || "" },
        theme: { color: "#8b5cf6" },
        handler: function (resp) {
          // NOTE: for production, verify resp.razorpay_payment_id via a webhook /
          // Supabase Edge Function before granting the plan (see BACKEND-SETUP.md).
          window.CM.setProfile({ plan: planId, paymentId: resp.razorpay_payment_id, plan_since: new Date().toISOString() });
          if (onPaid) onPaid(); else rerender();
        }
      });
      rzp.open();
    }
    if (window.Razorpay) open();
    else loadScript("https://checkout.razorpay.com/v1/checkout.js").then(open).catch(function () { alert("Could not load payment gateway."); });
  };

  // ---- init ----------------------------------------------------------------
  loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js").then(function () {
    Cloud.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    patchSave();
    Cloud.client.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (session) { Cloud.user = session.user; Cloud.state = "authed"; pull().then(rerender); }
      else { Cloud.state = "anon"; rerender(); }
    });
    Cloud.client.auth.onAuthStateChange(function (_evt, session) {
      if (session && session.user) { Cloud.user = session.user; Cloud.state = "authed"; pull().then(rerender); }
      else { Cloud.user = null; Cloud.state = "anon"; rerender(); }
    });
  }).catch(function () { Cloud.state = "error"; rerender(); });
})();
