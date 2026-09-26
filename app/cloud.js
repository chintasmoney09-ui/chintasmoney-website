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
  Cloud.signInGoogle = function () { return Cloud.signInOAuth("google"); };
  // One-tap social sign-in. The provider (Google, Microsoft/azure, etc.) must be
  // enabled in Supabase → Authentication → Providers. New users are recorded in
  // the Supabase user base automatically, exactly like email sign-ups.
  Cloud.signInOAuth = function (provider) {
    // Redirect to a CLEAN url (no "#/route") so Supabase's "#access_token=…" is
    // the only hash — otherwise a double hash breaks session detection on return.
    return Cloud.client.auth.signInWithOAuth({ provider: provider, options: { redirectTo: location.origin + location.pathname } });
  };
  Cloud.signOut = function () { return Cloud.client.auth.signOut().then(function () { location.reload(); }); };

  // ---- Razorpay checkout (server-created order + verified signature) ----------
  // The Worker verifies the payment signature and re-reads the order's true
  // product/amount, so the amount and product can't be tampered. NOTE: the grant
  // is still applied client-side (localStorage + cloud sync), so a determined
  // user could edit their own local entitlements. Full server-enforced
  // entitlements (write grant to Supabase, gate token use server-side) is a
  // follow-up hardening step; it only affects that user's own account.
  // The Worker creates the order (authoritative amount) and verifies the payment
  // signature. We only grant the plan/tokens after /api/razorpay/verify says valid.
  function rzpPay(product, onValid) {
    fetch("/api/razorpay/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product: product }) })
      .then(function (r) { return r.json(); })
      .then(function (o) {
        if (!o || !o.orderId) { alert(o && o.error === "payments not configured" ? "Payments aren't switched on yet." : "Couldn't start checkout. Please try again."); return; }
        function open() {
          var rzp = new window.Razorpay({
            key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency,
            name: "ChintasMoney", description: o.label,
            prefill: { email: (Cloud.user && Cloud.user.email) || "" },
            theme: { color: "#8b5cf6" },
            handler: function (resp) {
              fetch("/api/razorpay/verify", { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ order_id: resp.razorpay_order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature, product: product, email: (Cloud.user && Cloud.user.email) || "" }) })
                .then(function (r) { return r.json(); })
                .then(function (v) {
                  if (v && v.valid) onValid(v.grant);
                  else alert("We couldn't verify that payment. If you were charged, contact support — nothing was unlocked.");
                })
                .catch(function () { alert("Payment verification failed. If you were charged, contact support."); });
            }
          });
          rzp.open();
        }
        if (window.Razorpay) open();
        else loadScript("https://checkout.razorpay.com/v1/checkout.js").then(open).catch(function () { alert("Could not load payment gateway."); });
      })
      .catch(function () { alert("Could not start checkout. Please try again."); });
  }
  Cloud.checkout = function (planId, onPaid) {
    rzpPay(planId, function (grant) {
      window.CM.setProfile({ plan: grant.plan, plan_since: new Date().toISOString() });
      if (onPaid) onPaid(); else rerender();
    });
  };
  Cloud.checkoutTokens = function (n, price, onPaid) {
    var product = n === 20 ? "tok20" : n === 60 ? "tok60" : n === 150 ? "tok150" : null;
    if (!product) { alert("Unknown token pack."); return; }
    rzpPay(product, function () { if (onPaid) onPaid(); });
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
