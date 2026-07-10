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

        document.getElementById('reset-progress-btn').addEventListener('click', () => {
            if (confirm('Neue Runde starten? Alle Punkte werden auf 0 gesetzt und alle Fragen wieder als offen markiert. Teams, Kategorien, Fragen und Medien bleiben erhalten.')) {
                GameState.resetProgress();
                showScreen('main');
            }
        });

        document.getElementById('reset-btn').addEventListener('click', async () => {
            if (confirm('ACHTUNG: Wirklich ALLES löschen — Teams, Kategorien, Fragen, Bilder, Audio, Logo? Das kann nicht rückgängig gemacht werden.')) {
                await MediaCache.clear();
                GameState.reset();
                location.reload();
            }
        });

        updateHeaderLogo();

        // Restore last screen
        const state = GameState.get();
        showScreen(state.currentScreen || 'setup');
    }

    // Reflect the custom logo (settings.logoMediaId) into the header emblem.
    function updateHeaderLogo() {
        const el = document.getElementById('header-logo');
        if (!el) return;
        const logoId = GameState.get().settings.logoMediaId;
        if (logoId) {
            el.classList.add('has-custom-logo');
            MediaCache.applyBg(el, logoId);
        } else {
            el.classList.remove('has-custom-logo');
            el.style.backgroundImage = '';
        }
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

    return { init, showScreen, setStatus, updateHeaderLogo };
})();
