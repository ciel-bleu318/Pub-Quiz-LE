/* ============================================================
   MainBoard — Modus 2: Spielbetrieb / Hauptseite
   Category tiles + scoreboard
   ============================================================ */

const MainBoard = (function () {
    let root;

    // Color rotation for category tiles (Moebius palette)
    const TILE_PALETTE = [
        { accent: 'var(--turquoise)', glow: 'var(--glow-turquoise)', tint: 'rgba(79,240,212,0.08)' },
        { accent: 'var(--orange)',    glow: 'var(--glow-orange)',    tint: 'rgba(255,138,61,0.08)' },
        { accent: 'var(--violet)',    glow: 'var(--glow-violet)',    tint: 'rgba(181,108,255,0.08)' },
        { accent: 'var(--gold)',      glow: 'var(--glow-gold)',      tint: 'rgba(255,206,92,0.08)' },
        { accent: 'var(--pink)',      glow: '0 0 8px rgba(255,92,168,0.5), 0 0 22px rgba(255,92,168,0.25)', tint: 'rgba(255,92,168,0.08)' },
    ];

    function init(rootEl) {
        root = rootEl;
        render();
    }

    function render() {
        const state = GameState.get();
        root.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';

        // --- Category grid (center) ---
        const gridSection = document.createElement('div');
        gridSection.className = 'board-grid-section';

        const heading = document.createElement('div');
        heading.className = 'board-heading';
        heading.innerHTML = `
            <h2 class="board-title">// KATEGORIEN</h2>
            <span class="board-sub">Kategorie wählen → zufällige Frage ziehen</span>
        `;
        gridSection.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'category-grid';

        if (state.categories.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'board-empty';
            empty.textContent = 'Keine Kategorien definiert. Wechsle zum SETUP.';
            gridSection.appendChild(empty);
        } else {
            state.categories.forEach((cat, idx) => {
                grid.appendChild(buildCategoryTile(cat, idx));
            });
            gridSection.appendChild(grid);
        }

        wrap.appendChild(gridSection);

        // --- Scoreboard (side) ---
        wrap.appendChild(buildScoreboard(state));

        root.appendChild(wrap);
    }

    function buildCategoryTile(cat, idx) {
        const remaining = cat.questions.filter(q => !q.played).length;
        const total = cat.questions.length;
        const exhausted = remaining === 0;
        const palette = TILE_PALETTE[idx % TILE_PALETTE.length];

        const tile = document.createElement('button');
        tile.className = 'category-tile' + (exhausted ? ' exhausted' : '');
        tile.style.setProperty('--tile-accent', palette.accent);
        tile.style.setProperty('--tile-glow', palette.glow);
        tile.style.setProperty('--tile-tint', palette.tint);

        tile.innerHTML = `
            <div class="tile-corner tl"></div>
            <div class="tile-corner br"></div>
            <div class="tile-icon">${escapeHtml(cat.icon || '★')}</div>
            <div class="tile-name">${escapeHtml(cat.name)}</div>
            <div class="tile-meta">${remaining} / ${total} OFFEN</div>
            ${exhausted ? '<div class="tile-lock">// ERLEDIGT</div>' : ''}
        `;

        if (!exhausted) {
            tile.addEventListener('click', () => {
                const q = GameState.pickRandomUnplayed(cat.id);
                if (!q) { render(); return; }
                GameState.setCurrentQuestionRef({ categoryId: cat.id, questionId: q.id });
                UIController.showScreen('question');
            });
        } else {
            tile.disabled = true;
        }

        return tile;
    }

    function buildScoreboard(state) {
        const side = document.createElement('aside');
        side.className = 'scoreboard';

        const title = document.createElement('h2');
        title.className = 'board-title';
        title.textContent = '// PUNKTETAFEL';
        side.appendChild(title);

        // Sort by score desc for dramatic effect
        const ranked = state.teams.slice().sort((a, b) => b.score - a.score);

        const list = document.createElement('div');
        list.className = 'score-list';

        ranked.forEach((team, idx) => {
            const av = state.avatars.find(a => a.id === team.avatarId);
            const row = document.createElement('div');
            row.className = 'score-row';
            if (idx === 0 && team.score > 0) row.classList.add('leader');

            row.innerHTML = `
                <div class="score-rank">${String(idx + 1).padStart(2, '0')}</div>
                <div class="score-avatar">${av ? '' : '?'}</div>
                <div class="score-name">${escapeHtml(team.name)}</div>
                <div class="score-points">${team.score}</div>
            `;
            if (av) MediaCache.applyBg(row.querySelector('.score-avatar'), av.mediaId);
            list.appendChild(row);
        });

        side.appendChild(list);

        // Footer status (optional)
        if (state.settings && state.settings.showProgress !== false) {
            const totalRemaining = state.categories.reduce(
                (sum, c) => sum + c.questions.filter(q => !q.played).length, 0
            );
            const totalQuestions = state.categories.reduce((sum, c) => sum + c.questions.length, 0);
            const played = totalQuestions - totalRemaining;

            const footer = document.createElement('div');
            footer.className = 'score-footer';
            footer.innerHTML = `
                <div class="score-footer-line">
                    <span>FORTSCHRITT</span>
                    <span class="score-footer-num">${played} / ${totalQuestions}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${totalQuestions ? (played / totalQuestions * 100) : 0}%"></div>
                </div>
            `;
            side.appendChild(footer);
        }

        return side;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    return { init, render };
})();
