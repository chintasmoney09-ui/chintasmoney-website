/* ChintasMoney — backend configuration
 * -----------------------------------------------------------------------------
 * Fill these in AFTER you create your free Supabase + Razorpay accounts
 * (see BACKEND-SETUP.md). Until then keep cloud:false — the app runs fully
 * offline (data in the browser) exactly as before.
 * ---------------------------------------------------------------------------*/
window.CM_CONFIG = {
  // Cloud sync is ON. The keys below are the public browser keys (safe to ship).
  cloud: true,

  // From Supabase → Project Settings → API
  supabaseUrl: "https://voycwperlvcozshjambo.supabase.co",
  supabaseAnonKey: "sb_publishable_gOYAKgseiCmhO8hW8v5G5w_4S2PFWsa", // public "publishable" key — safe in the browser

  // From Razorpay → Settings → API Keys (use the Key ID, NOT the secret)
  razorpayKeyId: "",       // e.g. rzp_live_XXXXXXXX or rzp_test_XXXXXXXX (payments not set up yet)

  // Subscription prices in paise (₹199 = 19900). Editable anytime.
  planPrices: { plus: 19900, pro: 49900 },

  // One-tap social sign-in. Turn a provider on ONLY after you enable it in
  // Supabase → Authentication → Providers (each needs OAuth credentials).
  // Users who sign in this way are recorded in your Supabase user base too.
  authProviders: { google: true, microsoft: false },
  enableGoogle: false, // (legacy flag, superseded by authProviders)

  // true = one clean sign-in when the app opens, then you're in.
  // false = app works offline and sign-in is optional.
  requireAuth: true
};
