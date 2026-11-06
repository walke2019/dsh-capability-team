    // ---------- office stage: layout, DOM plates and the render loop (imperative; React only owns the host element) ----------
    /**
     * Sprites arrive from `stageSprites` (08d) and are diffed in `sync`: new members walk in from the door, and the
     * one-shot effects from `stageEvents` (08e) fly letters between Lead and teammates, celebrate finished tasks and
     * flash changed routes. Poses follow each sprite's `activity`. The first frame is painted synchronously because a
     * hidden side pane never fires requestAnimationFrame.
     */
    class OfficeScene {
      constructor(stage, canvas, overlay, { t, onOpen, onSelect }) {
        this.stage = stage; this.canvas = canvas; this.overlay = overlay; this.ctx = canvas.getContext('2d'); this.t = t; this.onOpen = onOpen; this.onSelect = onSelect;
        this.sprites = new Map(); this.plates = new Map(); this.icons = new Map(); this.bubbles = new Map(); this.couriers = []; this.prevList = []; this.tick = 0;
        this.onCanvasClick = e => { const id = this.hit(e); if (id) this.select(this.selected === id ? null : id); };
        canvas.addEventListener?.('click', this.onCanvasClick);
        this.w = 0; this.h = 0; this.S = 3; this.plateW = 120; this.selected = null; this.synced = false; this.dirty = true; this.visible = true;
        this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.px = (x, y, w, h, c) => { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
        if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(stage); }
        this.visibleAt = 0; // on-screen check is a cheap rect read once a second (IntersectionObserver is unreliable inside some embedded panes)
        this.onVisibility = () => { this.last = 0; if (!document.hidden) this.draw(); };
        document.addEventListener('visibilitychange', this.onVisibility);
        this.colors = null; this.unwatchTheme = stageWatchTheme(() => this.retheme());
        this.last = 0; this.schedule();
      }
      /** Canvas colours are resolved to concrete rgb through a probe element (see 08c-stage-colors.js) and cached until the theme changes. */
      stageColors() {
        if (this.colors) return this.colors;
        this.probe ??= this.el('i');
        this.probe.setAttribute('aria-hidden', 'true'); Object.assign(this.probe.style, { position: 'absolute', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none' });
        if (!this.probe.isConnected) this.stage.append(this.probe);
        return (this.colors = stageResolveColors(this.probe, getComputedStyle));
      }
      /** `theme/change` fires before the host flips the body attribute, so re-resolve once more after it settles. */
      retheme() {
        const redraw = () => { this.colors = null; this.dirty = true; this.draw(); };
        redraw(); clearTimeout(this.themeTimer); this.themeTimer = setTimeout(redraw, 80);
      }
      /** rAF when the host delivers frames; a timer fallback keeps motion going (at low fps) in panes that stall rAF while visible. */
      schedule() {
        cancelAnimationFrame(this.raf); clearTimeout(this.timer);
        this.raf = requestAnimationFrame(now => this.loop(now));
        this.timer = setTimeout(() => this.loop(performance.now()), this.busy() && this.visible && !document.hidden ? 120 : 1000);
      }
      el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
      destroy() {
        cancelAnimationFrame(this.raf); clearTimeout(this.timer); clearTimeout(this.themeTimer); this.ro?.disconnect(); document.removeEventListener('visibilitychange', this.onVisibility);
        this.unwatchTheme?.(); this.probe?.remove();
        this.canvas.removeEventListener?.('click', this.onCanvasClick);
        for (const id of [...this.sprites.keys()]) this.remove(id);
      }

      /* ---------- diff from the adapter ---------- */
      sync(list) {
        const seen = new Set();
        for (const data of list) {
          seen.add(data.id);
          const prev = this.sprites.get(data.id);
          if (!prev) { this.add(data, this.synced && data.status !== 'inactive'); continue; }
          const was = prev.data; prev.data = data;
          if (was.status === 'inactive' && data.status !== 'inactive' && !this.reduced) this.walkIn(prev);
          else if (prev.phase !== 'walking') prev.phase = phaseOf(data);
          if (was.activity !== data.activity) prev.gesture = null;
        }
        if (this.synced) for (const ev of stageEvents(this.prevList, list)) this.effect(ev);
        for (const data of list) this.renderPlate(data.id);
        for (const id of [...this.sprites.keys()]) if (!seen.has(id)) this.remove(id);
        this.prevList = list; this.synced = true; this.dirty = true; this.positionOverlay(); this.draw();
      }
      effect(ev) {
        if (ev.type === 'flash') this.flash(ev.id);
        else if (ev.type === 'mail') this.courier(ev.from, ev.to);
        else if (ev.type === 'celebrate') { const s = this.sprites.get(ev.id); if (s) { s.celebrate = this.reduced ? 0 : 1.6; s.cheer = 2.4; } }
        else if (ev.type === 'sweat') this.dirty = true;
      }
      add(data, enter) {
        const s = { data, palette: stagePalette(data.id, data.capability), x: 0, y: 0, home: { x: 0, y: 0 }, facing: 1, phase: phaseOf(data), path: [], frame: 0, ft: 0, flash: 0, celebrate: 0, cheer: 0, gesture: null };
        this.sprites.set(data.id, s);
        const plate = this.el('div', 'ctm-stage-plate'); plate.dataset.id = data.id; plate.tabIndex = 0; plate.setAttribute('role', 'button');
        plate.addEventListener('click', () => this.select(this.selected === data.id ? null : data.id));
        plate.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); plate.click(); } });
        this.overlay.append(plate); this.plates.set(data.id, plate);
        const icon = this.el('div', 'ctm-stage-icon'); icon.hidden = true; this.overlay.append(icon); this.icons.set(data.id, icon);
        const bubble = this.el('div', 'ctm-stage-bubble'); bubble.hidden = true; this.overlay.append(bubble); this.bubbles.set(data.id, bubble);
        this.resize(); if (enter && !this.reduced) this.walkIn(s); this.renderPlate(data.id);
      }
      remove(id) {
        this.sprites.delete(id); for (const map of [this.plates, this.icons, this.bubbles]) { map.get(id)?.remove(); map.delete(id); }
        if (this.selected === id) this.select(null); this.resize();
      }
      /** `notify=false` mirrors the React-held selection without echoing it back. */
      select(id, notify = true) {
        const next = id && this.sprites.has(id) ? id : null, changed = next !== this.selected;
        this.selected = next; for (const [k, p] of this.plates) p.setAttribute('aria-selected', String(k === this.selected));
        if (changed && notify) this.onSelect?.(next);
        if (changed) this.dirty = true;
      }
      /** Canvas click → the member whose desk/body box contains the point (people are drawn over their desks). */
      hit(e) {
        const r = this.canvas.getBoundingClientRect?.(); if (!r) return null;
        const x = e.clientX - r.left, y = e.clientY - r.top, S = this.S;
        for (const [id, s] of this.sprites) if (Math.abs(x - s.home.x) <= 12 * S && y >= s.home.y - 18 * S && y <= s.home.y + 8 * S) return id;
        return null;
      }
      walkIn(s) { s.x = -12 * this.S; s.y = s.home.y + 9 * this.S; s.facing = 1; s.path = [{ x: s.home.x, y: s.y }, { x: s.home.x, y: s.home.y }]; s.phase = 'walking'; }
      /** Fly a letter between two desks; `to == null` means "to the team" (fans out to every seated teammate). */
      courier(fromId, toId) {
        if (this.reduced) return;
        const from = this.sprites.get(fromId); if (!from) return;
        const targets = toId ? [this.sprites.get(toId)].filter(Boolean) : [...this.sprites.values()].filter(s => !s.data.lead && s.data.status !== 'inactive').slice(0, 6);
        for (const to of targets) {
          const dest = { x: to.home.x - 10 * this.S, y: to.home.y + 2 * this.S };
          this.couriers.push({ x: from.home.x, y: from.home.y, from: { ...from.home }, to: dest, reply: !from.data.lead, t: 0, dur: .9 + Math.hypot(dest.x - from.home.x, dest.y - from.home.y) / 420 });
        }
      }
      flash(id) { const b = this.plates.get(id)?.querySelector('.ctm-model-badge'); if (b) { b.removeAttribute('data-flash'); void b.offsetWidth; b.dataset.flash = ''; } }

      /* ---------- layout ---------- */
      resize() {
        // Measure the CSS height without our own floor, so growing the stage for a tall roster never oscillates.
        this.stage.style.minHeight = '';
        const r = this.stage.getBoundingClientRect(); if (!r.width || !r.height) return;
        const base = Math.round(r.height), all = [...this.sprites.values()], others = all.filter(s => !s.data.lead);
        this.w = Math.round(r.width);
        const cols = this.w < 520 ? 3 : this.w < 1250 ? 6 : 7, rows = 1 + Math.ceil(others.length / cols), plateH = 26, bottom = 14;
        const fit = S => 10 * S + 8 + bottom + rows * (22 * S + plateH) + (rows - 1) * 2;
        let S = this.w < 520 ? 2 : this.w < 980 ? 3 : 4; while (S > 2 && fit(S) > base) S--;
        this.S = S;
        const need = fit(S); this.h = Math.max(base, need);
        if (need > base) this.stage.style.minHeight = need + 'px'; // tiny panes: grow a few px rather than overlap rows
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.ctx.imageSmoothingEnabled = false;
        const top = 10 * S + 8, contentH = 22 * S + plateH, cellH = rows > 1 ? (this.h - top - bottom - contentH) / (rows - 1) : 0;
        const spread = Math.min(1, Math.max(.6, this.w / (cols * 150))), cellW = this.w / cols * spread, left = (this.w - cellW * cols) / 2;
        this.plateW = Math.min(this.w >= 1100 ? 160 : 150, Math.floor(cellW * .85));
        const place = (s, cx, cy) => { s.home = { x: Math.round(cx), y: Math.round(cy) }; if (s.phase !== 'walking') { s.x = s.home.x; s.y = s.home.y; } };
        for (const s of all.filter(x => x.data.lead)) place(s, this.w / 2, top + 16 * S);
        others.forEach((s, i) => {
          const row = Math.floor(i / cols), inRow = Math.min(cols, others.length - row * cols), offset = left + (cols - inRow) * cellW / 2;
          place(s, offset + (i % cols + .5) * cellW, top + 16 * S + cellH * (row + 1));
        });
        for (const p of this.plates.values()) p.style.setProperty('--pw', this.plateW + 'px');
        this.dirty = true; this.positionOverlay(); this.draw();
      }
      positionOverlay() {
        const S = this.S, headY = 16 * S, half = this.plateW / 2 + 2;
        for (const [id, s] of this.sprites) {
          const p = this.plates.get(id), i = this.icons.get(id), b = this.bubbles.get(id);
          const px = Math.max(half, Math.min(this.w - half, s.home.x));
          p.style.left = px + 'px'; p.style.top = (s.home.y + 7 * S) + 'px';
          i.style.left = s.x + 'px'; i.style.top = (s.y - headY - 2) + 'px';
          b.style.left = Math.max(70, Math.min(this.w - 70, s.x)) + 'px'; b.style.top = (s.y - headY - (s.data.icon ? 20 : 4)) + 'px';
        }
      }

      /* ---------- DOM plates ---------- */
      renderPlate(id) {
        const s = this.sprites.get(id), p = this.plates.get(id); if (!s || !p) return;
        const d = s.data, t = this.t; p.innerHTML = ''; p.dataset.status = d.status;
        const name = this.el('div', 'ctm-stage-plate-name');
        const dot = this.el('i', 'ctm-stage-dot'); dot.dataset.s = d.status; dot.title = d.statusLabel;
        name.append(dot, this.el('span', '', d.name));
        const act = this.el('div', 'ctm-stage-plate-act', [d.activityLabel, d.parallel > 1 ? fmt(t('stage.parallel'), { n: d.parallel }) : ''].filter(Boolean).join(' · '));
        act.dataset.act = d.activity ?? '';
        if (d.ctxRatio != null) { const m = this.el('div', 'ctm-stage-meter'); m.dataset.tone = d.ctxRatio >= .9 ? 'error' : d.ctxRatio >= .75 ? 'warn' : ''; m.style.setProperty('--p', Math.round(d.ctxRatio * 100) + '%'); m.title = `${t('live.contextPressure')} ${Math.round(d.ctxRatio * 100)}%`; m.append(this.el('i')); name.append(m); }
        const more = this.el('div', 'ctm-stage-plate-more');
        more.append(this.el('small', 'ctm-sub', [d.capability, d.statusLabel].filter(Boolean).join(' · ')));
        if (d.route) { const b = this.el('span', 'ctm-model-badge', d.routeAlias); b.dataset.grade = d.grade; b.title = d.route; more.append(b); }
        more.append(this.el('div', 'ctm-stage-plate-task', d.task ? `#${d.task.id} ${d.task.subject ?? ''}` : t('live.noTask')));
        if (d.openable && this.onOpen) { const btn = this.el('button', 'ctm-btn ctm-stage-open', t('stage.open')); btn.type = 'button'; btn.addEventListener('click', e => { e.stopPropagation(); this.onOpen(d.memberId); }); more.append(btn); }
        p.append(name, act, more); p.dataset.act = d.activity ?? '';
        p.title = `${d.name} · ${d.activityLabel ?? d.statusLabel}${d.route ? ' · ' + d.route : ''}`; p.setAttribute('aria-label', p.title);
        this.renderIcon(id); this.renderBubble(id, Date.now());
      }
      renderIcon(id) {
        const s = this.sprites.get(id), icon = this.icons.get(id); if (!s || !icon) return;
        const glyph = s.cheer > 0 ? '✅' : s.data.icon ?? ''; icon.textContent = glyph; icon.hidden = !glyph; icon.dataset.act = s.cheer > 0 ? 'done' : s.data.activity ?? '';
      }
      renderBubble(id, now) {
        const s = this.sprites.get(id), bubble = this.bubbles.get(id); if (!s || !bubble) return;
        const text = s.cheer > 0 ? this.t('stage.act.doneBubble') : stageBubbleText(s.data, now, this.t);
        if (bubble.textContent !== text) { bubble.textContent = text; bubble.title = text; }
        bubble.hidden = !text; bubble.dataset.act = s.cheer > 0 ? 'done' : s.data.activity ?? '';
      }

      /* ---------- loop ---------- */
      busy() {
        return this.couriers.length > 0 || [...this.sprites.values()].some(s => s.phase === 'walking' || s.celebrate > 0 || s.cheer > 0
          || s.data.status === 'running' || STAGE_BUSY_ACTS.has(s.data.activity));
      }
      loop(now) {
        this.schedule();
        if (!this.last) this.last = now;
        // Reduced motion: still repaint state changes and the elapsed clock, but only a few frames per second.
        const idle = !this.busy(), minFrame = this.reduced ? 500 : idle ? 66 : 0; if (now - this.last < minFrame) return;
        const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
        if (now - this.visibleAt > 1000) { const r = this.stage.getBoundingClientRect(); this.visible = r.width > 0 && r.bottom > 0 && r.top < (window.innerHeight || Infinity); this.visibleAt = now; }
        if ((document.hidden || !this.visible) && !this.dirty) return; // hidden or scrolled-away hosts still get one repaint per change
        this.update(dt); this.draw();
      }
      update(dt) {
        const wall = Date.now(), second = Math.floor(wall / 1000), tickNow = second !== this.tick; this.tick = second;
        for (const [id, s] of this.sprites) {
          s.ft += dt; const rate = s.phase === 'walking' ? .12 : this.reduced ? 1 : STAGE_FRAME_RATE[s.data.activity] ?? .5;
          if (s.ft > rate) { s.ft = 0; s.frame = (s.frame + 1) % 4; }
          const cheered = s.cheer > 0;
          if (s.celebrate > 0) s.celebrate = Math.max(0, s.celebrate - dt);
          if (s.cheer > 0) s.cheer = Math.max(0, s.cheer - dt);
          if (cheered && !s.cheer) { this.renderIcon(id); this.renderBubble(id, wall); }
          s.gesture = s.data.activity === 'idle' && !this.reduced ? stageIdleGesture(id, wall) : null;
          if (tickNow && s.data.bubbleSince != null) this.renderBubble(id, wall);
          if (s.phase === 'walking' && s.path.length) {
            const p = s.path[0], dx = p.x - s.x, dy = p.y - s.y, dist = Math.hypot(dx, dy), step = 70 * dt;
            if (Math.abs(dx) > .5) s.facing = dx > 0 ? 1 : -1;
            if (dist <= step) { s.x = p.x; s.y = p.y; s.path.shift(); if (!s.path.length) s.phase = phaseOf(s.data); } else { s.x += dx / dist * step; s.y += dy / dist * step; }
          }
        }
        for (const c of this.couriers) { c.t += dt / c.dur; const k = Math.min(1, c.t), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; c.x = c.from.x + (c.to.x - c.from.x) * e; c.y = c.from.y + (c.to.y - c.from.y) * e - Math.sin(k * Math.PI) * 24; }
        this.couriers = this.couriers.filter(c => c.t < 1);
        if (this.busy()) this.positionOverlay();
      }
      draw() {
        const { ctx, w, h, S } = this; if (!w) return;
        const c = this.stageColors();
        stageDrawRoom(ctx, this.px, w, h, S, { floorA: c.floorA, floorB: c.floorB, grout: c.grout, wall: c.wall });
        const desk = c.desk, deskTop = c.deskTop, ents = [];
        for (const [id, s] of this.sprites) {
          if (id === this.selected) ents.push({ y: -1, f: () => { const x = s.home.x - 14 * S, y = s.home.y - 19 * S; this.px(x, y, 28 * S, S, c.select); this.px(x, s.home.y + 9 * S, 28 * S, S, c.select); } });
          ents.push({ y: s.home.y + 3 * S, f: () => stageDrawDesk(this.px, s, S, desk, deskTop) });
          if (s.data.status !== 'inactive') ents.push({ y: s.y + (s.phase === 'walking' ? 6 * S : 0), f: () => stageDrawPerson(this.px, s, S) });
        }
        for (const c of this.couriers) ents.push({ y: 1e9, f: () => stageDrawCourier(this.px, c, S) });
        ents.sort((a, b) => a.y - b.y).forEach(e => e.f());
        this.dirty = false;
      }
    }
    function phaseOf(data) { return data.status === 'running' ? 'typing' : 'idle'; }
    /** Seconds per animation frame by activity: fast typing while writing, slow breathing when idle or dozing. */
    const STAGE_FRAME_RATE = { writing: .12, terminal: .18, searching: .25, browsing: .3, messaging: .2, board: .25, working: .22, reading: .7, thinking: .4, waiting: .8, failed: .6, arriving: .3, idle: .5, offline: 1 };
