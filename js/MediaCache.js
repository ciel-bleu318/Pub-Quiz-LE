/* ============================================================
   MediaCache — binary media (images, audio) stored via the
   Cache API instead of base64 in localStorage.

   Why: localStorage is capped at ~5–10 MB per origin and base64
   inflates every byte by ~33%. The Cache API holds hundreds of MB
   of real Blobs. localStorage keeps only lightweight text/metadata
   plus short media ids that point into this cache.

   NOTE: The Cache API requires an http(s) origin — it does not work
   reliably from file://. The app must therefore be served over a
   local server (http://localhost). See README.
   ============================================================ */

const MediaCache = (function () {
    const CACHE_NAME = 'nebula.media.v1';
    // Synthetic same-origin path used only as a cache key. These URLs are
    // never fetched from the network — cache.match() only looks in the cache.
    const KEY_PREFIX = '/__nebula_media__/';

    // In-memory map: mediaId -> object URL. Object URLs live for the page
    // session; we cache them so repeated renders don't re-decode blobs.
    const objectUrls = new Map();

    function isSupported() {
        return typeof caches !== 'undefined';
    }

    function keyToUrl(id) {
        return KEY_PREFIX + encodeURIComponent(id);
    }

    function genId() {
        return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    async function open() {
        return caches.open(CACHE_NAME);
    }

    /* Store a Blob/File; returns a fresh media id. */
    async function put(blob) {
        if (!isSupported()) throw new Error('Cache API nicht verfügbar (bitte über http://localhost starten).');
        const id = genId();
        const cache = await open();
        await cache.put(keyToUrl(id), new Response(blob));
        return id;
    }

    /* Store under a caller-chosen id (used by migration). */
    async function putWithId(id, blob) {
        const cache = await open();
        await cache.put(keyToUrl(id), new Response(blob));
        if (objectUrls.has(id)) {
            URL.revokeObjectURL(objectUrls.get(id));
            objectUrls.delete(id);
        }
        return id;
    }

    /* Resolve a media id to a usable object URL (or null if missing). */
    async function resolve(id) {
        if (!id) return null;
        if (objectUrls.has(id)) return objectUrls.get(id);
        if (!isSupported()) return null;
        const cache = await open();
        const resp = await cache.match(keyToUrl(id));
        if (!resp) return null;
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        objectUrls.set(id, url);
        return url;
    }

    /* Fetch the raw Blob (used e.g. for audio playback). */
    async function getBlob(id) {
        if (!id || !isSupported()) return null;
        const cache = await open();
        const resp = await cache.match(keyToUrl(id));
        return resp ? await resp.blob() : null;
    }

    async function remove(id) {
        if (!id || !isSupported()) return;
        const cache = await open();
        await cache.delete(keyToUrl(id));
        if (objectUrls.has(id)) {
            URL.revokeObjectURL(objectUrls.get(id));
            objectUrls.delete(id);
        }
    }

    /* Delete every cached blob whose id is not in `keepIds`.
       Sweeps orphans left behind when media is replaced during an edit. */
    async function pruneExcept(keepIds) {
        if (!isSupported()) return;
        const keep = new Set(keepIds || []);
        const cache = await open();
        const reqs = await cache.keys();
        await Promise.all(reqs.map(async (req) => {
            const path = new URL(req.url).pathname;
            if (!path.startsWith(KEY_PREFIX)) return;
            const id = decodeURIComponent(path.slice(KEY_PREFIX.length));
            if (!keep.has(id)) {
                await cache.delete(req);
                if (objectUrls.has(id)) {
                    URL.revokeObjectURL(objectUrls.get(id));
                    objectUrls.delete(id);
                }
            }
        }));
    }

    async function clear() {
        if (isSupported()) await caches.delete(CACHE_NAME);
        for (const url of objectUrls.values()) URL.revokeObjectURL(url);
        objectUrls.clear();
    }

    /* Convenience DOM helpers — async but fire-and-forget at call sites;
       the element fills in once the blob resolves. */
    async function applyBg(el, id) {
        if (!el || !id) return;
        const url = await resolve(id);
        if (url) el.style.backgroundImage = `url("${url}")`;
    }
    async function applySrc(imgEl, id) {
        if (!imgEl || !id) return;
        const url = await resolve(id);
        if (url) imgEl.src = url;
    }

    /* Convert a data: URL (legacy base64) to a Blob for migration. */
    async function dataUrlToBlob(dataUrl) {
        const resp = await fetch(dataUrl);
        return await resp.blob();
    }

    /* Convert a <canvas> to a Blob (used by the barcode builder). */
    function canvasToBlob(canvas, type = 'image/png', quality) {
        return new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), type, quality);
        });
    }

    return {
        isSupported,
        put, putWithId, resolve, getBlob, remove, pruneExcept, clear,
        applyBg, applySrc, dataUrlToBlob, canvasToBlob,
    };
})();
