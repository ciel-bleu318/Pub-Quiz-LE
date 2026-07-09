/* ============================================================
   GameState — single source of truth, persisted to localStorage
   ============================================================ */

const GameState = (function () {
    const STORAGE_KEY = 'quizmaster.state.v1';

    const defaultState = () => ({
        version: 2,
        avatars: [],          // [{ id, mediaId }]  (media blob lives in MediaCache)
        teams: [],            // [{ id, name, avatarId, score }]
        categories: [],       // [{ id, name, icon, questions: [...] }]
        currentScreen: 'setup',
        currentQuestionRef: null, // { categoryId, questionId }
        gameStarted: false,
        settings: {
            showProgress: true,   // toggleable progress bar on main board
        },
    });

    let state = load();

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultState();
            const parsed = JSON.parse(raw);
            const merged = Object.assign(defaultState(), parsed);
            // Ensure nested settings object exists with all defaults
            merged.settings = Object.assign(defaultState().settings, parsed.settings || {});
            return merged;
        } catch (e) {
            console.warn('GameState: failed to load, resetting.', e);
            return defaultState();
        }
    }

    function updateSettings(patch) {
        state.settings = Object.assign({}, state.settings, patch);
        save();
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('GameState: save failed (quota?).', e);
            alert('SPEICHERN FEHLGESCHLAGEN — localStorage voll. Bilder/Audio reduzieren.');
        }
    }

    function reset() {
        state = defaultState();
        save();
    }

    function get() { return state; }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /* ---------- AVATARS ---------- */
    function addAvatar(mediaId) {
        const a = { id: uid(), mediaId };
        state.avatars.push(a);
        save();
        return a;
    }
    function removeAvatar(id) {
        state.avatars = state.avatars.filter(a => a.id !== id);
        // unassign from any team
        state.teams.forEach(t => { if (t.avatarId === id) t.avatarId = null; });
        save();
    }

    /* ---------- TEAMS ---------- */
    function addTeam() {
        if (state.teams.length >= 6) return null;
        const t = { id: uid(), name: 'Team ' + (state.teams.length + 1), avatarId: null, score: 0 };
        state.teams.push(t);
        save();
        return t;
    }
    function removeTeam(id) {
        state.teams = state.teams.filter(t => t.id !== id);
        save();
    }
    function updateTeam(id, patch) {
        const t = state.teams.find(x => x.id === id);
        if (t) { Object.assign(t, patch); save(); }
    }
    function addPointsToTeams(teamIds, points = 1) {
        teamIds.forEach(id => {
            const t = state.teams.find(x => x.id === id);
            if (t) t.score += points;
        });
        save();
    }

    /* ---------- CATEGORIES ---------- */
    function addCategory() {
        const c = {
            id: uid(),
            name: 'Neue Kategorie',
            icon: '🌌',
            questions: []
        };
        state.categories.push(c);
        save();
        return c;
    }
    function removeCategory(id) {
        state.categories = state.categories.filter(c => c.id !== id);
        save();
    }
    function updateCategory(id, patch) {
        const c = state.categories.find(x => x.id === id);
        if (c) { Object.assign(c, patch); save(); }
    }

    /* ---------- QUESTIONS ---------- */
    function addQuestion(categoryId, question) {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return null;
        question.id = uid();
        question.played = false;
        c.questions.push(question);
        save();
        return question;
    }
    function updateQuestion(categoryId, questionId, patch) {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return;
        const q = c.questions.find(x => x.id === questionId);
        if (q) { Object.assign(q, patch); save(); }
    }
    function removeQuestion(categoryId, questionId) {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return;
        c.questions = c.questions.filter(q => q.id !== questionId);
        save();
    }
    function markQuestionPlayed(categoryId, questionId) {
        updateQuestion(categoryId, questionId, { played: true });
    }
    function pickRandomUnplayed(categoryId) {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return null;
        const pool = c.questions.filter(q => !q.played);
        if (pool.length === 0) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /* ---------- SCREEN / FLOW ---------- */
    function setScreen(name) {
        state.currentScreen = name;
        save();
    }
    function setCurrentQuestionRef(ref) {
        state.currentQuestionRef = ref;
        save();
    }
    function startGame() {
        state.gameStarted = true;
        state.currentScreen = 'main';
        save();
    }

    /* ---------- VALIDATION ---------- */
    function validateForStart() {
        const errors = [];
        if (state.teams.length < 4) errors.push('Mindestens 4 Teams nötig.');
        if (state.teams.length > 6) errors.push('Maximal 6 Teams.');
        state.teams.forEach((t, i) => {
            if (!t.name.trim()) errors.push(`Team ${i + 1}: Name fehlt.`);
            if (!t.avatarId) errors.push(`Team ${i + 1}: Avatar fehlt.`);
        });
        if (state.categories.length === 0) errors.push('Mindestens 1 Kategorie nötig.');
        state.categories.forEach(c => {
            if (c.questions.length < 10) {
                errors.push(`Kategorie "${c.name}": ${c.questions.length}/10 Fragen.`);
            }
        });
        return errors;
    }

    /* ---------- MEDIA ---------- */
    // Every media id currently referenced anywhere in the state. Used to
    // prune orphaned blobs from MediaCache after edits/removals.
    function collectMediaIds() {
        const ids = [];
        state.avatars.forEach(a => { if (a.mediaId) ids.push(a.mediaId); });
        if (state.settings && state.settings.logoMediaId) ids.push(state.settings.logoMediaId);
        state.categories.forEach(c => c.questions.forEach(q => {
            if (Array.isArray(q.images)) q.images.forEach(m => { if (m) ids.push(m); });
            if (q.imageMediaId) ids.push(q.imageMediaId);
            if (q.audioMediaId) ids.push(q.audioMediaId);
        }));
        return ids;
    }

    // One-time migration from the old base64 schema (version 1) to
    // MediaCache-backed ids. Safe to run repeatedly — it only touches
    // fields still holding legacy data: URLs.
    async function migrateMedia() {
        if (typeof MediaCache === 'undefined' || !MediaCache.isSupported()) return;
        let changed = false;

        for (const a of state.avatars) {
            if (a.dataUrl && !a.mediaId) {
                try {
                    const blob = await MediaCache.dataUrlToBlob(a.dataUrl);
                    a.mediaId = await MediaCache.put(blob);
                    delete a.dataUrl;
                    changed = true;
                } catch (e) { console.warn('Avatar-Migration fehlgeschlagen', e); }
            }
        }

        for (const c of state.categories) {
            for (const q of c.questions) {
                // WhereAmI: images was an array of data URLs
                if (Array.isArray(q.images) && q.images.some(x => typeof x === 'string' && x.startsWith('data:'))) {
                    const newImages = [];
                    for (const img of q.images) {
                        if (typeof img === 'string' && img.startsWith('data:')) {
                            try {
                                const blob = await MediaCache.dataUrlToBlob(img);
                                newImages.push(await MediaCache.put(blob));
                            } catch (e) { console.warn('Bild-Migration fehlgeschlagen', e); }
                        } else if (img) {
                            newImages.push(img);
                        }
                    }
                    q.images = newImages;
                    changed = true;
                }
                // Barcode: imageDataUrl -> imageMediaId
                if (q.imageDataUrl) {
                    try {
                        const blob = await MediaCache.dataUrlToBlob(q.imageDataUrl);
                        q.imageMediaId = await MediaCache.put(blob);
                        delete q.imageDataUrl;
                        changed = true;
                    } catch (e) { console.warn('Barcode-Migration fehlgeschlagen', e); }
                }
                // Song: audioDataUrl -> audioMediaId
                if (q.audioDataUrl) {
                    try {
                        const blob = await MediaCache.dataUrlToBlob(q.audioDataUrl);
                        q.audioMediaId = await MediaCache.put(blob);
                        delete q.audioDataUrl;
                        changed = true;
                    } catch (e) { console.warn('Song-Migration fehlgeschlagen', e); }
                }
            }
        }

        if (changed) {
            state.version = 2;
            save();
        }
    }

    return {
        get, save, load, reset,
        addAvatar, removeAvatar,
        addTeam, removeTeam, updateTeam, addPointsToTeams,
        addCategory, removeCategory, updateCategory,
        addQuestion, updateQuestion, removeQuestion,
        markQuestionPlayed, pickRandomUnplayed,
        setScreen, setCurrentQuestionRef, startGame,
        validateForStart, updateSettings,
        collectMediaIds, migrateMedia,
    };
})();
