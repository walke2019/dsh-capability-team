import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../memory-store.js';
import { RECALL_HEADER, formatRecall, hookOutput, recall } from '../scripts/memory-cli.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'memcli-'));
process.env.CAPABILITY_TEAM_HOME = await tmp();
const CLI = fileURLToPath(new URL('../scripts/memory-cli.mjs', import.meta.url));

async function seeded() {
  const root = await tmp();
  const cwd = resolve(await tmp());
  const store = createMemoryStore(root);
  const project = { kind: 'project', project: cwd };
  await store.write({ scope: project, kind: 'pitfall', text: 'list_agents 返回的 lead 模型字段不可信，要看会话 jsonl' });
  await store.write({ scope: project, kind: 'decision', text: '嵌入模型统一走 jina，lead 不直接调用' });
  await store.write({ scope: project, kind: 'result', text: 'lead 模型路由检查已完成，结论正常' });
  await store.write({ scope: project, kind: 'note', text: 'lead 模型备注：随手记录' });
  await store.write({ scope: { kind: 'role', project: cwd, role: 'qa' }, kind: 'pitfall', text: 'qa 私有：lead 模型显示有误' });
  await store.write({ scope: { kind: 'session', project: cwd, session: 's1' }, kind: 'pitfall', text: '会话私有：lead 模型显示有误' });
  await store.write({ scope: { kind: 'global' }, kind: 'pitfall', text: '跨项目：lead 模型以请求头为准' });
  await store.write({ scope: { kind: 'project', project: resolve(await tmp()) }, kind: 'pitfall', text: '别的项目：lead 模型显示有误' });
  return { root, cwd, store };
}

test('召回只含当前项目与 global 的 pitfall/decision，排除角色私有、会话私有和别的项目', async () => {
  const { root, cwd } = await seeded();
  const texts = (await recall({ query: 'lead 模型显示不对', cwd, root, k: 20 })).map(r => r.memory.text).sort();
  assert.deepEqual(texts, [
    'list_agents 返回的 lead 模型字段不可信，要看会话 jsonl',
    '嵌入模型统一走 jina，lead 不直接调用',
    '跨项目：lead 模型以请求头为准',
  ].sort());
});

test('与提示词重合的多字词不足两个时不注入，避免短指令带出无关记忆', async () => {
  const { root, cwd } = await seeded();
  assert.deepEqual(await recall({ query: '做第一步', cwd, root }), []);
  assert.deepEqual(await recall({ query: '   ', cwd, root }), []);
});

test('召回是只读的：不更新命中计数，不改动记忆文件', async () => {
  const { root, cwd } = await seeded();
  const dir = join(root, 'memory');
  const snapshot = async () => Promise.all((await readdir(dir)).sort().map(f => readFile(join(dir, f), 'utf8')));
  const before = await snapshot();
  assert.ok((await recall({ query: 'lead 模型字段', cwd, root })).length > 0);
  assert.deepEqual(await snapshot(), before);
});

test('注入块含固定标题，总长（含标题）不超预算，并对记忆正文脱敏', () => {
  const mk = (text, kind = 'pitfall', scope = { kind: 'project', project: 'p' }) => ({ memory: { kind, scope, text } });
  const block = formatRecall([mk('第一条坑'), mk('a'.repeat(500)), mk('跨项目决定', 'decision', { kind: 'global' })], 80);
  assert.ok(block.startsWith(RECALL_HEADER));
  assert.ok(block.length <= 80);
  assert.match(block, /- \[pitfall\] 第一条坑/);
  assert.match(block, /- \[decision·global\] 跨项目决定/);
  assert.doesNotMatch(block, /aaaa/);
  assert.equal(formatRecall([], 2400), '');
  const leaked = formatRecall([mk('不要提交 OPENVIKING_API_KEY=abcdefgh12345678 到仓库')]);
  assert.doesNotMatch(leaked, /abcdefgh12345678/);
});

test('hook 输出符合 UserPromptSubmit 的 additionalContext 格式，无内容时为空', async () => {
  const { root, cwd } = await seeded();
  const out = JSON.parse(await hookOutput({ prompt: 'lead 模型字段为什么不对', cwd }, { root }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(RECALL_HEADER));
  assert.equal(await hookOutput({ prompt: '', cwd }, { root }), '');
  assert.equal(await hookOutput({}, { root }), '');
});

test('hook 进程遇到坏输入也正常退出且不输出，绝不阻塞用户提示', () => {
  const run = spawnSync(process.execPath, [CLI, 'hook'], { input: 'not json', encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  const usage = spawnSync(process.execPath, [CLI], { encoding: 'utf8', windowsHide: true });
  assert.equal(usage.status, 2);
});
