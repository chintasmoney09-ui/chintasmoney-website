/* ============================================================================
   ChintasMoney — Google AdSense loader.
   TO SWITCH ADS ON: paste your AdSense publisher ID between the quotes below
   (it looks like "ca-pub-1234567890123456"), commit, and enable "Auto ads" in
   your AdSense dashboard. Ads then appear on the blog/learn pages only — never
   on the homepage or inside the app. Leave it empty and nothing loads.
   ========================================================================== */
var ADSENSE_CLIENT = ""; // <-- paste "ca-pub-XXXXXXXXXXXXXXXX" here

(function () {
  if (!ADSENSE_CLIENT || ADSENSE_CLIENT.indexOf("ca-pub-") !== 0) return;
  // Load the AdSense script (this alone powers Auto ads once enabled in the
  // AdSense dashboard). Also required for account/site verification.
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ADSENSE_CLIENT);
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
  // Optional manual ad units: any <div class="ad-slot" data-ad-slot="123..."></div>
  // in the page gets a responsive display ad. (Create the slot IDs in AdSense.)
  function fill() {
    var slots = document.querySelectorAll(".ad-slot");
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (slot.getAttribute("data-filled")) continue;
      var id = slot.getAttribute("data-ad-slot");
      if (!id) continue;
      slot.setAttribute("data-filled", "1");
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", ADSENSE_CLIENT);
      ins.setAttribute("data-ad-slot", id);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      slot.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    }
  }
  if (document.readyState !== "loading") fill(); else document.addEventListener("DOMContentLoaded", fill);
})();
