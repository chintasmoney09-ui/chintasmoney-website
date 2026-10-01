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

  // Capture a referral code from the URL (?ref=...) and remember it until sign-in.
  try {
    var _rp = new URLSearchParams(location.search).get("ref");
    if (_rp) localStorage.setItem("cm.ref", _rp);
  } catch (e) {}
  // Once signed in, if we have a stored ref, claim the referral bonus (server dedupes).
  function maybeReferral(user) {
    try {
      if (!user || !user.id) return;
      var ref = localStorage.getItem("cm.ref");
      if (!ref || ref === user.id) return;
      if (localStorage.getItem("cm.ref.done") === "1") return;
      localStorage.setItem("cm.ref.done", "1");
      fetch("/api/referral", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + (Cloud.token || "") }, body: JSON.stringify({ ref: ref }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (d && d.granted) { try { window.CM && window.CM.addTokens(d.granted); } catch (e) {} pull().then(rerender); } }).catch(function () {});
    } catch (e) {}
  }

  // Send the welcome email exactly once per account (tracked per-user locally).
  function maybeWelcome(user) {
    try {
      if (!user || !user.email) return;
      var k = "cm.welcomed." + user.id;
      if (localStorage.getItem(k) === "1") return;
      localStorage.setItem(k, "1");
      fetch("/api/welcome", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email }) }).catch(function () {});
    } catch (e) {}
  }

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
  // Lifecycle emails: ping the worker a little after a change so it can send
  // any newly-earned milestone email (first trade, 5 trades, first dream…).
  // Debounced and server-deduped, so it never spams. Runs only when signed in.
  var lifeTimer = null;
  function scheduleLifecycle() {
    if (Cloud.state !== "authed" || !Cloud.token) return;
    clearTimeout(lifeTimer);
    lifeTimer = setTimeout(function () {
      try { fetch("/api/lifecycle", { method: "POST", headers: { Authorization: "Bearer " + Cloud.token } }).catch(function () {}); } catch (e) {}
    }, 12000);
  }
  Cloud.lifecycle = scheduleLifecycle;
  // Patch CM.save so every local change also syncs to the cloud.
  function patchSave() {
    if (!window.CM || CM.__patched) return; CM.__patched = true;
    var orig = CM.save;
    CM.save = function () { orig.apply(CM, arguments); schedulePush(); scheduleLifecycle(); };
  }
  // Which account the data currently on THIS device belongs to. Used to stop one
  // account's plan/data leaking into a different email that signs in on the same
  // device (the source of a "logged in with a new email, still shows Diamond" bug).
  function prevOwner() { try { return localStorage.getItem("cm.owner"); } catch (e) { return null; } }
  function setOwner(id) { try { localStorage.setItem("cm.owner", id || ""); } catch (e) {} }

  // Merge the account's server state (remote — the source of truth) with this
  // device's local state so signing in never destroys data logged offline.
  // SECURITY: a device's local plan can NEVER raise the account's plan. Only the
  // account's own server row (written by a verified payment) sets a paid plan.
  //   opts.sameOwner  — the local data belongs to the SAME account signing in.
  //   opts.anonDevice — this device was never signed in (anonymous trial use).
  function mergeStates(remote, local, opts) {
    opts = opts || {};
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
    var rank = { free: 0, plus: 1, platinum: 2, pro: 2, diamond: 3 };
    var rp = (remote.profile && remote.profile.plan) || "free";
    var lp = (local.profile && local.profile.plan) || "free";
    var merged = Object.assign({}, local, remote);
    // Carry this device's trades/dreams into the account only when they belong to
    // the same account or the device was anonymous. A DIFFERENT previous owner's
    // data (and plan) must never bleed into the account now signing in.
    if (opts.sameOwner || opts.anonDevice) {
      merged.trades = unionById(remote.trades, local.trades);
      merged.dreams = unionById(remote.dreams, local.dreams);
    } else {
      merged.trades = remote.trades || [];
      merged.dreams = remote.dreams || [];
    }
    merged.profile = Object.assign({}, local.profile, remote.profile);
    // Plan: the account (remote) wins. Keep a higher LOCAL plan only for the same
    // account, purely to survive the brief window right after a payment before it
    // syncs — never across accounts or from an anonymous device.
    merged.profile.plan = (opts.sameOwner && rank[lp] > rank[rp]) ? lp : rp;
    // Onboarding is sticky — once done anywhere, it's done.
    merged.profile.onboarded = !!((remote.profile && remote.profile.onboarded) || (local.profile && local.profile.onboarded));
    return merged;
  }

  // The AUTHORITATIVE plan comes from the server (payments keyed to THIS email,
  // or an admin override) — never from local/device state. This is what stops a
  // paid plan on one Google account showing up on a different account signed in
  // on the same device. Fail-safe: if the server can't determine it (ok:false),
  // we leave the current plan untouched so a real payer is never locked out.
  function applyEntitlement() {
    if (!Cloud.token) return Promise.resolve();
    return fetch("/api/entitlement", { headers: { Authorization: "Bearer " + Cloud.token } })
      .then(function (r) { return r.json(); })
      .then(function (e) {
        if (!e || e.ok !== true || !e.plan) return;
        var cur = (window.CM.load().profile.plan) || "free";
        var patch = {};
        if (e.plan !== cur) patch.plan = e.plan;
        // Remember when the paid plan lapses so the app can nudge a renewal.
        patch.plan_until = (e.plan !== "free" && e.paidUntil) ? e.paidUntil : null;
        window.CM.setProfile(patch);
      })
      .catch(function () {});
  }
  Cloud.applyEntitlement = applyEntitlement;

  function pull() {
    var localBefore = window.CM.load();
    var po = prevOwner();
    var sameOwner = !!po && po === Cloud.user.id;
    var anonDevice = po == null || po === "";
    return Cloud.client.from("user_state").select("data").eq("user_id", Cloud.user.id).maybeSingle()
      .then(function (r) {
        if (r && r.data && r.data.data) {
          var merged = mergeStates(r.data.data, localBefore, { sameOwner: sameOwner, anonDevice: anonDevice });
          window.CM.hydrate(merged);
          setOwner(Cloud.user.id);
          // Push the merged result back so the account row reflects the union.
          return Cloud.client.from("user_state").upsert({ user_id: Cloud.user.id, data: merged, updated_at: new Date().toISOString() });
        } else {
          // First login for this account (no server row yet). A brand-new account
          // has NOT paid, so it never inherits a paid plan from the device — the
          // plan always starts free (a 7-day trial can be started in-app, and a
          // real payment writes the plan straight to the server). Carry the
          // device's own trades only when it was anonymous or the same account.
          var keepData = sameOwner || anonDevice;
          var seed = {
            profile: Object.assign({}, localBefore.profile, { plan: "free", plan_since: null, trialEndsAt: null }),
            trades: keepData ? (localBefore.trades || []) : [],
            dreams: keepData ? (localBefore.dreams || []) : []
          };
          window.CM.hydrate(seed);
          setOwner(Cloud.user.id);
          return Cloud.client.from("user_state").upsert({ user_id: Cloud.user.id, data: seed, updated_at: new Date().toISOString() });
        }
      })
      .then(function (res) { try { scheduleLifecycle(); } catch (e) {} return res; });
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
  Cloud.signOut = function () {
    return Cloud.client.auth.signOut().then(function () {
      // Clear the device's account tag and drop any paid plan locally so the next
      // person to use this device (or an anonymous session) never inherits it.
      try {
        localStorage.removeItem("cm.owner");
        if (window.CM && window.CM.setProfile) window.CM.setProfile({ plan: "free", plan_since: null, trialEndsAt: null });
      } catch (e) {}
      location.reload();
    });
  };

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
              fetch("/api/razorpay/verify", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + (Cloud.token || "") },
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
    // Map by token count (new packs: 400/700/1600/3000).
    var product = n === 400 ? "tok400" : n === 700 ? "tok700" : n === 1600 ? "tok1600" : n === 3000 ? "tok3000" : null;
    if (!product) { alert("Unknown token pack."); return; }
    rzpPay(product, function (grant) { if (onPaid) onPaid(grant); });
  };

  // ---- init ----------------------------------------------------------------
  loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js").then(function () {
    Cloud.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    patchSave();
    Cloud.client.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (session) { Cloud.user = session.user; Cloud.token = session.access_token; Cloud.state = "authed"; maybeWelcome(session.user); maybeReferral(session.user); pull().then(applyEntitlement).then(rerender); }
      else { Cloud.state = "anon"; rerender(); }
    });
    Cloud.client.auth.onAuthStateChange(function (_evt, session) {
      if (session && session.user) { Cloud.user = session.user; Cloud.token = session.access_token; Cloud.state = "authed"; maybeWelcome(session.user); maybeReferral(session.user); pull().then(applyEntitlement).then(rerender); }
      else { Cloud.user = null; Cloud.token = null; Cloud.state = "anon"; rerender(); }
    });
  }).catch(function () { Cloud.state = "error"; rerender(); });
})();
