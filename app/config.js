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

  // Optional Google sign-in. Keep false until you enable the Google provider in
  // Supabase → Authentication → Providers → Google, then flip this to true.
  enableGoogle: false,

  // true = one clean sign-in when the app opens, then you're in.
  // false = app works offline and sign-in is optional.
  requireAuth: true
};
