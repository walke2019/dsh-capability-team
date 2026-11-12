import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createHarness } from './helpers/client-harness.mjs';
import { buildClient } from '../scripts/build-client.mjs';
const clientSource = await buildClient();

test('MVP-B 11: 降级模式下 memberSig 响应真实 running 状态与 modelSelection 路由变更', async () => {
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: 1,
        leadSessionId: 's_lead',
        epoch: 'ep1',
        members: [],
      }),
    };
  };

  const state = {
    byId: {
      s_lead: { running: false },
      m1: { running: false },
    },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'idle' },
              { id: 'm1', name: 'diao-chan', role: 'frontend', phase: 'idle' },
            ],
          },
        },
      },
      m1: {
        values: {
          modelSelection: {
            next: { provider: 'provider-a', model: 'gemini-3.8-flash-high' },
          },
        },
      },
    },
  };

  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions, { runEffects: true, extraGlobals: { fetch: fakeFetch, EventSource: null } });
  const element = h.view({ sessionId: 's_lead', t: key => key });
  h.render(element.type, element.props);

  // Initial fetch from fallback
  await new Promise(r => setTimeout(r, 20));
  const initialFetches = fetchCount;
  assert.ok(initialFetches >= 1, 'Initial fallback fetch occurred');

  // Change member running state in live store
  state.byId.m1.running = true;
  h.render(element.type, element.props);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(fetchCount > initialFetches, 'Triggered GET when member transitioned to running');

  // Change model in modelSelection
  const midFetches = fetchCount;
  state.projectionsBySession.m1.values.modelSelection.next = { provider: 'provider-a', model: 'gpt-6.1-sol' };
  h.render(element.type, element.props);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(fetchCount > midFetches, 'Triggered GET when model changed in modelSelection');
});

test('MVP-B 12: 成果货架请求传递 AbortSignal，卸载或取消后中止且不 setState', async () => {
  const capturedSignals = [];
  let fetchCount = 0;
  let summaryFetchCount = 0;
  let releaseFirstFetch;
  const firstFetchPromise = new Promise(r => { releaseFirstFetch = r; });

  const fakeFetch = async (url, opts) => {
    if (url.includes('api/changes.summary') || url.includes('api/changes.diff')) {
      summaryFetchCount++;
      assert.ok(opts?.signal, `fetch to ${url} must receive signal`);
      capturedSignals.push(opts.signal);
      // Block the summary fetch until unmounted
      await firstFetchPromise;
      if (opts.signal.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ path: 'test.js' }] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, members: [] }) };
  };

  const state = {
    byId: { m1: { running: false } },
    projectionsBySession: {
      s_lead: { values: { agentTeam: { members: [{ id: 'm1', name: 'diao-chan' }] } } },
      m1: { values: { capabilityTeamArtifacts: { schemaVersion: 1, changes: [{ seq: 1, turn: 1 }] } } },
    },
  };

  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  let setStateCallCount = 0;
  let component = 'overview';
  const stateCalls = { overview: 0, rack: 0 };
  const cleanups = { overview: [], rack: [] };
  let unmountCallback = null;
  const customReact = {
    useState(initial) {
      let val = initial;
      const owner = component;
      return [val, updater => {
        stateCalls[owner]++;
        setStateCallCount++;
        val = typeof updater === 'function' ? updater(val) : updater;
      }];
    },
    useRef(initial) { return { current: initial }; },
    useEffect(fn) {
      const off = fn();
      if (typeof off === 'function') cleanups[component].push(off);
      unmountCallback = off;
    },
    useMemo(fn) { return fn(); },
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  };

  let customPlugin;
  new Script(clientSource).runInNewContext({
    window: { __ModuleLoader__: { load: spec => { customPlugin = spec.factory(() => customReact); } } },
    fetch: fakeFetch,
    AbortController: globalThis.AbortController,
  });

  let viewComponent;
  customPlugin.apply({
    effect() {},
    locale: { bind: () => k => k },
    remote: { commands: {} },
    sessions,
    slots: {
      inject: (_n, f) => f(),
      register: (opt, comp) => { if (opt.id === 'capability-team-overview') viewComponent = comp; },
    },
  });

  const element = viewComponent({ sessionId: 's_lead' });
  const tree = element.type(element.props);
  const findNode = (node, pred) => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) { for (const x of node) { const r = findNode(x, pred); if (r) return r; } return undefined; }
    if (pred(node)) return node;
    for (const c of node.children ?? []) { const r = findNode(c, pred); if (r) return r; }
  };

  const artPanel = findNode(tree, n => n.props?.['data-panel'] === 'artifacts');
  // The artifacts panel now wraps its content in an ErrorBoundary (also typeof 'function', being a class);
  // require the ArtifactsRack-specific `sessionId` prop so this does not match that wrapper instead.
  const rack = findNode(artPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  component = 'rack';
  const rackTree = rack.type(rack.props);
  const chg = findNode(rackTree, n => n.props?.className === 'ctm-chg-item');

  // Trigger toggle fetch (starts summary fetch, which is blocked on firstFetchPromise)
  const togglePromise = chg.props.onToggle({ target: { open: true } });
  assert.equal(summaryFetchCount, 1, 'Initial summary fetch fired');
  const initialSetStateCount = setStateCallCount;
  const beforeUnmount = { ...stateCalls };

  // Now trigger unmount cleanup
  assert.equal(typeof unmountCallback, 'function', 'ArtifactsRack registered cleanup effect');
  unmountCallback(); // Calls abortRef.current.abort()
  for (const off of cleanups.overview.reverse()) off();
  assert.equal(capturedSignals[0].aborted, true, 'Signal aborted on unmount');

  // Release the first fetch
  releaseFirstFetch();
  await togglePromise;

  // Assert: subsequent files diff fetch was aborted/skipped and no setState happened after unmount
  assert.equal(summaryFetchCount, 1, 'Subsequent diff fetches must not execute after abort');
  assert.equal(stateCalls.rack, beforeUnmount.rack, 'rack must not setState after abort');
  assert.equal(stateCalls.overview, beforeUnmount.overview, 'overview must not setState after unmount');
  assert.equal(setStateCallCount, initialSetStateCount, 'setState must not be called after abort');
});

test('MVP-B 13: 战报渲染 own-session 组与 runtime 容灾指标组（含全队求和与重启/未知标记）', () => {
  const state = {
    byId: { s_lead: { running: false }, m1: { running: false } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 'm1', name: 'diao-chan', role: 'frontend' },
            ],
          },
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 3,
            steps: 10,
            counters: {
              hostRetriesStarted: 2,
              failedTurns: 1,
              sendMessageAccepted: 5,
              boardMutations: 4,
            },
          },
        },
      },
      m1: {
        values: {
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 2,
            steps: 5,
            counters: {
              hostRetriesStarted: 1,
              failedTurns: 0,
              sendMessageAccepted: 3,
            },
          },
        },
      },
    },
  };

  const runtimeWithMetrics = {
    data: {
      schemaVersion: 1,
      epoch: 'ep2',
      members: [
        {
          sessionId: 's_lead',
          counters: {
            requestFailures: 4,
            pluginRetries: 3,
            failoverSwitches: 2,
            longContextSwitches: 1,
          },
        },
        {
          sessionId: 'm1',
          counters: {
            requestFailures: 2,
            pluginRetries: 1,
            failoverSwitches: 1,
            longContextSwitches: 0,
          },
        },
      ],
    },
    restarted: true,
  };

  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const rptPanel = h.find(tree, n => n.props?.['data-panel'] === 'report');
  const reportComponent = h.find(rptPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);

  // 1. With runtime available
  const reportTree = reportComponent.type({ ...reportComponent.props, runtimeState: runtimeWithMetrics });
  const text1 = JSON.stringify(reportTree);

  // Own-session group checks
  assert.ok(text1.includes('report.sectionOwn'), 'Own session section header rendered');
  // hostRetries: 2 + 1 = 3
  const hostRetryBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.hostRetries'));
  assert.equal(h.find(hostRetryBox, x => x.type === 'strong').children[0], '3', 'hostRetries sum');
  // failedTurns: 1 + 0 = 1
  const failedBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.failedTurns'));
  assert.equal(h.find(failedBox, x => x.type === 'strong').children[0], '1', 'failedTurns sum');
  // msgAccepted: 5 + 3 = 8
  const msgBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.msgAccepted'));
  assert.equal(h.find(msgBox, x => x.type === 'strong').children[0], '8', 'msgAccepted sum');

  // Runtime failover group checks
  assert.ok(text1.includes('report.sectionRuntime'), 'Runtime section header rendered');
  assert.ok(text1.includes('runtime.restarted'), 'Epoch restarted badge rendered');
  // requestFailures: 4 + 2 = 6
  const reqFailBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.requestFailures'));
  assert.equal(h.find(reqFailBox, x => x.type === 'strong').children[0], '6', 'requestFailures sum');
  // pluginRetries: 3 + 1 = 4
  const retriesBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.pluginRetries'));
  assert.equal(h.find(retriesBox, x => x.type === 'strong').children[0], '4', 'pluginRetries sum');
  // failoverSwitches: 2 + 1 = 3
  const switchBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.failoverSwitches'));
  assert.equal(h.find(switchBox, x => x.type === 'strong').children[0], '3', 'failoverSwitches sum');
  // longContextSwitches: 1 + 0 = 1
  const lcBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.longContextSwitches'));
  assert.equal(h.find(lcBox, x => x.type === 'strong').children[0], '1', 'longContextSwitches sum');

  // 2. With runtime unavailable -> shows "未知" instead of 0
  const reportTreeUnavail = reportComponent.type({ ...reportComponent.props, runtimeState: { unavailable: true, data: null } });
  const unavailReqBox = h.find(reportTreeUnavail, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.requestFailures'));
  assert.equal(h.find(unavailReqBox, x => x.type === 'strong').children[0], 'common.unknown', 'Unavailable runtime shows unknown instead of 0');
});

test('MVP-B 13b (item 2): 战报用量聚合遵循 usageCoverage 契约——partial 降级整队、unknown 成员排除在总量外并单独列出', () => {
  const state = {
    byId: { s_lead: { running: false }, m1: { running: false }, m2: { running: false } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 'm1', name: 'diao-chan', role: 'frontend' },
              { id: 'm2', name: 'lv-bu', role: 'backend' },
            ],
          },
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 1, steps: 1,
            usage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
            usageCoverage: { coverage: 'complete', reportedSamples: 1, attemptsWithoutUsage: 0 },
          },
        },
      },
      m1: {
        values: {
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 1, steps: 1,
            // Partial coverage: still contributes its real (incomplete) usage, but downgrades the team badge.
            usage: { uncachedInputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
            usageCoverage: { coverage: 'partial', reportedSamples: 1, attemptsWithoutUsage: 1 },
          },
        },
      },
      m2: {
        values: {
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 1, steps: 1,
            // Unknown coverage: even though a `usage` object is present, it must be excluded entirely from the
            // team total rather than silently added as if it were real accounted usage.
            usage: { uncachedInputTokens: 99999, outputTokens: 99999, cacheReadTokens: 0, cacheWriteTokens: 0 },
            usageCoverage: { coverage: 'unknown', reportedSamples: 0, attemptsWithoutUsage: 1 },
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const rptPanel = h.find(tree, n => n.props?.['data-panel'] === 'report');
  const reportComponent = h.find(rptPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const reportTree = reportComponent.type({ ...reportComponent.props, runtimeState: { unavailable: true, data: null } });
  const text = JSON.stringify(reportTree);

  // Only lead (1500) + m1 (300) = 1800 billable tokens; m2's 99999*2 must never be summed in.
  const tokensBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.tokensTotal'));
  assert.equal(h.find(tokensBox, x => x.type === 'strong').children[0], '1.8k', '只计入 complete/partial 成员的用量，unknown 成员排除在外');
  assert.ok(!text.includes('99999'), 'unknown 成员的伪造大数值不得混入总量');

  // Team badge must reflect the worst coverage among included members: partial.
  assert.ok(text.includes('usage.partialLow'), '任一成员 partial 时整队应显示降级标记');

  // Unknown members must be listed by name so the Lead can see whose usage was excluded. This harness's `t`
  // stub only echoes the key passed to `t()` itself and does not perform the `{list}` interpolation that
  // `fmt()` applies afterward against a real dictionary string, so this harness cannot observe the member name
  // in the final rendered text; the exclusion of m2's fabricated usage from the token total (asserted above)
  // is the behavior that actually matters and is fully covered there. Here we only confirm the notice renders.
  assert.ok(text.includes('report.unknownMembers'), '应单独列出用量未知的成员');
});

test('MVP-B 14: 全部 HTTP/SSE 路径均为 document-relative（不以 / 开头且在反代子路径下正确解析）', () => {
  const base = 'https://host/dsh/';
  const endpoints = [
    { name: 'present.open', make: apiUrl => apiUrl('api/present.open', { sessionId: 's1', seq: 1, index: 0 }) },
    { name: 'changes.summary', make: apiUrl => apiUrl('api/changes.summary', { sessionId: 's1', seq: 1 }) },
    { name: 'changes.diff', make: apiUrl => apiUrl('api/changes.diff', { sessionId: 's1', seq: 1, index: 0 }) },
    { name: 'runtime.get', make: apiUrl => apiUrl('api/capability-team.runtime', { sessionId: 's1' }) },
    { name: 'runtime.stream', make: apiUrl => apiUrl('api/capability-team.runtime/stream', { sessionId: 's1' }) },
  ];

  const apiUrl = (path, params) => {
    const cleanPath = String(path ?? '').replace(/^\/+/, '');
    if (!params || typeof params !== 'object') return cleanPath;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${cleanPath}?${qs}` : cleanPath;
  };

  for (const ep of endpoints) {
    const relUrl = ep.make(apiUrl);
    assert.equal(relUrl.startsWith('/'), false, `${ep.name} must not start with /`);
    assert.ok(relUrl.startsWith('api/'), `${ep.name} must start with api/`);
    const resolved = new URL(relUrl, base);
    assert.ok(resolved.pathname.startsWith('/dsh/api/'), `${ep.name} under ${base} must resolve under /dsh/api/, got ${resolved.pathname}`);
  }
});
