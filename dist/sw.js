self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // 最小限のパススルー（PWAインストール要件を満たすため）
    e.respondWith(fetch(e.request));
});
