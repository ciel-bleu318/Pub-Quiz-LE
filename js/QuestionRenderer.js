/* ============================================================
   QuestionRenderer — Modus 3: Frageseite

   Two play modes:
   - single : one question (whereami / barcode, and any type when only
              one is drawn). Sequential media reveal, answer reveal,
              single-award scoring.
   - round  : 3 questions at once (standard / song). Teams answer all
              three on paper, no reveal in between; combined reveal at the
              end, then a Team × Frage points matrix.
   ============================================================ */

const QuestionRenderer = (function () {
    let root;
    let category = null;
    let questions = [];       // 1 (single) or up to 3 (round)
    let mode = 'single';

    // Shared reveal state
    let answerRevealed = false;

    // Single-mode per-type state
    let revealedStep = 0;     // whereami: which image index is current
    let selectedOption = -1;  // barcode selected choice
    let selectedTeams = new Set();

    // Round-mode state
    let roundRevealed = 1;    // how many of the round's questions are shown
    let roundScores = {};     // { [questionId]: Set(teamId) }

    // Audio / YT runtime (shared; only one plays at a time)
    let audioEl = null;
    let ytPlayer = null;
    let ytStopTimer = null;
    let songResetFn = null;   // resets the currently-active song player's UI

    /* ============================================================
       INIT / TOP-LEVEL RENDER
       ============================================================ */
    function init(rootEl) {
        root = rootEl;
        const play = GameState.get().currentPlay;
        if (!play) {
            root.innerHTML = '<p style="color:var(--text-dim); padding:40px;">// KEINE FRAGE GEWÄHLT — zurück zum Spiel.</p>';
            return;
        }
        const state = GameState.get();
        category = state.categories.find(c => c.id === play.categoryId);
        questions = (play.questionIds || [])
            .map(id => category?.questions.find(q => q.id === id))
            .filter(Boolean);
        if (!category || questions.length === 0) {
            root.innerHTML = '<p style="color:var(--text-dim); padding:40px;">// FRAGE NICHT GEFUNDEN.</p>';
            return;
        }
        mode = play.mode || (questions.length > 1 ? 'round' : 'single');

        // Reset runtime
        answerRevealed = false;
        revealedStep = 0;
        selectedOption = -1;
        selectedTeams = new Set();
        roundRevealed = 1;
        roundScores = {};
        questions.forEach(q => { roundScores[q.id] = new Set(); });
        stopAllMedia();

        render();
    }

    function render() {
        root.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'q-wrap';

        // Top bar
        const topBar = document.createElement('div');
        topBar.className = 'q-topbar';
        const roundBadge = (mode === 'round')
            ? `<div class="q-round-badge">RUNDE · ${questions.length} FRAGEN</div>` : '';
        topBar.innerHTML = `
            <button class="btn btn-secondary" id="q-back">◂ ZURÜCK</button>
            <div class="q-cat-badge">
                <span class="q-cat-icon">${escapeHtml(category.icon || '★')}</span>
                <span class="q-cat-name">${escapeHtml(category.name)}</span>
            </div>
            <div class="q-type-tag qt-${category.type}">${typeLabel(category.type)}</div>
            ${roundBadge}
        `;
        wrap.appendChild(topBar);

        // Body (mode-specific). Attach the tree to the DOM *before* rendering
        // bodies — the per-type renderers query via root.querySelector during
        // build (e.g. #bc-choices, #wa-stage), which requires it to be attached.
        const body = document.createElement('div');
        body.className = 'q-body';
        wrap.appendChild(body);
        root.appendChild(wrap);

        if (mode === 'round') renderRoundBody(body);
        else renderSingleBody(body);

        document.getElementById('q-back').addEventListener('click', () => {
            stopAllMedia();
            UIController.showScreen('main');
        });
    }

    /* ============================================================
       SINGLE MODE
       ============================================================ */
    function renderSingleBody(body) {
        const q = questions[0];

        const stage = document.createElement('div');
        stage.className = 'q-stage';
        body.appendChild(stage);
        switch (q.type) {
            case 'standard': stage.appendChild(buildStandardStage(q)); break;
            case 'whereami': renderWhereAmI(stage, q); break;
            case 'barcode':  renderBarcode(stage, q); break;
            case 'song':     stage.appendChild(buildSongPlayer(q)); break;
        }

        const answerArea = document.createElement('div');
        answerArea.className = 'q-answer-area';
        body.appendChild(answerArea);

        const scoringArea = document.createElement('div');
        scoringArea.className = 'q-scoring';
        body.appendChild(scoringArea);

        renderSingleAnswer(answerArea, scoringArea, q);
    }

    function renderSingleAnswer(answerArea, scoringArea, q) {
        answerArea.innerHTML = '';
        if (!answerRevealed) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary big';
            btn.textContent = '★ ANTWORT AUFDECKEN';
            btn.onclick = () => {
                answerRevealed = true;
                stopAllMedia();
                if (q.type === 'barcode') {
                    root.querySelectorAll('.barcode-choice').forEach((b, idx) => {
                        b.classList.toggle('correct', idx === q.correctIndex);
                        if (selectedOption === idx && idx !== q.correctIndex) b.classList.add('wrong');
                    });
                }
                if (q.type === 'whereami') {
                    revealedStep = (q.images || []).length - 1;
                    refreshWhereAmI(q);
                }
                renderSingleAnswer(answerArea, scoringArea, q);
            };
            answerArea.appendChild(btn);
        } else {
            answerArea.appendChild(buildAnswerReveal(q.answer));
            renderSingleScoring(scoringArea);
        }
    }

    function renderSingleScoring(area) {
        area.innerHTML = '';
        const state = GameState.get();

        const title = document.createElement('div');
        title.className = 'scoring-title';
        title.textContent = '// PUNKTE VERGEBEN — Teams anklicken (Mehrfachauswahl)';
        area.appendChild(title);

        const tilesWrap = document.createElement('div');
        tilesWrap.className = 'scoring-tiles';
        state.teams.forEach(team => {
            const av = state.avatars.find(a => a.id === team.avatarId);
            const tile = document.createElement('button');
            tile.className = 'scoring-tile' + (selectedTeams.has(team.id) ? ' selected' : '');
            tile.innerHTML = `
                <div class="scoring-avatar">${av ? '' : '?'}</div>
                <div class="scoring-name">${escapeHtml(team.name)}</div>
                <div class="scoring-score">${team.score} PKT</div>
                <div class="scoring-check">+1</div>
            `;
            if (av) MediaCache.applyBg(tile.querySelector('.scoring-avatar'), av.mediaId);
            tile.onclick = () => {
                if (selectedTeams.has(team.id)) selectedTeams.delete(team.id);
                else selectedTeams.add(team.id);
                renderSingleScoring(area);
            };
            tilesWrap.appendChild(tile);
        });
        area.appendChild(tilesWrap);

        const actions = document.createElement('div');
        actions.className = 'scoring-actions';
        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn';
        skipBtn.textContent = 'KEINE PUNKTE · ZURÜCK';
        skipBtn.onclick = () => {
            finishPlay();
        };
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = `✓ ${selectedTeams.size} TEAM(S) · +1 PUNKT → ZURÜCK`;
        confirmBtn.disabled = selectedTeams.size === 0;
        confirmBtn.onclick = () => {
            if (selectedTeams.size > 0) GameState.addPointsToTeams(Array.from(selectedTeams), 1);
            finishPlay();
        };
        actions.appendChild(skipBtn);
        actions.appendChild(confirmBtn);
        area.appendChild(actions);
    }

    /* ============================================================
       ROUND MODE
       ============================================================ */
    function renderRoundBody(body) {
        body.innerHTML = '';

        // Stage: revealed questions stacked
        const stage = document.createElement('div');
        stage.className = 'q-stage round-stage';
        body.appendChild(stage);
        for (let i = 0; i < roundRevealed && i < questions.length; i++) {
            stage.appendChild(buildRoundItem(questions[i], i));
        }

        // Controls: reveal next question, or reveal all answers
        const controls = document.createElement('div');
        controls.className = 'q-answer-area';
        body.appendChild(controls);

        if (roundRevealed < questions.length) {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'btn btn-secondary big';
            nextBtn.textContent = `▸ NÄCHSTE FRAGE (${roundRevealed + 1}/${questions.length})`;
            nextBtn.onclick = () => { roundRevealed++; renderRoundBody(body); };
            controls.appendChild(nextBtn);
        } else if (!answerRevealed) {
            const revealBtn = document.createElement('button');
            revealBtn.className = 'btn btn-primary big';
            revealBtn.textContent = '★ ALLE ANTWORTEN AUFDECKEN';
            revealBtn.onclick = () => {
                answerRevealed = true;
                stopAllMedia();
                renderRoundBody(body);
            };
            controls.appendChild(revealBtn);
        } else {
            // Combined answers
            const answersWrap = document.createElement('div');
            answersWrap.className = 'round-answers';
            questions.forEach((q, i) => {
                const row = document.createElement('div');
                row.className = 'round-answer-row';
                row.innerHTML = `
                    <span class="round-answer-num">F${i + 1}</span>
                    <span class="round-answer-text">${escapeHtml(q.answer)}</span>
                `;
                answersWrap.appendChild(row);
            });
            controls.appendChild(answersWrap);
        }

        // Scoring matrix (once revealed)
        const scoring = document.createElement('div');
        scoring.className = 'q-scoring';
        body.appendChild(scoring);
        if (answerRevealed) renderRoundMatrix(scoring);
    }

    function buildRoundItem(q, idx) {
        const item = document.createElement('div');
        item.className = 'round-item';
        const label = document.createElement('div');
        label.className = 'round-item-label';
        label.textContent = `FRAGE ${idx + 1}`;
        item.appendChild(label);

        if (q.type === 'song') {
            item.appendChild(buildSongPlayer(q));
        } else {
            // standard (and any other prompt-based type) — optional image
            if (q.imageMediaId) {
                const img = document.createElement('img');
                img.className = 'round-item-img';
                img.alt = '';
                MediaCache.applySrc(img, q.imageMediaId);
                item.appendChild(img);
            }
            const prompt = document.createElement('div');
            prompt.className = 'q-prompt round-prompt';
            prompt.textContent = q.question;
            item.appendChild(prompt);
        }
        return item;
    }

    function renderRoundMatrix(area) {
        area.innerHTML = '';
        const state = GameState.get();

        const title = document.createElement('div');
        title.className = 'scoring-title';
        title.textContent = '// PUNKTE-MATRIX — pro Frage die richtigen Teams abhaken';
        area.appendChild(title);

        const table = document.createElement('div');
        table.className = 'points-matrix';
        table.style.setProperty('--matrix-cols', questions.length);

        // Header row
        const head = document.createElement('div');
        head.className = 'matrix-row matrix-head';
        head.appendChild(cell('matrix-team-head', 'TEAM'));
        questions.forEach((q, i) => head.appendChild(cell('matrix-col-head', `F${i + 1}`)));
        head.appendChild(cell('matrix-total-head', 'Σ'));
        table.appendChild(head);

        // Team rows
        state.teams.forEach(team => {
            const av = state.avatars.find(a => a.id === team.avatarId);
            const row = document.createElement('div');
            row.className = 'matrix-row';

            const teamCell = document.createElement('div');
            teamCell.className = 'matrix-team';
            teamCell.innerHTML = `
                <div class="matrix-avatar">${av ? '' : '?'}</div>
                <div class="matrix-name">${escapeHtml(team.name)}</div>
            `;
            if (av) MediaCache.applyBg(teamCell.querySelector('.matrix-avatar'), av.mediaId);
            row.appendChild(teamCell);

            const totalCell = document.createElement('div');
            totalCell.className = 'matrix-total';

            function refreshTotal() {
                const n = questions.reduce((sum, q) => sum + (roundScores[q.id].has(team.id) ? 1 : 0), 0);
                totalCell.textContent = '+' + n;
            }

            questions.forEach(q => {
                const c = document.createElement('button');
                c.className = 'matrix-cell';
                const on = roundScores[q.id].has(team.id);
                c.classList.toggle('on', on);
                c.textContent = on ? '✓' : '';
                c.onclick = () => {
                    if (roundScores[q.id].has(team.id)) roundScores[q.id].delete(team.id);
                    else roundScores[q.id].add(team.id);
                    const nowOn = roundScores[q.id].has(team.id);
                    c.classList.toggle('on', nowOn);
                    c.textContent = nowOn ? '✓' : '';
                    refreshTotal();
                };
                row.appendChild(c);
            });

            row.appendChild(totalCell);
            refreshTotal();
            table.appendChild(row);
        });
        area.appendChild(table);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'scoring-actions';
        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn';
        skipBtn.textContent = 'KEINE PUNKTE · ZURÜCK';
        skipBtn.onclick = () => finishPlay();
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = 'PUNKTE VERGEBEN → ZURÜCK';
        confirmBtn.onclick = () => {
            questions.forEach(q => {
                const ids = Array.from(roundScores[q.id]);
                if (ids.length) GameState.addPointsToTeams(ids, 1);
            });
            finishPlay();
        };
        actions.appendChild(skipBtn);
        actions.appendChild(confirmBtn);
        area.appendChild(actions);
    }

    function cell(cls, text) {
        const d = document.createElement('div');
        d.className = cls;
        d.textContent = text;
        return d;
    }

    /* ============================================================
       SHARED STAGE BUILDERS
       ============================================================ */
    function buildStandardStage(q) {
        const el = document.createElement('div');
        el.className = 'q-standard';
        let html = '';
        if (q.imageMediaId) html += `<img class="q-standard-img" alt="">`;
        html += `<div class="q-prompt">${escapeHtml(q.question)}</div>`;
        el.innerHTML = html;
        if (q.imageMediaId) MediaCache.applySrc(el.querySelector('.q-standard-img'), q.imageMediaId);
        return el;
    }

    function buildAnswerReveal(answer) {
        const reveal = document.createElement('div');
        reveal.className = 'answer-reveal';
        reveal.innerHTML = `
            <span class="reveal-label">// AUFLÖSUNG</span>
            <div class="reveal-text">${escapeHtml(answer)}</div>
        `;
        return reveal;
    }

    /* ---------- WHERE AM I (single only) ---------- */
    function renderWhereAmI(stage, q) {
        stage.innerHTML = `
            <div class="q-whereami">
                <div class="whereami-stage" id="wa-stage"></div>
                <div class="whereami-controls" id="wa-controls"></div>
            </div>
        `;
        refreshWhereAmI(q);
    }

    function refreshWhereAmI(q) {
        const imgs = q.images || [];
        const hints = q.hints || [];
        const stageEl = root.querySelector('#wa-stage');
        const controlsEl = root.querySelector('#wa-controls');

        stageEl.innerHTML = '';
        for (let i = 0; i <= revealedStep && i < imgs.length; i++) {
            const block = document.createElement('div');
            block.className = 'wa-block' + (i === revealedStep ? ' current' : '');
            block.innerHTML = `
                <div class="wa-block-label">BILD ${String(i + 1).padStart(2, '0')}</div>
                <img alt="">
                ${i > 0 && hints[i - 1] ? `<div class="wa-hint">TIPP // ${escapeHtml(hints[i - 1])}</div>` : ''}
            `;
            MediaCache.applySrc(block.querySelector('img'), imgs[i]);
            stageEl.appendChild(block);
        }

        controlsEl.innerHTML = '';
        if (revealedStep < imgs.length - 1) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary big';
            btn.textContent = `▸ BILD ${revealedStep + 2} AUFDECKEN`;
            btn.onclick = () => { revealedStep++; refreshWhereAmI(q); };
            controlsEl.appendChild(btn);
        }
    }

    /* ---------- MOVIE BARCODE (single only) ---------- */
    function renderBarcode(stage, q) {
        stage.innerHTML = `
            <div class="q-barcode">
                <div class="barcode-display">
                    <img alt="Movie Barcode">
                </div>
                <div class="barcode-choices" id="bc-choices"></div>
            </div>
        `;
        MediaCache.applySrc(stage.querySelector('.barcode-display img'), q.imageMediaId);
        const choices = root.querySelector('#bc-choices');
        q.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'barcode-choice';
            btn.innerHTML = `
                <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
                <span class="choice-text">${escapeHtml(opt)}</span>
            `;
            btn.onclick = () => {
                selectedOption = i;
                root.querySelectorAll('.barcode-choice').forEach((b, idx) => {
                    b.classList.toggle('selected', idx === i);
                    if (answerRevealed) {
                        b.classList.toggle('correct', idx === q.correctIndex);
                        b.classList.toggle('wrong', idx === i && idx !== q.correctIndex);
                    }
                });
            };
            choices.appendChild(btn);
        });
    }

    /* ---------- RATE DEN SONG (reusable player) ---------- */
    // Resolve a song's clip window with backward compatibility: newer questions
    // carry absolute startAt/stopAt; older ones only had stopAfter (from 0).
    function songTiming(q) {
        const startAt = Math.max(0, q.startAt ?? 0);
        let stopAt = q.stopAt;
        if (stopAt == null) stopAt = startAt + (q.stopAfter != null ? q.stopAfter : 20);
        const duration = Math.max(1, Math.round(stopAt - startAt));
        return { startAt, stopAt, duration };
    }

    function fmtClock(sec) {
        sec = Math.max(0, Math.round(sec));
        return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }

    function buildSongPlayer(q) {
        const el = document.createElement('div');
        el.className = 'q-song';
        const t = songTiming(q);
        const rangeLabel = t.startAt > 0
            ? `AUSSCHNITT ${fmtClock(t.startAt)}–${fmtClock(t.stopAt)} · ${t.duration}s`
            : `AUTO-STOP NACH ${t.duration}s`;
        el.innerHTML = `
            <div class="song-visual">
                <div class="song-disc">
                    <div class="song-disc-inner"></div>
                    <div class="song-disc-hole"></div>
                </div>
                <div class="song-waves"><span></span><span></span><span></span><span></span><span></span></div>
            </div>
            <div class="song-controls"></div>
            <div class="yt-host yt-hidden"></div>
            <div class="song-status">BEREIT · ${rangeLabel}</div>
        `;
        const els = {
            playBtn: null,
            statusEl: el.querySelector('.song-status'),
            visual: el.querySelector('.song-visual'),
            ytHost: el.querySelector('.yt-host'),
        };
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-primary big';
        playBtn.textContent = '▶ PLAY';
        els.playBtn = playBtn;
        playBtn.onclick = () => playSong(q, els);
        el.querySelector('.song-controls').appendChild(playBtn);
        return el;
    }

    function playSong(q, els) {
        // Reset any previously-active player and stop its media first.
        if (songResetFn) songResetFn();
        stopAllMedia();

        const { playBtn, statusEl, visual, ytHost } = els;
        const { startAt, duration } = songTiming(q);
        playBtn.disabled = true;
        playBtn.textContent = '■ LÄUFT';
        visual.classList.add('playing');

        let elapsed = 0;
        const tick = setInterval(() => {
            elapsed++;
            const remaining = Math.max(0, duration - elapsed);
            statusEl.textContent = `WIEDERGABE · NOCH ${remaining}s`;
            if (remaining <= 0) clearInterval(tick);
        }, 1000);

        const finish = () => {
            clearInterval(tick);
            statusEl.textContent = 'GESTOPPT';
            visual.classList.remove('playing');
            playBtn.disabled = false;
            playBtn.textContent = '↻ ERNEUT';
            playBtn.onclick = () => playSong(q, els);
        };
        songResetFn = finish;

        if (q.audioMediaId) {
            MediaCache.resolve(q.audioMediaId).then(url => {
                if (!url) { statusEl.textContent = 'AUDIO NICHT GEFUNDEN'; playBtn.disabled = false; clearInterval(tick); return; }
                audioEl = new Audio(url);
                const seekAndPlay = () => {
                    try { audioEl.currentTime = startAt; } catch (e) {}
                    audioEl.play().catch(err => { statusEl.textContent = 'AUDIO-FEHLER: ' + err.message; });
                };
                if (startAt > 0) audioEl.addEventListener('loadedmetadata', seekAndPlay, { once: true });
                else seekAndPlay();
                ytStopTimer = setTimeout(() => {
                    if (audioEl) { audioEl.pause(); audioEl = null; }
                    finish();
                }, duration * 1000);
            });
        } else if (q.youtubeUrl) {
            const videoId = extractYouTubeId(q.youtubeUrl);
            if (!videoId) { statusEl.textContent = 'UNGÜLTIGER YOUTUBE-LINK'; playBtn.disabled = false; clearInterval(tick); return; }
            loadYouTubeAPI().then(() => {
                ytHost.innerHTML = '<div></div>';
                ytPlayer = new YT.Player(ytHost.firstChild, {
                    height: '1', width: '1', videoId,
                    playerVars: { autoplay: 1, controls: 0, start: startAt },
                    events: { onReady: (e) => { try { e.target.seekTo(startAt, true); } catch (er) {} e.target.playVideo(); } }
                });
                ytStopTimer = setTimeout(() => {
                    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
                    finish();
                }, duration * 1000);
            }).catch(err => { statusEl.textContent = 'YOUTUBE-FEHLER: ' + err.message; playBtn.disabled = false; clearInterval(tick); });
        }
    }

    function stopAllMedia() {
        if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
        if (ytPlayer && ytPlayer.stopVideo) { try { ytPlayer.stopVideo(); } catch (e) {} }
        ytPlayer = null;
        if (ytStopTimer) { clearTimeout(ytStopTimer); ytStopTimer = null; }
    }

    function extractYouTubeId(url) {
        const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([\w-]{11})/);
        return m ? m[1] : null;
    }

    let ytApiPromise = null;
    function loadYouTubeAPI() {
        if (window.YT && window.YT.Player) return Promise.resolve();
        if (ytApiPromise) return ytApiPromise;
        ytApiPromise = new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = () => reject(new Error('API konnte nicht geladen werden'));
            document.head.appendChild(tag);
            window.onYouTubeIframeAPIReady = () => resolve();
            setTimeout(() => {
                if (window.YT && window.YT.Player) resolve();
                else reject(new Error('Timeout'));
            }, 8000);
        });
        return ytApiPromise;
    }

    /* ============================================================
       FINISH
       ============================================================ */
    function finishPlay() {
        GameState.markQuestionsPlayed(category.id, questions.map(q => q.id));
        GameState.setCurrentPlay(null);
        stopAllMedia();
        songResetFn = null;
        UIController.showScreen('main');
    }

    /* ---------- HELPERS ---------- */
    function typeLabel(t) {
        return ({
            standard: 'STANDARD',
            whereami: 'WO BIN ICH?',
            barcode:  'BILD + MC',
            song:     'RATE DEN SONG',
        })[t] || String(t).toUpperCase();
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    return { init };
})();
