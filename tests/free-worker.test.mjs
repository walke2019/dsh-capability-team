import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runFreeWorker, AGENT, PERMISSIONS } from '../free-worker.mjs';

const MODELS = ['opencode/new-free', 'opencode/old-free'];
const resolveModels = async configured => (configured.length ? configured : MODELS);
function child(stdout = '', { code = 0, stderr = '' } = {}) {
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.kill = () => queueMicrotask(() => c.emit('close', null, 'SIGTERM'));
  queueMicrotask(() => {
    if (stderr) c.stderr.emit('data', stderr);
    if (stderr) return; // An unavailable-model line kills the process.
    c.stdout.emit('data', stdout); c.emit('close', code, null);
  });
  return c;
}
const ok = text => `{"type":"text","part":{"text":"${text}"}}\n`;
const base = { executable: 'mock', resolveModels };

test('使用内置 build 代理、免费模型、关闭标题生成；参数数组启动不经 shell', async () => {
  const calls = [];
  const result = await runFreeWorker('总结', { ...base, launch: (exe, args, options) => { calls.push({ args, options }); return child(ok('完成')); } });
  const { args, options } = calls[0];
  assert.equal(options.shell, false);
  assert.equal(args[args.indexOf('--agent') + 1], AGENT);
  assert.equal(AGENT, 'build');
  assert.equal(args[args.indexOf('--model') + 1], MODELS[0]);
  assert.ok(args.includes('--pure'));
  const config = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.agent.build.model, MODELS[0]);
  assert.equal(config.small_model, MODELS[0], '标题等小模型不得走用户的付费模型');
  assert.equal(config.agent.title.disable, true);
  assert.deepEqual(config.agent.build.permission, PERMISSIONS.none, '代理自身权限优先于 OPENCODE_PERMISSION');
  assert.deepEqual(JSON.parse(options.env.OPENCODE_PERMISSION), PERMISSIONS.none);
  assert.equal(result.text, '完成');
  assert.equal(result.model, MODELS[0]);
});

test('各工具级别：都禁止 shell、联网、子代理、项目外路径；读写都避开密钥文件', () => {
  for (const [level, p] of Object.entries(PERMISSIONS)) {
    assert.equal(Object.keys(p)[0], '*', `${level}: 兜底规则必须在最前（OpenCode 取最后匹配）`);
    assert.equal(p['*'], 'deny');
    for (const t of ['bash', 'webfetch', 'websearch', 'task', 'skill']) assert.ok(!(t in p), `${level}.${t}`);
    for (const key of ['read', 'edit']) if (p[key] && p[key]['*'] === 'allow') {
      assert.equal(Object.keys(p[key])[0], '*');
      for (const f of ['*.env', '*.pem', '*.key', '*credentials*']) assert.equal(p[key][f], 'deny', `${level}.${key}.${f}`);
    }
    if (level !== 'none') assert.equal(p.external_directory, 'deny');
  }
  assert.ok(!('edit' in PERMISSIONS.none) && !('edit' in PERMISSIONS.read));
  assert.equal(PERMISSIONS.write.edit['*'], 'allow');
  // The free endpoint rejects requests with zero tools, so `none` keeps a read rule matching no file.
  assert.equal(PERMISSIONS.none.read['*'], 'deny');
  assert.equal(Object.values(PERMISSIONS.none.read).filter(v => v === 'allow').length, 1);
});

test('写入级别回报工具调用与改动文件', async () => {
  const events = '{"type":"tool_use","part":{"tool":"write","state":{"status":"completed","input":{"filePath":"a.txt"}}}}\n' + ok('done');
  const r = await runFreeWorker('写', { ...base, tools: 'write', launch: (e, a, o) => { assert.deepEqual(JSON.parse(o.env.OPENCODE_PERMISSION), PERMISSIONS.write); return child(events); } });
  assert.deepEqual(r.toolCalls, [{ tool: 'write', status: 'completed', file: 'a.txt' }]);
  await assert.rejects(runFreeWorker('x', { ...base, tools: 'shell' }), /工具级别/);
});

test('额度用尽：立即终止并换下一个免费模型；全部不可用时报告，不改用付费模型', async () => {
  const limit = 'level=ERROR message="stream error" error.error="AI_APICallError: Free usage limit reached. subscribe"\n';
  const tried = [];
  const r = await runFreeWorker('x', { ...base, launch: (e, args) => { const m = args[args.indexOf('--model') + 1]; tried.push(m); return m === MODELS[0] ? child('', { stderr: limit }) : child(ok('好')); } });
  assert.deepEqual(tried, MODELS);
  assert.equal(r.model, MODELS[1]);
  assert.match(r.skipped[0], /new-free 不可用：.*Free usage limit/);
  await assert.rejects(runFreeWorker('x', { ...base, launch: () => child('', { stderr: limit }) }), /所有免费模型都不可用，不改用付费模型/);
});

test('标题生成等非主代理的报错不触发换模型', async () => {
  const title = 'level=ERROR message="stream error" agent=title error.error="AI_APICallError: Bad Request"\n';
  const c = () => { const x = child(ok('好')); queueMicrotask(() => x.stderr.emit('data', title)); return x; };
  assert.equal((await runFreeWorker('x', { ...base, launch: c })).text, '好');
});

test('其他失败照实报告，不换模型', async () => {
  let n = 0;
  await assert.rejects(runFreeWorker('x', { ...base, launch: () => { n++; return child(ok('r'), { code: 1 }); } }), /退出码/);
  assert.equal(n, 1);
  await assert.rejects(runFreeWorker('x', { ...base, launch: () => child('{"type":"error","error":"失败"}\n') }), /失败/);
  await assert.rejects(runFreeWorker('x', { ...base, launch: () => child('') }), /文本结果/);
});

test('拒绝 shell 包装器；模型清单由目录解析，不在清单内的模型不允许', async () => {
  await assert.rejects(runFreeWorker('x', { ...base, executable: 'opencode.cmd' }), /原生/);
  await assert.rejects(runFreeWorker('x', { ...base, models: ['paid/x'], resolveModels: async () => { throw new Error('不是 OpenCode 目录中的免费模型'); } }), /免费模型/);
});
