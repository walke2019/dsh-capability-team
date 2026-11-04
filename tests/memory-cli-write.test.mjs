import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../memory-store.js';
import { RECALL_ROLE, recall, writeMemory } from '../scripts/memory-cli.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'memcliw-'));
process.env.CAPABILITY_TEAM_HOME = await tmp();
const CLI = fileURLToPath(new URL('../scripts/memory-cli.mjs', import.meta.url));
const setup = async () => ({ root: await tmp(), cwd: resolve(await tmp()) });
const onDisk = async root => {
  const dir = join(root, 'memory');
  return (await Promise.all((await readdir(dir)).map(f => readFile(join(dir, f), 'utf8')))).join('\n');
};

test('写入项目级记忆后，外部召回和团队任意角色都能读到，来源标记为外部智能体', async () => {
  const { root, cwd } = await setup();
  const out = await writeMemory({ kind: 'pitfall', text: 'list_agents 的 lead 模型字段不可信，看会话 jsonl', tags: ['lead'], cwd, root });
  assert.equal(out.saved, true);
  assert.equal(out.scope, 'project');
  assert.equal(out.sync, 'local-only');
  assert.deepEqual((await recall({ query: 'lead 模型字段', cwd, root })).map(r => r.memory.id), [out.id]);
  const teamView = await createMemoryStore(root).search({ project: cwd, role: 'qa', query: 'lead 模型字段', k: 5 });
  assert.equal(teamView[0].memory.id, out.id);
  assert.equal(teamView[0].memory.source.member, RECALL_ROLE);
  assert.equal(teamView[0].memory.vector, null, '外部写入不生成向量、不联网');
});

test('global 写入跨项目可见；相同正文合并，同主题新决定替换旧决定', async () => {
  const { root, cwd } = await setup();
  const other = resolve(await tmp());
  await writeMemory({ kind: 'decision', scope: 'global', text: '提交信息统一使用英文', root });
  assert.equal((await recall({ query: '提交信息 英文', cwd: other, root })).length, 1);
  const first = await writeMemory({ kind: 'decision', key: 'embed', text: '嵌入走直连服务', cwd, root });
  const again = await writeMemory({ kind: 'decision', key: 'embed', text: '嵌入走直连服务', cwd, root });
  assert.equal(again.merged, true);
  assert.equal(again.id, first.id);
  const next = await writeMemory({ kind: 'decision', key: 'embed', text: '嵌入改走统一网关服务', cwd, root });
  assert.equal(next.superseded, 1);
  const texts = (await recall({ query: '嵌入 服务', cwd, root, k: 10 })).map(r => r.memory.text);
  assert.ok(texts.includes('嵌入改走统一网关服务'));
  assert.ok(!texts.includes('嵌入走直连服务'), '被替换的旧决定不再召回');
});

test('正文、主题和标签写盘前脱敏', async () => {
  const { root, cwd } = await setup();
  await writeMemory({ kind: 'note', text: '调试时用过 OPENVIKING_API_KEY=abcdefgh12345678 不要再贴', key: 'token=zzzzzzzz99999999', tags: ['secret=yyyyyyyy88888888'], cwd, root });
  const raw = await onDisk(root);
  for (const value of ['abcdefgh12345678', 'zzzzzzzz99999999', 'yyyyyyyy88888888']) assert.ok(!raw.includes(value), value);
});

test('拒绝非法类型、角色或会话范围、过短过长正文、缺少目录和过多标签', async () => {
  const { root, cwd } = await setup();
  const bad = [
    { kind: 'result', text: '不允许的类型示例', cwd },
    { kind: 'pitfall', scope: 'role', text: '不允许写角色私有', cwd },
    { kind: 'pitfall', scope: 'session', text: '不允许写会话私有', cwd },
    { kind: 'pitfall', text: '短', cwd },
    { kind: 'pitfall', text: 'x'.repeat(2001), cwd },
    { kind: 'pitfall', text: '项目级必须有目录' },
    { kind: 'pitfall', text: '标签太多的示例', tags: Array.from({ length: 11 }, (_, i) => `t${i}`), cwd },
    { kind: 'pitfall', text: '主题太长的示例', key: 'k'.repeat(121), cwd },
  ];
  for (const input of bad) await assert.rejects(writeMemory({ ...input, root }), undefined, JSON.stringify(input).slice(0, 60));
});

test('命令行写入：参数或标准输入给正文，成功输出 JSON，失败退出码为 1', async () => {
  const { root, cwd } = await setup();
  const env = { ...process.env, CAPABILITY_TEAM_HOME: root };
  const run = (args, input) => spawnSync(process.execPath, [CLI, 'write', ...args], { cwd, env, input, encoding: 'utf8', windowsHide: true });
  const viaStdin = run(['--kind', 'pitfall', '--tags', 'a,b'], '标准输入写入的踩坑记录');
  assert.equal(viaStdin.status, 0, viaStdin.stderr);
  assert.equal(JSON.parse(viaStdin.stdout).saved, true);
  const viaArgs = run(['--kind', 'decision', '--scope', 'global', '参数写入的全局决定']);
  assert.equal(JSON.parse(viaArgs.stdout).scope, 'global');
  const failed = run(['--kind', 'result', '不允许的类型示例']);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stderr).saved, false);
  assert.match(await onDisk(root), /标准输入写入的踩坑记录/);
});
