    // ---------- pure helpers ----------
    const apiUrl = (path, params) => {
      const cleanPath = String(path ?? '').replace(/^\/+/, '');
      if (!params || typeof params !== 'object') return cleanPath;
      const USP = typeof URLSearchParams === 'function' ? URLSearchParams : null;
      if (USP) {
        const sp = new USP();
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) sp.set(k, String(v));
        }
        const qs = sp.toString();
        return qs ? `${cleanPath}?${qs}` : cleanPath;
      }
      const parts = [];
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
        }
      }
      return parts.length ? `${cleanPath}?${parts.join('&')}` : cleanPath;
    };
    const fmt = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? ''));
    const firstLine = text => { const s = String(text ?? '').trim(); const i = s.indexOf('\n'); return i === -1 ? s : s.slice(0, i); };
    const parse = raw => { if (typeof raw !== 'string' || !raw) return undefined; try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; } };
    const cleanError = text => String(text ?? '').replace(/^(?:Error|错误)[:：]\s*/, '');
    /** Durable result blocks flatten like the host's generic row: text parts joined, others as JSON. */
    function resultText(block) {
      const parts = (block.content ?? []).map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2));
      if (!parts.length && block.error) parts.push(`${block.error.name}: ${block.error.code}`);
      return parts.join('\n') || null;
    }
    /** Stage facts shared by every card; settled blocks carry `kind`. */
    function stage(props) {
      if (props.phase === 'preparing') return { state: 'preparing', args: {}, output: null, data: undefined };
      const block = props.block;
      const settled = 'kind' in block;
      const args = parse(settled ? block.call?.argsRaw : block.argsRaw) ?? {};
      const output = settled ? resultText(block) : null;
      const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok';
      return { state, args, output, data: state === 'ok' ? parse(output) : undefined };
    }

    // ---------- icons (original, stroke = currentColor) ----------
    const svg = (...children) => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...children);
    const ICONS = {
      plan: () => svg(h('path', { d: 'M3 3.5h10M3 8h6M3 12.5h4' }), h('path', { d: 'M10.5 10.5l1.5 1.5 2.5-3' })),
      free: () => svg(h('path', { d: 'M8.5 1.8L3.5 9h4l-.5 5.2L12.5 7h-4z' })),
      team: () => svg(h('circle', { cx: 6, cy: 5.5, r: 2.2 }), h('path', { d: 'M2 13c.5-2.3 2-3.5 4-3.5s3.5 1.2 4 3.5' }), h('circle', { cx: 11.5, cy: 6, r: 1.7 }), h('path', { d: 'M11 9.6c1.6 0 2.7.9 3 2.6' })),
    };
    const chevron = open => svg(h('path', { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' }));

    // ---------- shared row ----------
    function Card({ tool, icon, title, summary, summaryTone, badges, state, body, inspect, t }) {
      const [open, setOpen] = React.useState(false);
      const expandable = body != null && body !== false;
      const isOpen = open && expandable;
      const toggle = () => setOpen(v => !v);
      const rowProps = expandable ? {
        role: 'button', tabIndex: 0, 'aria-expanded': isOpen, 'data-expandable': '', onClick: toggle,
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } },
      } : {};
      const status = state === 'running' ? t('state.running') : state === 'error' ? t('state.failed') : state === 'stopped' ? t('state.stopped') : null;
      const tone = state === 'error' ? 'ctm-error' : state === 'stopped' ? 'ctm-warn' : summaryTone ?? '';
      return h('div', { className: 'ctm-card', 'data-tool': tool, 'data-state': state },
        h('div', { className: 'ctm-row', ...(isOpen ? { 'data-open': '' } : {}), ...rowProps },
          h('span', { className: 'ctm-lead' }, h('span', { className: 'ctm-ico' }, icon()), expandable ? h('span', { className: 'ctm-chev' }, chevron(isOpen)) : null),
          status ? h('span', { className: 'ctm-hidden' }, status) : null,
          h('span', { className: 'ctm-title' }, title),
          summary ? h('span', { className: 'ctm-sep', 'aria-hidden': true }) : null,
          summary ? h('span', { className: `ctm-summary ${tone}`, title: summary }, summary) : null,
          ...(badges ?? []).filter(Boolean)),
        isOpen ? h('div', { className: 'ctm-wrap' },
          h('div', { className: 'ctm-body' }, ...(Array.isArray(body) ? body : [body])),
          inspect ? h('button', { type: 'button', className: 'ctm-inspect', onClick: inspect }, t('action.inspect')) : null) : null);
    }
    const section = (label, ...children) => h('div', { className: 'ctm-section' }, label ? h('div', { className: 'ctm-label' }, label) : null, ...children);
    const badge = (text, tone, key) => h('span', { className: 'ctm-badge', 'data-tone': tone, key }, text);
    const chip = (label, value, key) => h('span', { className: 'ctm-chip', key }, label ? h('span', null, label) : null, h('span', null, value));
    const errorBody = (s, t) => s.state === 'error' && s.output ? section(null, h('pre', { className: 'ctm-pre ctm-error' }, cleanError(s.output))) : null;
    /** Results that are not the expected JSON (older sessions, other versions) stay readable as text. */
    const rawBody = (s, t) => s.state === 'ok' && s.output && !s.data ? section(t('output'), h('pre', { className: 'ctm-pre' }, s.output)) : null;
