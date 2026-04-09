/* ============================================================
   GameState — single source of truth, persisted to localStorage
   ============================================================ */

const GameState = (function () {
    const STORAGE_KEY = 'quizmaster.state.v1';

    const defaultState = () => ({
        version: 1,
        avatars: [],          // [{ id, dataUrl }]
        teams: [],            // [{ id, name, avatarId, score }]
        categories: [],       // [{ id, name, icon, questions: [...] }]
        currentScreen: 'setup',
        currentQuestionRef: null, // { categoryId, questionId }
        gameStarted: false,
    });

    let state = load();

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultState();
            const parsed = JSON.parse(raw);
            return Object.assign(defaultState(), parsed);
        } catch (e) {
            console.warn('GameState: failed to load, resetting.', e);
            return defaultState();
        }
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
    function addAvatar(dataUrl) {
        const a = { id: uid(), dataUrl };
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

    return {
        get, save, load, reset,
        addAvatar, removeAvatar,
        addTeam, removeTeam, updateTeam, addPointsToTeams,
        addCategory, removeCategory, updateCategory,
        addQuestion, updateQuestion, removeQuestion,
        markQuestionPlayed, pickRandomUnplayed,
        setScreen, setCurrentQuestionRef, startGame,
        validateForStart,
    };
})();
