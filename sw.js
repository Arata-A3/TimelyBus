// オフライン対応用の Service Worker。
// index.html から sw.js?v=<APP_VERSION> で登録されるので、APP_VERSION を上げると保存データが入れ替わる。

const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'timelybus-' + VERSION;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

// 初回に端末へ保存するファイル（PDFを追加・変更したら index.html の PDF_FILES と合わせてここも直す）
const PRECACHE = [
    './',
    './icon.png',
    './manifest.webmanifest',
    './pdf/a1_naruto_weekday.pdf',
    './pdf/a2_naruto_weekend.pdf',
    './pdf/b19_bypassnaruto.pdf',
    './pdf/b21_rohmonnaruto.pdf',
    PDFJS + 'pdf.min.js',
    PDFJS + 'pdf.worker.min.js'
];

// 電波が弱いときにページの読み込みを待ちすぎないよう、この時間で保存済みの版に切り替える
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // 1つ失敗しても残りは保存する
        await Promise.all(PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('timelybus-') && k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req, './'));
    } else if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(req));
    } else if (url.href.startsWith(PDFJS)) {
        event.respondWith(cacheFirst(req));
    } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(req));
    }
});

// ページ本体: 最新版を優先し、つながらない・遅いときは保存済みの版を返す
async function networkFirst(req, fallbackKey) {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then(res => {
        if (res.ok) cache.put(fallbackKey, res.clone());
        return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
    } catch (e) { /* オフライン */ }
    const cached = await cache.match(fallbackKey);
    return cached || network;
}

// PDF・アイコンなど: 保存済みをすぐ返し、裏で最新版に更新する
async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
}

// PDF.js（バージョン固定なので変わらない）
async function cacheFirst(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
}
