/* ============================================================
   QuestionRenderer — Modus 3: Frageseite
   Renders standard / whereami / barcode / song question types,
   handles reveal flow + scoring.
   ============================================================ */

const QuestionRenderer = (function () {
    let root;
    let currentQuestion = null;
    let currentCategory = null;

    // Per-type runtime state
    let revealedStep = 0;     // whereami: 0..2 images revealed
    let selectedOption = -1;  // barcode
    let answerRevealed = false;
    let selectedTeams = new Set();

    // Audio/YT runtime
    let audioEl = null;
    let ytPlayer = null;
    let ytStopTimer = null;

    function init(rootEl) {
        root = rootEl;
        const ref = GameState.get().currentQuestionRef;
        if (!ref) {
            root.innerHTML = '<p style="color:var(--text-dim); padding:40px;">// KEINE FRAGE GEWÄHLT — zurück zum Spiel.</p>';
            return;
        }
        const state = GameState.get();
        currentCategory = state.categories.find(c => c.id === ref.categoryId);
        currentQuestion = currentCategory?.questions.find(q => q.id === ref.questionId);
        if (!currentQuestion) {
            root.innerHTML = '<p style="color:var(--text-dim); padding:40px;">// FRAGE NICHT GEFUNDEN.</p>';
            return;
        }
        // Reset runtime
        revealedStep = 0;
        selectedOption = -1;
        answerRevealed = false;
        selectedTeams = new Set();
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
        topBar.innerHTML = `
            <button class="btn btn-secondary" id="q-back">◂ ZURÜCK</button>
            <div class="q-cat-badge">
                <span class="q-cat-icon">${escapeHtml(currentCategory.icon || '★')}</span>
                <span class="q-cat-name">${escapeHtml(currentCategory.name)}</span>
            </div>
            <div class="q-type-tag qt-${currentQuestion.type}">${typeLabel(currentQuestion.type)}</div>
        `;
        wrap.appendChild(topBar);

        // Stage (media / question)
        const stage = document.createElement('div');
        stage.className = 'q-stage';
        wrap.appendChild(stage);

        switch (currentQuestion.type) {
            case 'standard': renderStandard(stage); break;
            case 'whereami': renderWhereAmI(stage); break;
            case 'barcode':  renderBarcode(stage); break;
            case 'song':     renderSong(stage); break;
        }

        // Answer area
        const answerArea = document.createElement('div');
        answerArea.className = 'q-answer-area';
        answerArea.id = 'q-answer-area';
        wrap.appendChild(answerArea);
        renderAnswerArea();

        // Scoring area (hidden until answer revealed)
        const scoringArea = document.createElement('div');
        scoringArea.className = 'q-scoring';
        scoringArea.id = 'q-scoring';
        wrap.appendChild(scoringArea);
        renderScoringArea();

        root.appendChild(wrap);

        // Bind back button
        document.getElementById('q-back').addEventListener('click', () => {
            stopAllMedia();
            UIController.showScreen('main');
        });
    }

    /* ---------- STANDARD ---------- */
    function renderStandard(stage) {
        stage.innerHTML = `
            <div class="q-standard">
                <div class="q-prompt">${escapeHtml(currentQuestion.question)}</div>
            </div>
        `;
    }

    /* ---------- WHERE AM I ---------- */
    function renderWhereAmI(stage) {
        const imgs = currentQuestion.images || [];
        const hints = currentQuestion.hints || [];

        stage.innerHTML = `
            <div class="q-whereami">
                <div class="whereami-stage" id="wa-stage"></div>
                <div class="whereami-controls" id="wa-controls"></div>
            </div>
        `;
        refreshWhereAmI();
    }

    function refreshWhereAmI() {
        const imgs = currentQuestion.images || [];
        const hints = currentQuestion.hints || [];
        const stageEl = root.querySelector('#wa-stage');
        const controlsEl = root.querySelector('#wa-controls');

        stageEl.innerHTML = '';
        for (let i = 0; i <= revealedStep && i < imgs.length; i++) {
            const block = document.createElement('div');
            block.className = 'wa-block' + (i === revealedStep ? ' current' : '');
            block.innerHTML = `
                <div class="wa-block-label">BILD ${String(i + 1).padStart(2, '0')}</div>
                <img src="${imgs[i]}" alt="">
                ${i > 0 && hints[i - 1] ? `<div class="wa-hint">TIPP // ${escapeHtml(hints[i - 1])}</div>` : ''}
            `;
            stageEl.appendChild(block);
        }

        controlsEl.innerHTML = '';
        if (revealedStep < imgs.length - 1) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary big';
            btn.textContent = `▸ BILD ${revealedStep + 2} AUFDECKEN`;
            btn.onclick = () => { revealedStep++; refreshWhereAmI(); };
            controlsEl.appendChild(btn);
        }
    }

    /* ---------- MOVIE BARCODE ---------- */
    function renderBarcode(stage) {
        const q = currentQuestion;
        stage.innerHTML = `
            <div class="q-barcode">
                <div class="barcode-display">
                    <img src="${q.imageDataUrl}" alt="Movie Barcode">
                </div>
                <div class="barcode-choices" id="bc-choices"></div>
            </div>
        `;
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

    /* ---------- RATE DEN SONG ---------- */
    function renderSong(stage) {
        const q = currentQuestion;
        stage.innerHTML = `
            <div class="q-song">
                <div class="song-visual">
                    <div class="song-disc">
                        <div class="song-disc-inner"></div>
                        <div class="song-disc-hole"></div>
                    </div>
                    <div class="song-waves"><span></span><span></span><span></span><span></span><span></span></div>
                </div>
                <div class="song-controls" id="song-controls"></div>
                <div id="yt-container" class="yt-hidden"></div>
                <div class="song-status" id="song-status">BEREIT · AUTO-STOP NACH ${q.stopAfter}s</div>
            </div>
        `;
        const controls = root.querySelector('#song-controls');
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-primary big';
        playBtn.textContent = '▶ PLAY';
        playBtn.onclick = () => startSong(playBtn);
        controls.appendChild(playBtn);
    }

    function startSong(playBtn) {
        const q = currentQuestion;
        const statusEl = root.querySelector('#song-status');
        const visual = root.querySelector('.song-visual');

        playBtn.disabled = true;
        playBtn.textContent = '■ LÄUFT';
        visual.classList.add('playing');

        let elapsed = 0;
        const total = q.stopAfter;
        const tick = setInterval(() => {
            elapsed++;
            const remaining = Math.max(0, total - elapsed);
            statusEl.textContent = `WIEDERGABE · NOCH ${remaining}s`;
            if (remaining <= 0) clearInterval(tick);
        }, 1000);

        const finish = () => {
            clearInterval(tick);
            statusEl.textContent = 'GESTOPPT · ANTWORT AUFDECKEN';
            visual.classList.remove('playing');
            playBtn.disabled = false;
            playBtn.textContent = '↻ ERNEUT';
            playBtn.onclick = () => startSong(playBtn);
        };

        if (q.audioDataUrl) {
            stopAllMedia();
            audioEl = new Audio(q.audioDataUrl);
            audioEl.play().catch(err => {
                statusEl.textContent = 'AUDIO-FEHLER: ' + err.message;
            });
            ytStopTimer = setTimeout(() => {
                if (audioEl) { audioEl.pause(); audioEl = null; }
                finish();
            }, q.stopAfter * 1000);
        } else if (q.youtubeUrl) {
            const videoId = extractYouTubeId(q.youtubeUrl);
            if (!videoId) {
                statusEl.textContent = 'UNGÜLTIGER YOUTUBE-LINK';
                playBtn.disabled = false;
                return;
            }
            loadYouTubeAPI().then(() => {
                stopAllMedia();
                const container = root.querySelector('#yt-container');
                container.innerHTML = '<div id="yt-player"></div>';
                ytPlayer = new YT.Player('yt-player', {
                    height: '1',
                    width: '1',
                    videoId,
                    playerVars: { autoplay: 1, controls: 0 },
                    events: {
                        onReady: (e) => e.target.playVideo(),
                    }
                });
                ytStopTimer = setTimeout(() => {
                    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
                    finish();
                }, q.stopAfter * 1000);
            }).catch(err => {
                statusEl.textContent = 'YOUTUBE-FEHLER: ' + err.message;
                playBtn.disabled = false;
            });
        }
    }

    function stopAllMedia() {
        if (audioEl) { try { audioEl.pause(); } catch(e){} audioEl = null; }
        if (ytPlayer && ytPlayer.stopVideo) { try { ytPlayer.stopVideo(); } catch(e){} }
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

    /* ---------- ANSWER AREA ---------- */
    function renderAnswerArea() {
        const area = root.querySelector('#q-answer-area');
        area.innerHTML = '';

        if (!answerRevealed) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary big';
            btn.textContent = '★ ANTWORT AUFDECKEN';
            btn.onclick = () => {
                answerRevealed = true;
                stopAllMedia();
                // For barcode, re-mark correct/wrong
                if (currentQuestion.type === 'barcode') {
                    root.querySelectorAll('.barcode-choice').forEach((b, idx) => {
                        b.classList.toggle('correct', idx === currentQuestion.correctIndex);
                        if (selectedOption === idx && idx !== currentQuestion.correctIndex) {
                            b.classList.add('wrong');
                        }
                    });
                }
                // For whereami, reveal all remaining images
                if (currentQuestion.type === 'whereami') {
                    revealedStep = (currentQuestion.images || []).length - 1;
                    refreshWhereAmI();
                }
                renderAnswerArea();
                renderScoringArea();
            };
            area.appendChild(btn);
        } else {
            const reveal = document.createElement('div');
            reveal.className = 'answer-reveal';
            reveal.innerHTML = `
                <span class="reveal-label">// AUFLÖSUNG</span>
                <div class="reveal-text">${escapeHtml(currentQuestion.answer)}</div>
            `;
            area.appendChild(reveal);
        }
    }

    /* ---------- SCORING ---------- */
    function renderScoringArea() {
        const area = root.querySelector('#q-scoring');
        area.innerHTML = '';
        if (!answerRevealed) return;

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
                <div class="scoring-avatar" style="${av ? `background-image:url('${av.dataUrl}')` : ''}">${av ? '' : '?'}</div>
                <div class="scoring-name">${escapeHtml(team.name)}</div>
                <div class="scoring-score">${team.score} PKT</div>
                <div class="scoring-check">+1</div>
            `;
            tile.onclick = () => {
                if (selectedTeams.has(team.id)) selectedTeams.delete(team.id);
                else selectedTeams.add(team.id);
                renderScoringArea();
            };
            tilesWrap.appendChild(tile);
        });
        area.appendChild(tilesWrap);

        const actions = document.createElement('div');
        actions.className = 'scoring-actions';

        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn';
        skipBtn.textContent = 'KEINE PUNKTE · ZURÜCK';
        skipBtn.onclick = () => finish(false);

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = `✓ ${selectedTeams.size} TEAM(S) · +1 PUNKT → ZURÜCK`;
        confirmBtn.disabled = selectedTeams.size === 0;
        confirmBtn.onclick = () => finish(true);

        actions.appendChild(skipBtn);
        actions.appendChild(confirmBtn);
        area.appendChild(actions);
    }

    function finish(awardPoints) {
        if (awardPoints && selectedTeams.size > 0) {
            GameState.addPointsToTeams(Array.from(selectedTeams), 1);
        }
        GameState.markQuestionPlayed(currentCategory.id, currentQuestion.id);
        GameState.setCurrentQuestionRef(null);
        stopAllMedia();
        UIController.showScreen('main');
    }

    /* ---------- HELPERS ---------- */
    function typeLabel(t) {
        return ({
            standard: 'STANDARD',
            whereami: 'WO BIN ICH?',
            barcode:  'MOVIE BARCODE',
            song:     'RATE DEN SONG',
        })[t] || t.toUpperCase();
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    return { init };
})();
