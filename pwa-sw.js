/* Minimal root service worker — its only job is to make the site installable
   (Android's install prompt requires a registered SW at this scope). It does
   not cache anything; requests pass straight through to the network. The app
   itself (/app/) has its own full offline service worker. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () { /* network passthrough */ });
