/* ChintasMoney — Google Analytics 4 (consent-gated).
   GA loads ONLY after the visitor accepts cookies (window.cmConsent === "yes"),
   set by consent.js. Nothing is sent to Google before that. */
(function () {
  var GA_ID = "G-KDMXZ06NPX";
  var loaded = false;
  function load() {
    if (loaded || window.cmConsent !== "yes") return;
    loaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", GA_ID, { anonymize_ip: true });
  }
  if (window.cmConsent === "yes") load();
  // consent.js dispatches this when the visitor clicks Accept.
  window.addEventListener("cm-consent", load);
})();
