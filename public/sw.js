const CACHE='top-tier-v2';
const ASSETS=['/','/index.html','/styles.css','/logo.css','/app.js','/manifest.webmanifest','/top-tier-logo.png','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('fetch',event=>{
  if(event.request.url.includes('/api/'))return;
  event.respondWith(caches.match(event.request).then(found=>found||fetch(event.request)));
});
