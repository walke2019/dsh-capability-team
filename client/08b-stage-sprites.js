    // ---------- office stage: deterministic palettes and pixel sprites (canvas draws shapes only; every text is DOM) ----------
    const STAGE_SKINS = ['#f3d3a2', '#f6e1c3', '#e8b98a', '#d9a06e', '#fbe3cc'];
    /** Desk prop per capability; unknown capabilities get a bare desk. */
    const STAGE_PROPS = { orchestrator: 'map', 'technical-director': 'scroll', backend: 'gear', frontend: 'palette', research: 'glass', writer: 'brush', qa: 'flask' };
    function stageHash(str) { let n = 2166136261; for (const ch of String(str)) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619) >>> 0; } return n; }
    /** Theme-agnostic look: the role id picks the hues, the capability picks the prop, so any theme's names render consistently. */
    function stagePalette(id, capability) {
      const n = stageHash(id), hue = n % 360, hue2 = (hue + 150 + ((n >>> 8) % 60)) % 360;
      const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
      return { robe: hsl(hue, 55, 46), leg: hsl(hue, 45, 28), hat: hsl(hue2, 55, 42), accent: hsl((hue + 180) % 360, 75, 68),
        skin: STAGE_SKINS[(n >>> 16) % STAGE_SKINS.length], prop: STAGE_PROPS[capability] ?? 'none' };
    }
    /** Desk with monitor and the capability prop. `px(x, y, w, h, color)` paints one device-independent rectangle. */
    function stageDrawDesk(px, s, S, desk, deskTop) {
      const x = s.home.x, y = s.home.y, present = s.data.status !== 'inactive';
      px(x - 12 * S, y + S, 24 * S, 7 * S, desk); px(x - 12 * S, y, 24 * S, 5 * S, deskTop); px(x - 12 * S, y, 24 * S, S, 'rgba(255,255,255,.12)');
      px(x - 4 * S, y - 5 * S, 8 * S, 5 * S, '#1a1b22');
      stageDrawScreen(px, s, S, x, y, present);
      px(x - S, y, 2 * S, S, '#111');
      if (s.data.activity === 'reading') { // open book on the desk, the page flips every other frame
        px(x - 6 * S, y + S, 5 * S, 3 * S, '#f1ead6'); px(x - 4 * S, y + S, S, 3 * S, '#cdbf9a');
        if (s.frame % 2) px(x - 6 * S, y + S, 2 * S, 2 * S, '#ffffff');
      }
      const a = s.palette.accent;
      switch (s.palette.prop) {
        case 'map': px(x + 5 * S, y + S, 6 * S, 3 * S, '#d9c38a'); px(x + 6 * S, y + 2 * S, 2 * S, S, '#b3412f'); break;
        case 'scroll': px(x + 6 * S, y + S, 5 * S, 2 * S, '#e8dcbf'); px(x + 6 * S, y + 3 * S, 5 * S, S, '#cdbf9a'); break;
        case 'gear': px(x + 6 * S, y, 4 * S, 4 * S, '#9aa3ad'); px(x + 7 * S, y + S, 2 * S, 2 * S, '#3b4149'); px(x + 5 * S, y + S, S, 2 * S, '#9aa3ad'); px(x + 10 * S, y + S, S, 2 * S, '#9aa3ad'); break;
        case 'palette': px(x + 5 * S, y + S, 6 * S, 3 * S, '#e8dcbf'); px(x + 6 * S, y + 2 * S, S, S, '#e0493f'); px(x + 8 * S, y + 2 * S, S, S, '#3a9ad9'); px(x + 10 * S, y + 2 * S, S, S, '#3ddc84'); break;
        case 'glass': px(x + 6 * S, y, 3 * S, 3 * S, '#c9ced6'); px(x + 7 * S, y + S, S, S, '#a9d4ff'); px(x + 9 * S, y + 3 * S, 2 * S, S, '#8a5a2b'); break;
        case 'brush': px(x + 6 * S, y + S, 2 * S, 3 * S, '#2b2b2b'); px(x + 9 * S, y + S, 2 * S, 3 * S, '#f1ead6'); break;
        case 'flask': px(x + 7 * S, y - S, 2 * S, 2 * S, '#c9ced6'); px(x + 6 * S, y + S, 4 * S, 3 * S, '#d8dde3'); px(x + 7 * S, y + 2 * S, 2 * S, 2 * S, a); break;
        default: break;
      }
      px(x - 10 * S, y + S, 3 * S, 2 * S, '#c84b3c'); px(x - 9 * S, y, S, S, '#f0e9d8');
    }
    /** Monitor content per activity: code lines scroll while writing, a green terminal flickers, failures turn red. */
    function stageDrawScreen(px, s, S, x, y, present) {
      const a = s.data.activity, f = s.frame;
      const screen = !present ? '#2b3340' : a === 'failed' ? '#8f2f2f' : a === 'writing' ? '#1e3a5f' : a === 'terminal' ? '#0c2214'
        : a === 'browsing' || a === 'searching' ? '#2d5f8a' : a === 'messaging' || a === 'board' ? '#5b4a8a' : a === 'thinking' || a === 'reading' ? '#3a4a5c' : '#4b5563';
      px(x - 3 * S, y - 4 * S, 6 * S, 3 * S, screen);
      if (a === 'writing') for (let i = 0; i < 3; i++) px(x - 2 * S, y - (4 - i) * S, ((f + i) % 3 + 2) * S, S * .6, i === (f % 3) ? '#bfe6ff' : '#6fa8dc');
      else if (a === 'terminal') { px(x - 2 * S, y - 3 * S, 3 * S, S * .6, '#3ddc84'); if (f % 2) px(x + S, y - 3 * S, S, S * .6, '#b6ffcf'); }
      else if (a === 'failed') { px(x - .5 * S, y - 4 * S, S, 2 * S * .8, '#ffd0d0'); if (f % 2) px(x - .5 * S, y - 1.6 * S, S, S * .5, '#ffd0d0'); }
      else if (a === 'browsing' || a === 'searching') px(x - S, y - 4 * S + (f % 3) * S * .7, 2 * S, S * .6, '#a9d4ff');
      else if (a === 'messaging' || a === 'board') px(x - 2 * S, y - 3 * S, 4 * S, S, f % 2 ? '#d9c38a' : '#f3e7c6');
    }
    /**
     * 12×16 pixel person. The pose follows `s.data.activity` (typing / chin-on-hand / book / head-down / dozing) plus
     * the one-shot overlays: `s.gesture` (idle stretch or coffee) and `s.celebrate` (jump with raised arms).
     */
    function stageDrawPerson(px, s, S) {
      const c = s.palette, f = s.facing, walking = s.phase === 'walking', a = s.data.activity, fr = s.frame;
      const jumping = s.celebrate > 0, typing = !jumping && ['writing', 'terminal', 'searching', 'browsing', 'messaging', 'board', 'working'].includes(a);
      const lift = jumping ? Math.round(Math.abs(Math.sin(s.celebrate * 7)) * 4) * S : 0;
      const bob = !jumping && !walking && fr === 2 && a !== 'failed' ? S : 0;
      const x = s.x, y0 = s.y - 16 * S + bob - lift;
      const X = u => x + (f > 0 ? u : (12 - u - 1)) * S - 6 * S, Y = v => y0 + v * S;
      const R = (u, v, w, h, col) => px(f > 0 ? X(u) : X(u + w - 1), Y(v), w * S, h * S, col);
      const legA = walking ? (fr % 2 ? 1 : 0) : 0;
      R(4 - legA, 12, 2, 4, c.leg); R(7 + legA, 12, 2, 4, c.leg); R(4 - legA, 15, 2, 1, '#222'); R(7 + legA, 15, 2, 1, '#222');
      R(3, 6, 7, 6, c.robe); R(6, 6, 1, 6, c.accent);
      const arm = (u, top, col = c.robe) => { R(u, top, 1, 4, col); R(u, top + 3, 1, 1, c.skin); };
      const head = a === 'failed' ? 1 : 0; // failed members hang their head
      if (jumping || s.gesture === 'stretch') { R(2, 2, 1, 4, c.robe); R(10, 2, 1, 4, c.robe); R(2, 1, 1, 1, c.skin); R(10, 1, 1, 1, c.skin); }
      else if (a === 'thinking') { arm(2, 7); R(10, 5, 1, 3, c.robe); R(9, 5, 1, 1, c.skin); } // chin on hand
      else if (a === 'reading') { R(2, 8, 1, 2, c.robe); R(10, 8, 1, 2, c.robe); R(3, 9, 7, 2, '#e8dcbf'); R(6, 9, 1, 2, '#b3a37e'); }
      else if (s.gesture === 'coffee') { arm(2, 7); R(10, 5, 1, 3, c.robe); R(9, 5, 2, 2, '#f1ead6'); R(9, 5, 2, 1, '#6b4226'); }
      else {
        const fast = a === 'writing' ? fr % 2 : fr === 1 ? 1 : 0, other = a === 'writing' ? 1 - fr % 2 : fr === 3 ? 1 : 0;
        arm(2, 7 - (typing ? fast : 0)); arm(10, 7 - (typing ? other : 0));
      }
      R(4, 3 + head, 5, 3, c.skin);
      if (a === 'waiting' || a === 'failed') { R(5, 5 + head, 1, 1, '#222'); R(8, 5 + head, 1, 1, '#222'); } // closed / downcast eyes
      else { R(5, 4, 1, 1, '#222'); R(8, 4, 1, 1, '#222'); }
      R(3, head, 7, 3, c.hat); R(3, 2 + head, 7, 1, c.accent);
      if (s.data.lead) { R(4, -1 + head, 1, 1, '#ffd766'); R(6, -2 + head, 1, 2, '#ffd766'); R(8, -1 + head, 1, 1, '#ffd766'); }
      if (a === 'failed') { R(11, -3, 1, 3, '#ff5c5c'); R(11, 1, 1, 1, '#ff5c5c'); } // red "!"
      if (a === 'thinking') for (let i = 0; i < Math.max(1, fr % 4); i++) R(4 + i * 2, -3, 1, 1, '#e6e6ee'); // animated ellipsis
      if (a === 'waiting') { const z = fr % 3; R(10 + z, -2 - z, 2, 1, '#cfd8ff'); R(11 + z, -3 - z, 1, 1, '#cfd8ff'); R(10 + z, -4 - z, 2, 1, '#cfd8ff'); } // zzz
      if (s.data.ctxRatio >= .9) { R(1, 2 + (fr % 2), 1, 2, '#7fc8ff'); R(1, 4 + (fr % 2), 1, 1, '#c4e6ff'); } // sweat drop
    }
    /** A letter in flight: wax-sealed scroll from the Lead, blue-sealed report back to the Lead. */
    function stageDrawCourier(px, c, S) {
      px(c.x - 3 * S, c.y - 2 * S, 6 * S, 4 * S, '#f3e7c6'); px(c.x - 3 * S, c.y - 2 * S, 6 * S, S, '#d9c38a'); px(c.x - S, c.y - S, 2 * S, 2 * S, c.reply ? '#3a9ad9' : '#c84b3c');
    }
    /** Floor, wall and windows; reads the stage's colour tokens so light and dark themes both get a readable office. */
    function stageDrawRoom(ctx, px, w, h, S, colors) {
      ctx.fillStyle = colors.floorA; ctx.fillRect(0, 0, w, h);
      const tile = 8 * S;
      for (let y = 0; y < h; y += tile) for (let x = ((y / tile) % 2) * tile; x < w; x += tile * 2) px(x, y, tile, tile, colors.floorB);
      for (let y = 0; y < h; y += tile) px(0, y, w, 1, colors.grout);
      for (let x = 0; x < w; x += tile) px(x, 0, 1, h, colors.grout);
      px(0, 0, w, 10 * S, colors.wall); px(0, 10 * S, w, 1, 'rgba(0,0,0,.35)');
      for (let x = 6 * S; x < w; x += 42 * S) { px(x, 2 * S, 10 * S, 6 * S, '#7fb2e5'); px(x + S, 3 * S, 8 * S, 4 * S, '#a9d4ff'); }
    }
