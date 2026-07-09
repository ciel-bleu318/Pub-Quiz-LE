/* ============================================================
   main.js — entry point
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    // Warn early if the Cache API is unavailable (e.g. opened via file://
    // instead of a local server) — media storage depends on it.
    if (!MediaCache.isSupported()) {
        console.warn('MediaCache: Cache API nicht verfügbar. Bitte über http://localhost starten.');
    }
    // One-time migration of any legacy base64 media into MediaCache.
    try {
        await GameState.migrateMedia();
    } catch (e) {
        console.error('Media-Migration fehlgeschlagen', e);
    }
    // Drop any orphaned blobs left from earlier edits.
    try {
        await MediaCache.pruneExcept(GameState.collectMediaIds());
    } catch (e) { /* non-fatal */ }

    UIController.init();
});
