    // ---------- role skins: neutral default names are localized; Three Kingdoms quotes apply only to that roster ----------
    const NEUTRAL_ROLE_NAMES = { lead: 'Lead', architect: 'Architect', backend: 'Backend', frontend: 'Frontend', researcher: 'Researcher', writer: 'Writer', qa: 'QA' };
    const THREE_KINGDOMS_IDS = ['zhuge-liang', 'lv-bu', 'diao-chan', 'zhao-yun', 'chen-lin', 'zhou-yu'];
    /** Idle quote key of one role id; `heroes` marks a roster using the optional three-kingdoms theme. */
    function characterQuoteKey(roleId, heroes = false) {
      if (roleId === 'lead' || roleId === 'sun-quan') return heroes || roleId === 'sun-quan' ? 'live.quote.sun-quan' : 'live.quote.lead';
      if (THREE_KINGDOMS_IDS.includes(roleId) || Object.hasOwn(NEUTRAL_ROLE_NAMES, roleId)) return `live.quote.${roleId}`;
      return 'live.quote.default';
    }
    /** Roles with untouched neutral default names translated (`role.name.<id>`) and their theme-aware idle quote key. */
    function localizeRoles(roles, t) {
      const list = Array.isArray(roles) ? roles : [];
      const heroes = list.some(r => THREE_KINGDOMS_IDS.includes(r?.id));
      return list.map(r => {
        if (!r || typeof r !== 'object') return r;
        const key = `role.name.${r.id}`, text = typeof t === 'function' && NEUTRAL_ROLE_NAMES[r.id] === r.displayName ? t(key) : key;
        return { ...r, ...(text !== key ? { displayName: text } : {}), quoteKey: characterQuoteKey(r.id, heroes) };
      });
    }
    Object.assign(zh, {
      'role.name.lead': '主控', 'role.name.architect': '技术总监', 'role.name.backend': '后端', 'role.name.frontend': '前端',
      'role.name.researcher': '研究员', 'role.name.writer': '文档', 'role.name.qa': '测试',
      'live.quote.lead': '目标已明确，分工就绪。', 'live.quote.architect': '先定方案与接口，再动手。', 'live.quote.backend': '接口与数据，随时待命。',
      'live.quote.frontend': '页面与交互，交给我。', 'live.quote.researcher': '先查证，再下结论。', 'live.quote.writer': '文档随时可以落笔。', 'live.quote.qa': '没有证据，不算完成。',
    });
    Object.assign(en, {
      'role.name.lead': 'Lead', 'role.name.architect': 'Architect', 'role.name.backend': 'Backend', 'role.name.frontend': 'Frontend',
      'role.name.researcher': 'Researcher', 'role.name.writer': 'Writer', 'role.name.qa': 'QA',
      'live.quote.lead': 'Goals set, work assigned.', 'live.quote.architect': 'Design and contracts first, then code.', 'live.quote.backend': 'APIs and data, ready when you are.',
      'live.quote.frontend': 'Pages and interactions, on it.', 'live.quote.researcher': 'Verify first, conclude second.', 'live.quote.writer': 'Docs ready to be written.', 'live.quote.qa': 'No evidence, not done.',
    });
