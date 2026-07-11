/* ============================================================
   SetupManager — handles Modus 1 (Setup) UI
   ============================================================ */

const SetupManager = (function () {
    let root;
    let selectedAvatarTarget = null; // teamId currently waiting for an avatar pick

    const TYPE_LABELS = {
        standard:   'STANDARD',
        song:       'RATE DEN SONG',
        imageguess: 'BILD RATEN',  // image only, free-text answer, round mode
        whereami:   'WO BIN ICH?',
        barcode:    'BILD + MC',   // generic image + multiple choice (incl. movie barcode)
    };

    // Time helpers — accept "m:ss" (e.g. 1:23) or plain seconds; format back to m:ss.
    function parseTime(v) {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        if (s.includes(':')) {
            const [m, sec] = s.split(':');
            return (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
        }
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
    }
    function formatTime(sec) {
        sec = Math.max(0, Math.round(sec || 0));
        return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }

    // A media "slot" value is { mediaId } (already cached) or { blob } (pending upload).
    // persistSlot writes a pending blob to the cache and returns its id.
    async function persistSlot(val) {
        if (!val) return null;
        if (val.mediaId) return val.mediaId;
        if (val.blob) return await MediaCache.put(val.blob);
        return null;
    }
    // Fill an element's background with a slot's image (async, fire-and-forget).
    function applySlotPreview(el, val) {
        if (!val || !el) return;
        if (val.mediaId) { MediaCache.applyBg(el, val.mediaId); return; }
        if (val.blob) el.style.backgroundImage = `url("${URL.createObjectURL(val.blob)}")`;
    }

    // A reusable single-image drop/click slot with preview + remove.
    // `el` is the container; returns { get } yielding the current slot value.
    function makeSingleImageSlot(el, initial, placeholder = 'Bild hierher ziehen oder klicken') {
        let slot = initial || null; // {mediaId}|{blob}|null
        function render() {
            el.style.backgroundImage = '';
            el.innerHTML = '';
            el.className = 'single-image-slot' + (slot ? ' has-img' : '');
            if (slot) {
                applySlotPreview(el, slot);
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'single-image-remove';
                rm.textContent = '×';
                rm.onclick = (e) => { e.stopPropagation(); slot = null; render(); };
                el.appendChild(rm);
            } else {
                el.textContent = placeholder;
            }
        }
        el.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = () => { if (inp.files[0]) { slot = { blob: inp.files[0] }; render(); } };
            inp.click();
        });
        el.addEventListener('dragover', e => e.preventDefault());
        el.addEventListener('drop', e => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('image/')) { slot = { blob: f }; render(); }
        });
        render();
        return { get: () => slot };
    }

    // Optional answer-explanation fields (text + image), appended to a question
    // form. Shown together with the answer when the question is revealed.
    function appendExplanationFields(container, existing) {
        const wrap = document.createElement('div');
        wrap.className = 'explanation-fields';
        wrap.innerHTML = `
            <div class="form-group">
                <label>ERKLÄRUNG ZUR ANTWORT (optional)</label>
                <textarea class="expl-text" placeholder="Zusatzinfo, wird beim Auflösen mit angezeigt">${existing?.explanation || ''}</textarea>
            </div>
            <div class="form-group">
                <label>ERKLÄRUNGS-BILD (optional)</label>
                <div class="single-image-slot expl-img"></div>
            </div>
        `;
        container.appendChild(wrap);
        const slot = makeSingleImageSlot(
            wrap.querySelector('.expl-img'),
            existing?.explanationImageMediaId ? { mediaId: existing.explanationImageMediaId } : null
        );
        return {
            async collect() {
                const explanation = wrap.querySelector('.expl-text').value.trim();
                const explanationImageMediaId = await persistSlot(slot.get());
                return {
                    explanation: explanation || null,
                    explanationImageMediaId: explanationImageMediaId || null,
                };
            }
        };
    }

    function render() {
        const tpl = document.getElementById('tpl-setup');
        root.innerHTML = '';
        root.appendChild(tpl.content.cloneNode(true));

        renderLogoControl();
        bindAvatarUpload();
        renderAvatarPool();
        renderTeams();
        renderCategories();
        bindActions();
        updateStatus();
    }

    /* ---------- LOGO ---------- */
    function renderLogoControl() {
        const wrap = root.querySelector('#logo-control');
        if (!wrap) return;
        wrap.innerHTML = '';
        const logoId = GameState.get().settings.logoMediaId;

        const slot = document.createElement('div');
        slot.className = 'logo-slot' + (logoId ? ' has-img' : '');
        if (logoId) {
            MediaCache.applyBg(slot, logoId);
        } else {
            slot.textContent = 'Logo hochladen (Klick / Ziehen)';
        }

        async function setLogoFromFile(file) {
            if (!file || !file.type.startsWith('image/')) return;
            const mediaId = await MediaCache.put(file);
            GameState.updateSettings({ logoMediaId: mediaId });
            MediaCache.pruneExcept(GameState.collectMediaIds());
            renderLogoControl();
            UIController.updateHeaderLogo();
        }

        slot.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = () => setLogoFromFile(inp.files[0]);
            inp.click();
        });
        slot.addEventListener('dragover', e => e.preventDefault());
        slot.addEventListener('drop', e => {
            e.preventDefault();
            setLogoFromFile(e.dataTransfer.files[0]);
        });
        wrap.appendChild(slot);

        if (logoId) {
            const rm = document.createElement('button');
            rm.className = 'btn btn-danger';
            rm.textContent = 'LOGO ENTFERNEN';
            rm.addEventListener('click', () => {
                GameState.updateSettings({ logoMediaId: null });
                MediaCache.pruneExcept(GameState.collectMediaIds());
                renderLogoControl();
                UIController.updateHeaderLogo();
            });
            wrap.appendChild(rm);
        }
    }

    /* ---------- AVATAR POOL ---------- */
    function bindAvatarUpload() {
        const zone = root.querySelector('#avatar-upload');
        const input = root.querySelector('#avatar-file-input');

        async function ingestAvatarFiles(fileList) {
            for (const file of fileList) {
                if (file.type.startsWith('image/')) {
                    const mediaId = await MediaCache.put(file);
                    GameState.addAvatar(mediaId);
                }
            }
            renderAvatarPool();
            updateStatus();
        }

        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', async (e) => {
            await ingestAvatarFiles(e.target.files);
            input.value = '';
        });

        ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
            e.preventDefault(); zone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
            e.preventDefault(); zone.classList.remove('dragover');
        }));
        zone.addEventListener('drop', async (e) => {
            await ingestAvatarFiles(e.dataTransfer.files);
        });
    }

    function renderAvatarPool() {
        const pool = root.querySelector('#avatar-pool');
        pool.innerHTML = '';
        const state = GameState.get();
        const usedIds = new Set(state.teams.map(t => t.avatarId).filter(Boolean));

        state.avatars.forEach(a => {
            const tile = document.createElement('div');
            tile.className = 'avatar-tile';
            if (usedIds.has(a.id)) tile.classList.add('assigned');
            MediaCache.applyBg(tile, a.mediaId);
            tile.title = usedIds.has(a.id) ? 'Bereits zugewiesen' : 'Klicken zum Zuweisen';

            const rm = document.createElement('button');
            rm.className = 'remove';
            rm.textContent = '×';
            rm.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (confirm('Avatar entfernen?')) {
                    GameState.removeAvatar(a.id);
                    MediaCache.pruneExcept(GameState.collectMediaIds());
                    renderAvatarPool();
                    renderTeams();
                }
            });
            tile.appendChild(rm);

            tile.addEventListener('click', () => {
                if (selectedAvatarTarget) {
                    GameState.updateTeam(selectedAvatarTarget, { avatarId: a.id });
                    selectedAvatarTarget = null;
                    renderAvatarPool();
                    renderTeams();
                }
            });
            pool.appendChild(tile);
        });
    }

    /* ---------- TEAMS ---------- */
    function renderTeams() {
        const list = root.querySelector('#teams-list');
        list.innerHTML = '';
        const state = GameState.get();

        state.teams.forEach(team => {
            const row = document.createElement('div');
            row.className = 'team-row';
            if (selectedAvatarTarget === team.id) row.classList.add('selected-target');

            const slot = document.createElement('div');
            slot.className = 'team-avatar-slot';
            const av = state.avatars.find(a => a.id === team.avatarId);
            if (av) {
                MediaCache.applyBg(slot, av.mediaId);
            } else {
                slot.textContent = '?';
            }
            slot.addEventListener('click', () => {
                selectedAvatarTarget = (selectedAvatarTarget === team.id) ? null : team.id;
                renderTeams();
            });

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'team-name-input';
            nameInput.value = team.name;
            nameInput.placeholder = 'Teamname …';
            nameInput.addEventListener('input', () => {
                GameState.updateTeam(team.id, { name: nameInput.value });
                updateStatus();
            });

            const rm = document.createElement('button');
            rm.className = 'team-remove';
            rm.textContent = '×';
            rm.addEventListener('click', () => {
                GameState.removeTeam(team.id);
                renderTeams();
                renderAvatarPool();
                updateStatus();
            });

            row.appendChild(slot);
            row.appendChild(nameInput);
            row.appendChild(rm);
            list.appendChild(row);
        });

        const addBtn = root.querySelector('#add-team-btn');
        addBtn.disabled = state.teams.length >= 6;
        addBtn.style.opacity = state.teams.length >= 6 ? 0.4 : 1;
        addBtn.onclick = () => {
            GameState.addTeam();
            renderTeams();
            updateStatus();
        };
    }

    /* ---------- CATEGORIES ---------- */
    function renderCategories() {
        const list = root.querySelector('#categories-list');
        list.innerHTML = '';
        const state = GameState.get();

        state.categories.forEach(cat => {
            const card = document.createElement('div');
            card.className = 'category-card';

            // Head
            const head = document.createElement('div');
            head.className = 'category-head';

            const iconInput = document.createElement('input');
            iconInput.type = 'text';
            iconInput.className = 'cat-icon-input';
            iconInput.value = cat.icon;
            iconInput.maxLength = 2;
            iconInput.title = 'Emoji-Icon der Kategorie — anklicken und ändern';
            iconInput.setAttribute('aria-label', 'Emoji-Icon');
            iconInput.addEventListener('input', () => {
                GameState.updateCategory(cat.id, { icon: iconInput.value });
            });

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'cat-name-input';
            nameInput.value = cat.name;
            nameInput.addEventListener('input', () => {
                GameState.updateCategory(cat.id, { name: nameInput.value });
                updateStatus();
            });

            // Type selector — locked once the category has questions, so its
            // type can't diverge from the questions already added.
            const typeSelect = document.createElement('select');
            typeSelect.className = 'cat-type-select';
            Object.entries(TYPE_LABELS).forEach(([value, label]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label + (GameState.isRoundType(value) ? '  · RUNDE (3er)' : '  · EINZELFRAGE');
                if (cat.type === value) opt.selected = true;
                typeSelect.appendChild(opt);
            });
            typeSelect.disabled = cat.questions.length > 0;
            typeSelect.title = cat.questions.length > 0
                ? 'Typ ist gesperrt, solange Fragen vorhanden sind'
                : 'Fragetyp dieser Kategorie';
            typeSelect.addEventListener('change', () => {
                GameState.updateCategory(cat.id, { type: typeSelect.value });
                renderCategories();
                updateStatus();
            });

            const min = GameState.minQuestions(cat.type);
            const meta = document.createElement('span');
            meta.className = 'cat-meta ' + (cat.questions.length >= min ? 'ok' : 'warn');
            meta.textContent = `${cat.questions.length} / ${min} FRAGEN`;

            const rm = document.createElement('button');
            rm.className = 'cat-remove';
            rm.textContent = '× LÖSCHEN';
            rm.addEventListener('click', () => {
                if (confirm(`Kategorie "${cat.name}" wirklich löschen?`)) {
                    GameState.removeCategory(cat.id);
                    MediaCache.pruneExcept(GameState.collectMediaIds());
                    renderCategories();
                    updateStatus();
                }
            });

            head.appendChild(iconInput);
            head.appendChild(nameInput);
            head.appendChild(typeSelect);
            head.appendChild(meta);
            head.appendChild(rm);
            card.appendChild(head);

            // Questions list
            const ql = document.createElement('div');
            ql.className = 'questions-list';
            cat.questions.forEach(q => {
                ql.appendChild(buildQuestionRow(cat, q));
            });
            card.appendChild(ql);

            // Single add button matching the category's fixed type
            const bar = document.createElement('div');
            bar.className = 'add-question-bar';
            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-secondary';
            addBtn.textContent = '+ ' + TYPE_LABELS[cat.type] + ' HINZUFÜGEN';
            addBtn.addEventListener('click', () => openQuestionModal(cat.id, cat.type, null));
            bar.appendChild(addBtn);

            // Bulk import: text-based (standard / song) or image files (imageguess)
            const importable = cat.type === 'standard' || cat.type === 'song' || cat.type === 'imageguess';
            if (importable) {
                const importBtn = document.createElement('button');
                importBtn.className = 'btn';
                importBtn.textContent = '⇩ MASSEN-IMPORT';
                importBtn.addEventListener('click', () => {
                    const panel = card.querySelector('.import-panel');
                    if (panel) panel.classList.toggle('hidden');
                });
                bar.appendChild(importBtn);
            }
            card.appendChild(bar);

            if (importable) {
                card.appendChild(buildImportPanel(cat));
            }

            list.appendChild(card);
        });

        root.querySelector('#add-category-btn').onclick = () => {
            GameState.addCategory();
            renderCategories();
            updateStatus();
        };
    }

    function buildQuestionRow(cat, q) {
        const row = document.createElement('div');
        row.className = 'question-row';
        const tag = document.createElement('span');
        tag.className = 'question-type-tag qt-' + q.type;
        tag.textContent = ({
            standard:   'STANDARD',
            whereami:   'WO BIN ICH?',
            barcode:    'BILD + MC',
            song:       'SONG',
            imageguess: 'BILD RATEN',
        })[q.type] || q.type.toUpperCase();

        const prev = document.createElement('span');
        prev.className = 'question-preview';
        prev.textContent = questionPreviewText(q);
        prev.title = 'Bearbeiten';
        prev.addEventListener('click', () => openQuestionModal(cat.id, q.type, q));

        const rm = document.createElement('button');
        rm.className = 'q-remove';
        rm.textContent = '×';
        rm.addEventListener('click', () => {
            if (confirm('Frage löschen?')) {
                GameState.removeQuestion(cat.id, q.id);
                renderCategories();
                updateStatus();
            }
        });

        row.appendChild(tag);
        row.appendChild(prev);
        row.appendChild(rm);
        return row;
    }

    function questionPreviewText(q) {
        switch (q.type) {
            case 'standard':   return q.question || '(leer)';
            case 'whereami':   return 'Antwort: ' + (q.answer || '(leer)');
            case 'barcode':    return 'Antwort: ' + (q.answer || '(leer)');
            case 'song':       return 'Antwort: ' + (q.answer || '(leer)');
            case 'imageguess': return 'Bild → ' + (q.answer || '(leer)');
            default: return '(unbekannt)';
        }
    }

    /* ---------- BULK IMPORT ---------- */
    const IMPORT_HINTS = {
        standard: `F: Wie heißt die Hauptstadt von Frankreich?\nA: Paris\nE: (optional) seit 508 n. Chr. Hauptstadt\n\nF: Wer malte die Mona Lisa?\nA: Leonardo da Vinci`,
        song: `YT: https://www.youtube.com/watch?v=dQw4w9WgXcQ\nSTART: 0:00\nSTOP: 0:20\nA: Never Gonna Give You Up — Rick Astley\nE: (optional) Rickroll-Klassiker von 1987\n\nYT: https://youtu.be/9bZkp7q19f0\nA: Gangnam Style — PSY`,
    };

    // Image-guess categories import by uploading image files; the answer is
    // each file's name without extension.
    function buildImageImportPanel(cat) {
        const panel = document.createElement('div');
        panel.className = 'import-panel hidden';

        const hint = document.createElement('div');
        hint.className = 'import-hint';
        hint.innerHTML = `Mehrere Bilder auswählen — pro Bild wird eine Frage angelegt, die <b>Antwort ist der Dateiname ohne Endung</b> (z. B. <code>Eiffelturm.jpg</code> → Antwort „Eiffelturm").`;
        panel.appendChild(hint);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        panel.appendChild(input);

        const bar = document.createElement('div');
        bar.className = 'import-actions';
        const status = document.createElement('span');
        status.className = 'import-status';
        bar.appendChild(status);
        panel.appendChild(bar);

        input.addEventListener('change', async () => {
            const files = [...input.files].filter(f => f.type.startsWith('image/'));
            if (!files.length) return;
            status.className = 'import-status';
            status.textContent = 'Importiere …';
            let n = 0;
            for (const file of files) {
                const mediaId = await MediaCache.put(file);
                const answer = file.name.replace(/\.[^.]+$/, '').trim() || 'Unbenannt';
                GameState.addQuestion(cat.id, {
                    type: 'imageguess', imageMediaId: mediaId, answer,
                    explanation: null, explanationImageMediaId: null,
                });
                n++;
            }
            input.value = '';
            renderCategories();
            updateStatus();
            const newPanel = root.querySelectorAll('.category-card')[
                GameState.get().categories.findIndex(c => c.id === cat.id)
            ]?.querySelector('.import-panel');
            if (newPanel) {
                newPanel.classList.remove('hidden');
                const st = newPanel.querySelector('.import-status');
                if (st) { st.className = 'import-status ok'; st.textContent = `${n} Bild(er) importiert`; }
            }
        });

        return panel;
    }

    function buildImportPanel(cat) {
        if (cat.type === 'imageguess') return buildImageImportPanel(cat);

        const panel = document.createElement('div');
        panel.className = 'import-panel hidden';

        const isSong = cat.type === 'song';
        const hint = document.createElement('div');
        hint.className = 'import-hint';
        hint.innerHTML = isSong
            ? `Ein Block pro Song. <code>YT:</code> YouTube-Link, <code>START:</code> Startzeit (optional, m:ss oder Sek.), <code>STOP:</code> Stoppzeit (optional, Standard 0:20), <code>A:</code> Antwort, <code>E:</code> Erklärung (optional). Blöcke durch Leerzeile trennen. Audio-Dateien bleiben Einzel-Upload.`
            : `Ein Block pro Frage: <code>F:</code> Frage, <code>A:</code> Antwort, <code>E:</code> Erklärung (optional). Blöcke durch Leerzeile trennen.`;
        panel.appendChild(hint);

        const ta = document.createElement('textarea');
        ta.className = 'import-textarea';
        ta.rows = 8;
        ta.placeholder = IMPORT_HINTS[cat.type];
        panel.appendChild(ta);

        const bar = document.createElement('div');
        bar.className = 'import-actions';
        const status = document.createElement('span');
        status.className = 'import-status';
        const doBtn = document.createElement('button');
        doBtn.className = 'btn btn-primary';
        doBtn.textContent = 'IMPORTIEREN';
        doBtn.addEventListener('click', () => {
            const { added, errors } = parseImport(ta.value, cat.type);
            added.forEach(q => GameState.addQuestion(cat.id, q));
            if (added.length > 0) {
                ta.value = '';
                renderCategories();
                updateStatus();
                // re-open this category's panel so the status stays visible
                const newPanel = root.querySelectorAll('.category-card')[
                    GameState.get().categories.findIndex(c => c.id === cat.id)
                ]?.querySelector('.import-panel');
                if (newPanel) {
                    newPanel.classList.remove('hidden');
                    const st = newPanel.querySelector('.import-status');
                    if (st) {
                        st.className = 'import-status ok';
                        st.textContent = `${added.length} Frage(n) importiert` +
                            (errors.length ? ` · ${errors.length} übersprungen` : '');
                    }
                }
            } else {
                status.className = 'import-status error';
                status.textContent = errors.length
                    ? `Nichts importiert · ${errors.length} Problem(e): ${errors[0]}`
                    : 'Nichts erkannt — Format prüfen.';
            }
        });
        bar.appendChild(doBtn);
        bar.appendChild(status);
        panel.appendChild(bar);

        return panel;
    }

    // Parse a bulk block into question objects. Lenient: accepts blank-line- or
    // contiguous-separated records, German/short prefixes, and continuation lines.
    function parseImport(text, type) {
        const primary = type === 'song' ? 'YT' : 'F';
        const lines = String(text || '').split(/\r?\n/);
        const records = [];
        let cur = null;
        const flush = () => { if (cur && Object.keys(cur).length) records.push(cur); cur = null; };

        for (const raw of lines) {
            const line = raw.trim();
            if (!line) { continue; }
            const m = line.match(/^([A-Za-zÄÖÜäöü]+)\s*[:.\-]\s*(.*)$/);
            let key = m ? m[1].toUpperCase() : null;
            let val = m ? m[2].trim() : line;
            if (key === 'FRAGE') key = 'F';
            else if (key === 'ANTWORT' || key === 'LÖSUNG' || key === 'LOESUNG') key = 'A';
            else if (key === 'YOUTUBE' || key === 'LINK') key = 'YT';
            else if (key === 'STOPP' || key === 'SEKUNDEN' || key === 'SEC' || key === 'ENDE') key = 'STOP';
            else if (key === 'STARTZEIT' || key === 'BEGINN' || key === 'VON') key = 'START';
            else if (key === 'ERKLÄRUNG' || key === 'ERKLAERUNG' || key === 'INFO') key = 'E';

            const known = ['F', 'A', 'E', 'YT', 'START', 'STOP'];
            if (key && known.includes(key)) {
                if (key === primary && cur && cur[primary] !== undefined) flush();
                if (!cur) cur = {};
                cur[key] = val;
            } else if (cur && cur[primary] !== undefined) {
                // continuation of the primary field (e.g. a multi-line question)
                cur[primary] += ' ' + line;
            }
            // else: stray line with no context → ignored
        }
        flush();

        const added = [];
        const errors = [];
        records.forEach((r, i) => {
            if (type === 'song') {
                if (!r.YT) { errors.push(`Block ${i + 1}: kein YT-Link.`); return; }
                if (!extractYouTubeId(r.YT)) { errors.push(`Block ${i + 1}: ungültiger YouTube-Link.`); return; }
                if (!r.A) { errors.push(`Block ${i + 1}: keine Antwort (A:).`); return; }
                const startAt = Math.max(0, parseTime(r.START) ?? 0);
                let stopAt = parseTime(r.STOP);
                if (stopAt == null || stopAt <= startAt) stopAt = startAt + 20;
                added.push({
                    type: 'song',
                    youtubeUrl: r.YT,
                    audioMediaId: null,
                    startAt,
                    stopAt,
                    answer: r.A,
                    explanation: r.E || null,
                    explanationImageMediaId: null,
                });
            } else {
                if (!r.F) { errors.push(`Block ${i + 1}: keine Frage (F:).`); return; }
                if (!r.A) { errors.push(`Block ${i + 1}: keine Antwort (A:).`); return; }
                added.push({
                    type: 'standard', question: r.F, answer: r.A, imageMediaId: null,
                    explanation: r.E || null, explanationImageMediaId: null,
                });
            }
        });
        return { added, errors };
    }

    // Same YouTube-id check the renderer uses, for import validation.
    function extractYouTubeId(url) {
        const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([\w-]{11})/);
        return m ? m[1] : null;
    }

    /* ---------- QUESTION MODAL ---------- */
    function openQuestionModal(categoryId, type, existing) {
        const modal = document.getElementById('modal-root');
        modal.classList.remove('hidden');
        modal.innerHTML = '';

        const box = document.createElement('div');
        box.className = 'modal';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = closeModal;
        box.appendChild(closeBtn);

        const title = document.createElement('h3');
        title.className = 'modal-title';
        title.textContent = (existing ? '// FRAGE BEARBEITEN — ' : '// NEUE FRAGE — ') + (TYPE_LABELS[type] || type.toUpperCase());
        box.appendChild(title);

        const sub = document.createElement('p');
        sub.className = 'modal-sub';
        sub.textContent = 'Felder ausfüllen und speichern.';
        box.appendChild(sub);

        const formContainer = document.createElement('div');
        box.appendChild(formContainer);

        const formApi = buildForm(type, existing, formContainer);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'ABBRECHEN';
        cancelBtn.onclick = closeModal;
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = 'SPEICHERN';
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            // collect() may be async (media forms persist blobs to MediaCache
            // and return ids); awaiting a plain object works the same.
            const data = await formApi.collect();
            if (!data) { saveBtn.disabled = false; return; }
            data.type = type;
            if (existing) {
                GameState.updateQuestion(categoryId, existing.id, data);
            } else {
                GameState.addQuestion(categoryId, data);
            }
            // Sweep any media orphaned by replacing images during an edit.
            MediaCache.pruneExcept(GameState.collectMediaIds());
            closeModal();
            renderCategories();
            updateStatus();
        };
        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        box.appendChild(actions);

        modal.appendChild(box);
    }

    function closeModal() {
        const modal = document.getElementById('modal-root');
        modal.classList.add('hidden');
        modal.innerHTML = '';
    }

    /* ---------- FORM BUILDERS ---------- */
    function buildForm(type, existing, container) {
        switch (type) {
            case 'standard':   return buildStandardForm(existing, container);
            case 'whereami':   return buildWhereAmIForm(existing, container);
            case 'barcode':    return buildBarcodeForm(existing, container);
            case 'song':       return buildSongForm(existing, container);
            case 'imageguess': return buildImageGuessForm(existing, container);
        }
    }

    function buildStandardForm(existing, container) {
        container.innerHTML = `
            <div class="form-group">
                <label>FRAGE</label>
                <textarea id="f-question" placeholder="Wie heißt die Hauptstadt von …">${existing?.question || ''}</textarea>
            </div>
            <div class="form-group">
                <label>BILD (OPTIONAL) — z. B. für „KI-Slop erraten"</label>
                <div class="single-image-slot" id="f-img"></div>
            </div>
            <div class="form-group">
                <label>ANTWORT</label>
                <input type="text" id="f-answer" value="${escapeHtml(existing?.answer || '')}" placeholder="Antwort">
            </div>
        `;
        const imgSlot = makeSingleImageSlot(
            container.querySelector('#f-img'),
            existing?.imageMediaId ? { mediaId: existing.imageMediaId } : null
        );
        const expl = appendExplanationFields(container, existing);
        return {
            async collect() {
                const question = container.querySelector('#f-question').value.trim();
                const answer = container.querySelector('#f-answer').value.trim();
                if (!question || !answer) { alert('Frage und Antwort erforderlich.'); return null; }
                const imageMediaId = await persistSlot(imgSlot.get());
                return { question, answer, imageMediaId: imageMediaId || null, ...(await expl.collect()) };
            }
        };
    }

    function buildImageGuessForm(existing, container) {
        container.innerHTML = `
            <p class="modal-hint">Nur ein Bild — kein Fragetext. Die Teams raten, was zu sehen ist.</p>
            <div class="form-group">
                <label>BILD</label>
                <div class="single-image-slot" id="ig-img"></div>
            </div>
            <div class="form-group">
                <label>ANTWORT</label>
                <input type="text" id="ig-answer" value="${escapeHtml(existing?.answer || '')}" placeholder="Was ist auf dem Bild?">
            </div>
        `;
        const imgSlot = makeSingleImageSlot(
            container.querySelector('#ig-img'),
            existing?.imageMediaId ? { mediaId: existing.imageMediaId } : null
        );
        const expl = appendExplanationFields(container, existing);
        return {
            async collect() {
                const answer = container.querySelector('#ig-answer').value.trim();
                if (!answer) { alert('Antwort erforderlich.'); return null; }
                if (!imgSlot.get()) { alert('Bild erforderlich.'); return null; }
                const imageMediaId = await persistSlot(imgSlot.get());
                return { answer, imageMediaId, ...(await expl.collect()) };
            }
        };
    }

    function buildWhereAmIForm(existing, container) {
        // Each slot holds { mediaId } (already cached) or { blob } (new upload) or null.
        const slots = (existing?.images || []).slice(0, 3).map(m => (m ? { mediaId: m } : null));
        while (slots.length < 3) slots.push(null);
        const hints = (existing?.hints || ['', '']).slice(0, 2);
        while (hints.length < 2) hints.push('');

        container.innerHTML = `
            <div class="form-group">
                <label>BILDER (1 → 2 → 3, sequenziell)</label>
                <div class="whereami-slots" id="wa-slots"></div>
            </div>
            <div class="form-group">
                <label>TIPP NACH BILD 1</label>
                <input type="text" id="wa-hint-1" value="${escapeHtml(hints[0])}" placeholder="Optionaler Tipp">
            </div>
            <div class="form-group">
                <label>TIPP NACH BILD 2</label>
                <input type="text" id="wa-hint-2" value="${escapeHtml(hints[1])}" placeholder="Optionaler Tipp">
            </div>
            <div class="form-group">
                <label>AUFLÖSUNG (Antwort)</label>
                <input type="text" id="wa-answer" value="${escapeHtml(existing?.answer || '')}" placeholder="Wo ist es?">
            </div>
        `;

        const slotsEl = container.querySelector('#wa-slots');
        function renderSlots() {
            slotsEl.innerHTML = '';
            slots.forEach((val, idx) => {
                const slot = document.createElement('div');
                slot.className = 'whereami-slot' + (val ? ' has-img' : '');
                if (val) applySlotPreview(slot, val);
                else slot.textContent = `Bild ${idx + 1}\nklicken / ziehen`;
                const num = document.createElement('span');
                num.className = 'slot-num';
                num.textContent = String(idx + 1).padStart(2, '0');
                slot.appendChild(num);

                slot.addEventListener('click', () => {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = 'image/*';
                    inp.onchange = () => {
                        if (inp.files[0]) {
                            slots[idx] = { blob: inp.files[0] };
                            renderSlots();
                        }
                    };
                    inp.click();
                });
                slot.addEventListener('dragover', e => e.preventDefault());
                slot.addEventListener('drop', e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f && f.type.startsWith('image/')) {
                        slots[idx] = { blob: f };
                        renderSlots();
                    }
                });
                slotsEl.appendChild(slot);
            });
        }
        renderSlots();
        const expl = appendExplanationFields(container, existing);

        return {
            async collect() {
                const answer = container.querySelector('#wa-answer').value.trim();
                if (!answer) { alert('Antwort erforderlich.'); return null; }
                if (!slots[0]) { alert('Mindestens das erste Bild erforderlich.'); return null; }
                const images = [];
                for (const val of slots) {
                    const id = await persistSlot(val);
                    if (id) images.push(id);
                }
                return {
                    images,
                    hints: [
                        container.querySelector('#wa-hint-1').value.trim(),
                        container.querySelector('#wa-hint-2').value.trim(),
                    ],
                    answer,
                    ...(await expl.collect()),
                };
            }
        };
    }

    function buildBarcodeForm(existing, container) {
        const NUM_COLS = 20;
        const colors = (existing?.colors && existing.colors.length === NUM_COLS)
            ? existing.colors.slice()
            : Array.from({ length: NUM_COLS }, (_, i) => {
                const hue = Math.floor((i / NUM_COLS) * 360);
                return hslToHex(hue, 60, 45);
            });
        // Uploaded image is a slot: { mediaId } (existing) or { blob } (new) or null.
        let uploadedSlot = existing?.imageMediaId ? { mediaId: existing.imageMediaId } : null;
        const options = (existing?.options || ['', '', '']).slice(0, 3);
        while (options.length < 3) options.push('');
        let correctIndex = existing?.correctIndex ?? 0;

        container.innerHTML = `
            <p class="modal-hint">Bild + 3 Antwortoptionen. Nutze den Farbstreifen-Builder
            (Movie Barcode) oder lade ein fertiges Bild / eine Collage hoch (z. B. Nationalgerichte).</p>
            <div class="modal-tabs">
                <button class="modal-tab active" data-tab="builder">FARBSTREIFEN (BARCODE)</button>
                <button class="modal-tab" data-tab="upload">BILD / COLLAGE HOCHLADEN</button>
            </div>
            <div class="tab-content active" data-tab="builder">
                <div class="barcode-builder">
                    <div class="barcode-canvas-wrap">
                        <canvas id="bc-canvas" width="800" height="120"></canvas>
                    </div>
                    <div class="barcode-pickers" id="bc-pickers"></div>
                </div>
            </div>
            <div class="tab-content" data-tab="upload">
                <div class="form-group">
                    <label>FERTIGES BILD / COLLAGE</label>
                    <input type="file" id="bc-upload" accept="image/*">
                    <div id="bc-upload-preview" style="margin-top:10px;"></div>
                </div>
            </div>
            <div class="form-group">
                <label>AUFLÖSUNG (richtige Antwort)</label>
                <input type="text" id="bc-answer" value="${escapeHtml(existing?.answer || '')}" placeholder="z. B. Blade Runner / Italien">
            </div>
            <div class="form-group">
                <label>3 ANTWORTOPTIONEN — eine markieren als korrekt</label>
                <div class="barcode-options" id="bc-options"></div>
            </div>
        `;

        // Tabs
        container.querySelectorAll('.modal-tab').forEach(t => {
            t.addEventListener('click', () => {
                container.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
                container.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                container.querySelector(`.tab-content[data-tab="${t.dataset.tab}"]`).classList.add('active');
            });
        });

        // Pickers
        const pickers = container.querySelector('#bc-pickers');
        const canvas = container.querySelector('#bc-canvas');
        const ctx = canvas.getContext('2d');

        function drawBarcode() {
            const w = canvas.width / NUM_COLS;
            colors.forEach((c, i) => {
                ctx.fillStyle = c;
                ctx.fillRect(i * w, 0, w + 1, canvas.height);
            });
        }

        colors.forEach((c, i) => {
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.value = c;
            inp.addEventListener('input', () => {
                colors[i] = inp.value;
                drawBarcode();
            });
            pickers.appendChild(inp);
        });
        drawBarcode();

        // Upload preview
        const uploadInp = container.querySelector('#bc-upload');
        const uploadPrev = container.querySelector('#bc-upload-preview');
        async function refreshPreview() {
            uploadPrev.innerHTML = '';
            if (!uploadedSlot) return;
            const img = document.createElement('img');
            img.style.cssText = 'max-width:100%; border:1px solid var(--line-bright); border-radius:3px;';
            if (uploadedSlot.mediaId) img.src = await MediaCache.resolve(uploadedSlot.mediaId) || '';
            else if (uploadedSlot.blob) img.src = URL.createObjectURL(uploadedSlot.blob);
            uploadPrev.appendChild(img);
        }
        refreshPreview();
        uploadInp.addEventListener('change', () => {
            if (uploadInp.files[0]) {
                uploadedSlot = { blob: uploadInp.files[0] };
                refreshPreview();
            }
        });

        // Options
        const optsEl = container.querySelector('#bc-options');
        function renderOptions() {
            optsEl.innerHTML = '';
            options.forEach((o, idx) => {
                const row = document.createElement('div');
                row.className = 'barcode-option';
                const r = document.createElement('input');
                r.type = 'radio';
                r.name = 'bc-correct';
                r.checked = correctIndex === idx;
                r.addEventListener('change', () => { correctIndex = idx; });
                const t = document.createElement('input');
                t.type = 'text';
                t.value = o;
                t.placeholder = `Option ${idx + 1}`;
                t.addEventListener('input', () => { options[idx] = t.value; });
                row.appendChild(r);
                row.appendChild(t);
                optsEl.appendChild(row);
            });
        }
        renderOptions();
        const expl = appendExplanationFields(container, existing);

        return {
            async collect() {
                const answer = container.querySelector('#bc-answer').value.trim();
                if (!answer) { alert('Auflösung erforderlich.'); return null; }
                if (options.some(o => !o.trim())) { alert('Alle 3 Optionen ausfüllen.'); return null; }
                // Uploaded image wins; otherwise render the built barcode canvas to a blob.
                let imageMediaId;
                if (uploadedSlot) {
                    imageMediaId = await persistSlot(uploadedSlot);
                } else {
                    const blob = await MediaCache.canvasToBlob(canvas, 'image/png');
                    imageMediaId = await MediaCache.put(blob);
                }
                return {
                    answer,
                    colors: colors.slice(),
                    imageMediaId,
                    options: options.slice(),
                    correctIndex,
                    ...(await expl.collect()),
                };
            }
        };
    }

    function buildSongForm(existing, container) {
        // Audio slot: { mediaId } (existing) or { blob } (new) or null.
        let audioSlot = existing?.audioMediaId ? { mediaId: existing.audioMediaId } : null;
        const hasAudio = !!audioSlot;

        container.innerHTML = `
            <div class="modal-tabs">
                <button class="modal-tab ${!hasAudio ? 'active' : ''}" data-tab="yt">YOUTUBE</button>
                <button class="modal-tab ${hasAudio ? 'active' : ''}" data-tab="upload">AUDIO HOCHLADEN</button>
            </div>
            <div class="tab-content ${!hasAudio ? 'active' : ''}" data-tab="yt">
                <div class="form-group">
                    <label>YOUTUBE-LINK</label>
                    <input type="url" id="s-yt" value="${escapeHtml(existing?.youtubeUrl || '')}" placeholder="https://www.youtube.com/watch?v=…">
                </div>
            </div>
            <div class="tab-content ${hasAudio ? 'active' : ''}" data-tab="upload">
                <div class="form-group">
                    <label>AUDIO-DATEI (MP3 / OGG / WAV)</label>
                    <input type="file" id="s-file" accept="audio/*">
                    <div id="s-preview" style="margin-top:8px;"></div>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>STARTZEIT (m:ss oder Sek.)</label>
                    <input type="text" id="s-start" value="${formatTime(existing?.startAt ?? 0)}" placeholder="0:00">
                </div>
                <div class="form-group">
                    <label>STOPPZEIT (m:ss oder Sek.)</label>
                    <input type="text" id="s-stop" value="${formatTime(existing?.stopAt ?? existing?.stopAfter ?? 20)}" placeholder="0:20">
                </div>
            </div>
            <div class="form-group">
                <label>ANTWORT (Songtitel / Künstler)</label>
                <input type="text" id="s-answer" value="${escapeHtml(existing?.answer || '')}" placeholder="Bohemian Rhapsody — Queen">
            </div>
        `;

        container.querySelectorAll('.modal-tab').forEach(t => {
            t.addEventListener('click', () => {
                container.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
                container.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                container.querySelector(`.tab-content[data-tab="${t.dataset.tab}"]`).classList.add('active');
            });
        });

        const fileInp = container.querySelector('#s-file');
        const prev = container.querySelector('#s-preview');
        async function refreshPrev() {
            prev.innerHTML = '';
            if (!audioSlot) return;
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.style.width = '100%';
            if (audioSlot.mediaId) audio.src = await MediaCache.resolve(audioSlot.mediaId) || '';
            else if (audioSlot.blob) audio.src = URL.createObjectURL(audioSlot.blob);
            prev.appendChild(audio);
        }
        refreshPrev();
        fileInp.addEventListener('change', () => {
            if (fileInp.files[0]) {
                audioSlot = { blob: fileInp.files[0] };
                refreshPrev();
            }
        });
        const expl = appendExplanationFields(container, existing);

        return {
            async collect() {
                const yt = container.querySelector('#s-yt').value.trim();
                const startAt = Math.max(0, parseTime(container.querySelector('#s-start').value) ?? 0);
                let stopAt = parseTime(container.querySelector('#s-stop').value);
                if (stopAt == null) stopAt = startAt + 20;
                const answer = container.querySelector('#s-answer').value.trim();
                if (!answer) { alert('Antwort erforderlich.'); return null; }
                if (!yt && !audioSlot) { alert('YouTube-Link oder Audio-Datei erforderlich.'); return null; }
                if (stopAt <= startAt) { alert('Stoppzeit muss nach der Startzeit liegen.'); return null; }
                const audioMediaId = await persistSlot(audioSlot);
                return {
                    youtubeUrl: yt || null,
                    audioMediaId: audioMediaId || null,
                    startAt,
                    stopAt,
                    answer,
                    ...(await expl.collect()),
                };
            }
        };
    }

    /* ---------- ACTIONS / VALIDATION ---------- */
    function bindActions() {
        const startBtn = root.querySelector('#start-game-btn');
        startBtn.onclick = () => {
            const errors = GameState.validateForStart();
            if (errors.length > 0) {
                alert('SETUP UNVOLLSTÄNDIG:\n\n' + errors.join('\n'));
                return;
            }
            GameState.startGame();
            UIController.showScreen('main');
        };

        const progressToggle = root.querySelector('#progress-toggle');
        if (progressToggle) {
            progressToggle.checked = GameState.get().settings.showProgress !== false;
            progressToggle.addEventListener('change', () => {
                GameState.updateSettings({ showProgress: progressToggle.checked });
            });
        }
    }

    function updateStatus() {
        const el = root.querySelector('#setup-status');
        if (!el) return;
        const errors = GameState.validateForStart();
        if (errors.length === 0) {
            el.className = 'status-line ok';
            el.textContent = '// BEREIT ZUM START';
        } else {
            el.className = 'status-line error';
            el.textContent = '// ' + errors.length + ' OFFEN: ' + errors[0];
        }
    }

    /* ---------- HELPERS ---------- */
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }
    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
            return Math.round(v * 255).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function init(rootEl) {
        root = rootEl;
        render();
    }

    return { init, render };
})();
