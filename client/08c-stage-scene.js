    // ---------- office stage: layout, DOM plates and the render loop (imperative; React only owns the host element) ----------
    /**
     * Sprites arrive from `stageSprites` (08d) and are diffed in `sync`: new members walk in from the door, a task that
     * turns in_progress sends a courier from the Lead's desk, a changed route flashes the model badge. The first frame is
     * painted synchronously because a hidden side pane never fires requestAnimationFrame.
     */
    class OfficeScene {
      constructor(stage, canvas, overlay, { t, onOpen }) {
        this.stage = stage; this.canvas = canvas; this.overlay = overlay; this.ctx = canvas.getContext('2d'); this.t = t; this.onOpen = onOpen;
        this.sprites = new Map(); this.plates = new Map(); this.icons = new Map(); this.bubbles = new Map(); this.couriers = [];
        this.w = 0; this.h = 0; this.S = 3; this.plateW = 120; this.selected = null; this.synced = false; this.dirty = true; this.visible = true;
        this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.px = (x, y, w, h, c) => { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
        if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(stage); }
        this.visibleAt = 0; // on-screen check is a cheap rect read once a second (IntersectionObserver is unreliable inside some embedded panes)
        this.onVisibility = () => { this.last = 0; if (!document.hidden) this.draw(); };
        document.addEventListener('visibilitychange', this.onVisibility);
        this.last = 0; this.schedule();
      }
      /** rAF when the host delivers frames; a timer fallback keeps motion going (at low fps) in panes that stall rAF while visible. */
      schedule() {
        cancelAnimationFrame(this.raf); clearTimeout(this.timer);
        this.raf = requestAnimationFrame(now => this.loop(now));
        this.timer = setTimeout(() => this.loop(performance.now()), this.busy() ? 120 : 1000);
      }
      el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
      destroy() {
        cancelAnimationFrame(this.raf); clearTimeout(this.timer); this.ro?.disconnect(); document.removeEventListener('visibilitychange', this.onVisibility);
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
          if (data.task?.status === 'in_progress' && (was.task?.id !== data.task.id || was.task?.status !== 'in_progress') && !data.lead) this.courier(data.id);
          if (was.route !== data.route && data.route) this.flash(data.id);
          this.renderPlate(data.id);
        }
        for (const id of [...this.sprites.keys()]) if (!seen.has(id)) this.remove(id);
        this.synced = true; this.dirty = true; this.positionOverlay(); this.draw();
      }
      add(data, enter) {
        const s = { data, palette: stagePalette(data.id, data.capability), x: 0, y: 0, home: { x: 0, y: 0 }, facing: 1, phase: phaseOf(data), path: [], frame: 0, ft: 0, flash: 0 };
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
      select(id) { this.selected = id && this.sprites.has(id) ? id : null; for (const [k, p] of this.plates) p.setAttribute('aria-selected', String(k === this.selected)); }
      walkIn(s) { s.x = -12 * this.S; s.y = s.home.y + 9 * this.S; s.facing = 1; s.path = [{ x: s.home.x, y: s.y }, { x: s.home.x, y: s.home.y }]; s.phase = 'walking'; }
      courier(id) {
        const lead = [...this.sprites.values()].find(x => x.data.lead), to = this.sprites.get(id); if (!lead || !to || this.reduced) return;
        this.couriers.push({ x: lead.home.x, y: lead.home.y, from: { ...lead.home }, to: { x: to.home.x - 10 * this.S, y: to.home.y + 2 * this.S }, t: 0, dur: .9 + Math.hypot(to.home.x - lead.home.x, to.home.y - lead.home.y) / 420 });
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
        if (d.ctxRatio != null) { const m = this.el('div', 'ctm-stage-meter'); m.dataset.tone = d.ctxRatio >= .9 ? 'error' : d.ctxRatio >= .75 ? 'warn' : ''; m.style.setProperty('--p', Math.round(d.ctxRatio * 100) + '%'); m.title = `${t('live.contextPressure')} ${Math.round(d.ctxRatio * 100)}%`; m.append(this.el('i')); name.append(m); }
        const more = this.el('div', 'ctm-stage-plate-more');
        more.append(this.el('small', 'ctm-sub', [d.capability, d.statusLabel].filter(Boolean).join(' · ')));
        if (d.route) { const b = this.el('span', 'ctm-model-badge', d.routeAlias); b.dataset.grade = d.grade; b.title = d.route; more.append(b); }
        more.append(this.el('div', 'ctm-stage-plate-task', d.task ? `#${d.task.id} ${d.task.subject ?? ''}` : t('live.noTask')));
        if (d.openable && this.onOpen) { const btn = this.el('button', 'ctm-btn ctm-stage-open', t('stage.open')); btn.type = 'button'; btn.addEventListener('click', e => { e.stopPropagation(); this.onOpen(d.memberId); }); more.append(btn); }
        p.append(name, more);
        p.title = `${d.name} · ${d.statusLabel}${d.route ? ' · ' + d.route : ''}`; p.setAttribute('aria-label', p.title);
        const icon = this.icons.get(id); icon.textContent = d.icon ?? ''; icon.hidden = !d.icon;
        const bubble = this.bubbles.get(id); bubble.textContent = d.bubble ?? ''; bubble.title = d.bubble ?? ''; bubble.hidden = !d.bubble;
      }

      /* ---------- loop ---------- */
      busy() { return this.couriers.length > 0 || [...this.sprites.values()].some(s => s.phase === 'walking'); }
      loop(now) {
        this.schedule();
        if (!this.last) this.last = now;
        const idle = !this.busy(), minFrame = idle ? 66 : 0; if (now - this.last < minFrame) return;
        const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
        if (now - this.visibleAt > 1000) { const r = this.stage.getBoundingClientRect(); this.visible = r.width > 0 && r.bottom > 0 && r.top < (window.innerHeight || Infinity); this.visibleAt = now; }
        if ((document.hidden || !this.visible) && !this.dirty) return; // hidden or scrolled-away hosts still get one repaint per change
        this.update(dt); this.draw();
      }
      update(dt) {
        for (const s of this.sprites.values()) {
          s.ft += dt; const rate = s.phase === 'walking' ? .12 : s.phase === 'typing' ? .22 : .5;
          if (s.ft > rate) { s.ft = 0; s.frame = (s.frame + 1) % 4; }
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
        const css = getComputedStyle(this.stage), v = (k, d) => css.getPropertyValue(k).trim() || d;
        stageDrawRoom(ctx, this.px, w, h, S, { floorA: v('--ctm-stage-floor-a', '#1c1d26'), floorB: v('--ctm-stage-floor-b', '#202130'), grout: v('--ctm-stage-grout', 'rgba(0,0,0,.22)'), wall: v('--ctm-stage-wall', '#2a2b3a') });
        const desk = v('--ctm-stage-desk', '#3b2f26'), deskTop = v('--ctm-stage-desk-top', '#5a4535'), ents = [];
        for (const s of this.sprites.values()) {
          ents.push({ y: s.home.y + 3 * S, f: () => stageDrawDesk(this.px, s, S, desk, deskTop) });
          if (s.data.status !== 'inactive') ents.push({ y: s.y + (s.phase === 'walking' ? 6 * S : 0), f: () => stageDrawPerson(this.px, s, S) });
        }
        for (const c of this.couriers) ents.push({ y: 1e9, f: () => stageDrawCourier(this.px, c, S) });
        ents.sort((a, b) => a.y - b.y).forEach(e => e.f());
        this.dirty = false;
      }
    }
    function phaseOf(data) { return data.status === 'running' ? 'typing' : 'idle'; }
