/* ============================================================
   UIController — top-level screen routing & nav
   ============================================================ */

const UIController = (function () {
    const screens = {};

    function init() {
        screens.setup    = document.getElementById('screen-setup');
        screens.main     = document.getElementById('screen-main');
        screens.question = document.getElementById('screen-question');

        // Nav buttons
        document.querySelectorAll('.nav-btn[data-screen]').forEach(btn => {
            btn.addEventListener('click', () => showScreen(btn.dataset.screen));
        });

        document.getElementById('reset-btn').addEventListener('click', async () => {
            if (confirm('ACHTUNG: Gesamten Spielstand und alle Daten löschen?')) {
                await MediaCache.clear();
                GameState.reset();
                location.reload();
            }
        });

        // Restore last screen
        const state = GameState.get();
        showScreen(state.currentScreen || 'setup');
    }

    function showScreen(name) {
        Object.entries(screens).forEach(([k, el]) => {
            el.classList.toggle('hidden', k !== name);
        });
        document.querySelectorAll('.nav-btn[data-screen]').forEach(b => {
            b.classList.toggle('active', b.dataset.screen === name);
        });

        switch (name) {
            case 'setup':    SetupManager.init(screens.setup); break;
            case 'main':     MainBoard.init(screens.main); break;
            case 'question': QuestionRenderer.init(screens.question); break;
        }

        GameState.setScreen(name);
        setStatus(name.toUpperCase() + ' AKTIV');
    }

    function setStatus(text) {
        const el = document.getElementById('footer-status');
        if (el) el.textContent = text;
    }

    return { init, showScreen, setStatus };
})();
