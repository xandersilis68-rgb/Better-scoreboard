const CACHE='vb-live-v1';
const ASSETS=[
  './','./index.html','./style.css','./app.js','./firebase-config.js','./manifest.webmanifest',
  './assets/icon-192.png','./assets/icon-512.png','./assets/maskable-512.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
