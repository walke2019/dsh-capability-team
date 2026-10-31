import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOKEN_RULES, createTokenDiscipline, tokenRuleText, trimText, validateTokenRules } from '../token-discipline.js';
import { effectiveConfig } from '../config.js';
import { policy } from '../roles.js';

test('token 规则：默认值、校验、写进团队铁律', () => {
  assert.deepEqual(validateTokenRules(undefined), TOKEN_RULES);
  assert.equal(validateTokenRules(false), false);
  assert.throws(() => validateTokenRules({ idleCompactRatio: 0.95 }), /0\.1–0\.9/);
  assert.throws(() => validateTokenRules({ keepHeadChars: 5000, keepTailChars: 2000 }), /小于/);
  assert.deepEqual(effectiveConfig({}).workflow.tokens, TOKEN_RULES);
  assert.match(policy, /Token 铁律/);
  assert.equal(tokenRuleText(false), '');
});

const member = { id: 'm', session: {} };
const mkCtx = (extra = {}) => ({ agentTeams: { tryMembership: a => (a === member ? { role: 'teammate' } : undefined) }, ...extra });

test('长的命令输出只保留头尾，完整内容存到文件；读文件结果不截', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spill-'));
  const td = createTokenDiscipline(mkCtx(), {}, { spillDir: dir, rulesOf: () => TOKEN_RULES });
  const long = 'L'.repeat(4000) + 'MIDDLE' + 'T'.repeat(4000);
  const out = await td.trim({ name: 'bash', callId: 'c1', agent: member }, { content: [{ type: 'text', text: long }] });
  assert.ok(out[0].text.length < 5200);
  assert.ok(!out[0].text.includes('MIDDLE'));
  assert.match(out[0].text, /完整输出：.*c1\.txt/);
  assert.equal(await readFile(join(dir, 'c1.txt'), 'utf8'), long);
  assert.equal(await td.trim({ name: 'read', agent: member }, { content: [{ type: 'text', text: long }] }), undefined, 'read 不截');
  assert.equal(await td.trim({ name: 'bash', agent: member }, { content: [{ type: 'text', text: 'short' }] }), undefined);
  assert.equal(await td.trim({ name: 'bash', agent: { id: 'x' } }, { content: [{ type: 'text', text: long }] }), undefined, '非团队会话不动');
  assert.equal(trimText('abcdefghij', { keepHeadChars: 2, keepTailChars: 2 }, '/p').startsWith('ab'), true);
});

test('post-execute 钩子只在接受且未被别人改写时替换内容', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spill-'));
  let hook;
  const td = createTokenDiscipline(mkCtx({ on: (name, fn) => { if (name === 'tools/post-execute') hook = fn; } }), {}, { spillDir: dir, rulesOf: () => TOKEN_RULES });
  td.register();
  const big = { content: [{ type: 'text', text: 'x'.repeat(9000) }] };
  const accepted = await hook({ name: 'grep', callId: 'g', agent: member }, big, async () => ({ kind: 'accept' }));
  assert.ok(accepted.content[0].text.length < 5200);
  const blocked = await hook({ name: 'grep', agent: member }, big, async () => ({ kind: 'block', feedback: [] }));
  assert.equal(blocked.kind, 'block');
  const failed = await hook({ name: 'grep', agent: member }, { ...big, isError: true }, async () => ({ kind: 'accept' }));
  assert.equal(failed.content, undefined, '失败结果不动');
});

test('成员空闲且上下文超过阈值时压缩；未超过、非成员、正在压缩时不压缩', async () => {
  const calls = [];
  const state = { contextWindow: 200000, surfaceTokens: 0 };
  let tokens = 90000;
  const service = { compactNow: async agent => { calls.push(agent.id); return { shadowedSeqs: [] }; } };
  const projections = { stateOf: () => ({ ...state, surfaceTokens: tokens }) };
  const ctx = mkCtx({ get: () => projections, on: () => {}, inject: (names, fn) => { assert.deepEqual(names, ['compaction']); fn({ compaction: service }); } });
  const td = createTokenDiscipline(ctx, {}, { rulesOf: () => TOKEN_RULES });
  td.register();
  assert.equal(await td.compactIdle(member), true, '90k/200k = 45% ≥ 35%');
  tokens = 50000;
  assert.equal(await td.compactIdle(member), false, '25% 不压缩');
  tokens = 150000;
  assert.equal(await td.compactIdle({ id: 'other', session: {} }), false, '非成员不动');
  const busy = createTokenDiscipline(mkCtx({ get: () => projections, on: () => {}, inject: (_n, fn) => fn({ compaction: { compactNow: async () => { throw new Error('busy'); } } }) }), {}, { rulesOf: () => TOKEN_RULES });
  busy.register();
  assert.equal(await busy.compactIdle(member), false, '忙时放弃，下次空闲再试');
  assert.deepEqual(calls, ['m']);
});

test('宿主禁止直接读取未注入的服务时也不会抛出（曾因此导致 DSH 宿主退出）', async () => {
  const guarded = new Proxy(mkCtx({ get: name => { if (name === 'compaction') throw new Error('cannot get property "compaction" without inject'); return undefined; } }), {
    get(target, prop) { if (prop === 'compaction') throw new Error('cannot get property "compaction" without inject'); return target[prop]; },
  });
  let listener;
  guarded.on = (name, fn) => { if (name === 'agent/status') listener = fn; };
  const td = createTokenDiscipline(guarded, {}, { rulesOf: () => TOKEN_RULES });
  td.register();
  assert.equal(await td.compactIdle(member), false);
  assert.doesNotThrow(() => listener({ agent: member, status: 'idle' }));
  await new Promise(resolve => setTimeout(resolve, 10)); // an unhandled rejection would fail the test run
});
