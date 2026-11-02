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
      const screen = !present ? '#2b3340' : s.data.status === 'failed' ? '#8f2f2f' : s.phase === 'typing' ? '#3a9ad9' : '#4b5563';
      px(x - 3 * S, y - 4 * S, 6 * S, 3 * S, screen);
      if (s.phase === 'typing' && s.frame % 2) px(x - 2 * S, y - 3 * S, 2 * S, S, '#bfe6ff');
      px(x - S, y, 2 * S, S, '#111');
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
    /** 12×16 pixel person; `lead` wears the crown, `failed` shows a red mark, walking alternates the legs. */
    function stageDrawPerson(px, s, S) {
      const c = s.palette, f = s.facing, walking = s.phase === 'walking';
      const bob = (s.phase === 'typing' || s.phase === 'idle') && s.frame === 2 ? S : 0;
      const x = s.x, y0 = s.y - 16 * S + bob;
      const X = u => x + (f > 0 ? u : (12 - u - 1)) * S - 6 * S, Y = v => y0 + v * S;
      const R = (u, v, w, h, col) => px(f > 0 ? X(u) : X(u + w - 1), Y(v), w * S, h * S, col);
      const legA = walking ? (s.frame % 2 ? 1 : 0) : 0;
      R(4 - legA, 12, 2, 4, c.leg); R(7 + legA, 12, 2, 4, c.leg); R(4 - legA, 15, 2, 1, '#222'); R(7 + legA, 15, 2, 1, '#222');
      R(3, 6, 7, 6, c.robe); R(6, 6, 1, 6, c.accent);
      const armL = s.phase === 'typing' && s.frame === 1 ? 1 : 0, armR = s.phase === 'typing' && s.frame === 3 ? 1 : 0;
      R(2, 7 - armL, 1, 4, c.robe); R(10, 7 - armR, 1, 4, c.robe); R(2, 10 - armL, 1, 1, c.skin); R(10, 10 - armR, 1, 1, c.skin);
      R(4, 3, 5, 3, c.skin); R(5, 4, 1, 1, '#222'); R(8, 4, 1, 1, '#222');
      R(3, 0, 7, 3, c.hat); R(3, 2, 7, 1, c.accent);
      if (s.data.lead) { R(4, -1, 1, 1, '#ffd766'); R(6, -2, 1, 2, '#ffd766'); R(8, -1, 1, 1, '#ffd766'); }
      if (s.data.status === 'failed') R(11, 2, 1, 1, '#ff5c5c');
    }
    /** A dispatch scroll flying from the Lead's desk to a teammate. */
    function stageDrawCourier(px, c, S) {
      px(c.x - 3 * S, c.y - 2 * S, 6 * S, 4 * S, '#f3e7c6'); px(c.x - 3 * S, c.y - 2 * S, 6 * S, S, '#d9c38a'); px(c.x - S, c.y - S, 2 * S, 2 * S, '#c84b3c');
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
