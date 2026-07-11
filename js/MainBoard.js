/* ============================================================
   MainBoard — Modus 2: Spielbetrieb / Hauptseite
   Category tiles + scoreboard
   ============================================================ */

const MainBoard = (function () {
    let root;
    let scoreEditMode = false;  // toggles the per-team +/- controls

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

        // Board-only "big scene": hazy double sun + dune silhouettes, the
        // main page's dramatic moment layered behind the content.
        const scene = document.createElement('div');
        scene.className = 'board-scene';
        scene.setAttribute('aria-hidden', 'true');
        scene.innerHTML = `
            <div class="haze-sun">
                <div class="ring r1"></div><div class="ring r2"></div>
                <div class="ring r3"></div><div class="ring r4"></div>
            </div>
            <svg class="dunes" viewBox="0 0 1200 190" preserveAspectRatio="none">
                <path d="M0,120 Q150,60 320,100 T650,90 T980,110 T1200,80 L1200,190 L0,190 Z" fill="rgba(20,16,31,0.5)"/>
                <path d="M0,150 Q200,100 420,140 T780,130 T1200,145 L1200,190 L0,190 Z" fill="rgba(20,16,31,0.8)"/>
            </svg>
        `;
        root.appendChild(scene);

        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';

        // --- Category grid (center) ---
        const gridSection = document.createElement('div');
        gridSection.className = 'board-grid-section';

        const heading = document.createElement('div');
        heading.className = 'board-heading';
        heading.innerHTML = `
            <h2 class="board-title">KATEGORIEN</h2>
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
        const exhausted = remaining === 0;
        const palette = TILE_PALETTE[idx % TILE_PALETTE.length];

        const tile = document.createElement('button');
        tile.className = 'category-tile' + (exhausted ? ' exhausted' : '');
        tile.style.setProperty('--tile-accent', palette.accent);
        tile.style.setProperty('--tile-glow', palette.glow);
        tile.style.setProperty('--tile-tint', palette.tint);

        // Public board: no remaining-count shown, only greyed out when done.
        tile.innerHTML = `
            <div class="tile-corner tl"></div>
            <div class="tile-corner br"></div>
            <div class="tile-icon">${escapeHtml(cat.icon || '★')}</div>
            <div class="tile-name">${escapeHtml(cat.name)}</div>
            ${exhausted ? '<div class="tile-lock">// ERLEDIGT</div>' : ''}
        `;

        if (!exhausted) {
            tile.addEventListener('click', () => {
                let questionIds;
                let mode;
                if (GameState.isRoundType(cat.type)) {
                    const qs = GameState.pickRoundQuestions(cat.id, GameState.ROUND_SIZE);
                    if (!qs.length) { render(); return; }
                    questionIds = qs.map(q => q.id);
                    mode = 'round';
                } else {
                    const q = GameState.pickRandomUnplayed(cat.id);
                    if (!q) { render(); return; }
                    questionIds = [q.id];
                    mode = 'single';
                }
                GameState.setCurrentPlay({ categoryId: cat.id, questionIds, mode });
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
        title.textContent = 'PUNKTETAFEL';
        side.appendChild(title);

        // Sort by score desc for dramatic effect
        const ranked = state.teams.slice().sort((a, b) => b.score - a.score);

        const list = document.createElement('div');
        list.className = 'score-list';

        ranked.forEach((team, idx) => {
            const av = state.avatars.find(a => a.id === team.avatarId);
            const row = document.createElement('div');
            row.className = 'score-row' + (scoreEditMode ? ' editing' : '');
            if (idx === 0 && team.score > 0) row.classList.add('leader');

            // The +/- controls only appear in edit mode.
            const adjust = scoreEditMode
                ? `<div class="score-adjust">
                        <button class="score-btn score-minus" title="Punkt abziehen">–</button>
                        <div class="score-points">${team.score}</div>
                        <button class="score-btn score-plus" title="Punkt hinzufügen">+</button>
                   </div>`
                : `<div class="score-points">${team.score}</div>`;
            row.innerHTML = `
                <div class="score-rank">${String(idx + 1).padStart(2, '0')}</div>
                <div class="score-avatar">${av ? '' : '?'}</div>
                <div class="score-name">${escapeHtml(team.name)}</div>
                ${adjust}
            `;
            if (av) MediaCache.applyBg(row.querySelector('.score-avatar'), av.mediaId);
            if (scoreEditMode) {
                row.querySelector('.score-minus').addEventListener('click', () => {
                    GameState.adjustTeamScore(team.id, -1);
                    render();
                });
                row.querySelector('.score-plus').addEventListener('click', () => {
                    GameState.adjustTeamScore(team.id, +1);
                    render();
                });
            }
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

        // Small bottom-right toggle to reveal/hide the per-team +/- controls.
        const editToggle = document.createElement('button');
        editToggle.className = 'score-edit-toggle' + (scoreEditMode ? ' active' : '');
        editToggle.textContent = scoreEditMode ? '✓ FERTIG' : 'Punktestand editieren';
        editToggle.addEventListener('click', () => {
            scoreEditMode = !scoreEditMode;
            render();
        });
        side.appendChild(editToggle);

        return side;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    return { init, render };
})();
