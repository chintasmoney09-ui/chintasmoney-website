/* Lightweight cookie/consent banner. Stores the choice in localStorage.
   Analytics / AdSense scripts should only load when window.cmConsent === "yes". */
(function () {
  var KEY = "cm_consent";
  try { window.cmConsent = localStorage.getItem(KEY) || ""; } catch (e) { window.cmConsent = ""; }
  if (window.cmConsent) return; // already chosen
  function build() {
    var bar = document.createElement("div");
    bar.className = "cookie-bar";
    bar.innerHTML =
      '<span class="cb-text">🍪 We use minimal cookies for basic analytics to improve ChintasMoney. See our <a href="/privacy.html">Privacy Policy</a>.</span>' +
      '<span class="cb-actions"><button class="cb-btn cb-no">Decline</button><button class="cb-btn cb-ok">Accept</button></span>';
    function done(v) { try { localStorage.setItem(KEY, v); } catch (e) {} window.cmConsent = v; try { window.dispatchEvent(new Event("cm-consent")); } catch (e2) {} if (bar.parentNode) bar.parentNode.removeChild(bar); }
    bar.querySelector(".cb-ok").addEventListener("click", function () { done("yes"); });
    bar.querySelector(".cb-no").addEventListener("click", function () { done("no"); });
    document.body.appendChild(bar);
  }
  if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
})();
