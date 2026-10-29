import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runFreeWorker } from '../free-worker.mjs';
function launcher(lines, code = 0) {
  return (exe, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(options.env.OPENCODE_PERMISSION, '{"*":"deny"}');
    assert.ok(args.includes('--pure'));
    assert.equal(args[args.indexOf('--model') + 1], 'opencode/deepseek-v4.1-flash-free');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => { child.stdout.emit('data', lines); child.emit('close', code, null); });
    return child;
  };
}
test('免费分析执行器固定模型且无 shell', async () => {
  const result = await runFreeWorker('只分析', { executable: 'mock', launch: launcher('{"type":"text","part":{"text":"完成"}}\n') });
  assert.equal(result.text, '完成');
});
test('进程成功但事件失败仍报错', async () => {
  await assert.rejects(runFreeWorker('只分析', { executable: 'mock', launch: launcher('{"type":"error","error":"失败"}\n') }));
});
test('拒绝 shell 包装器', async () => {
  await assert.rejects(runFreeWorker('分析', { executable: 'opencode.cmd' }), /原生/);
});
test('非零退出码不冒充成功', async () => {
  await assert.rejects(runFreeWorker('分析', { executable: 'mock', launch: launcher('{"type":"text","part":{"text":"结果"}}', 1) }), /退出码/);
});
test('空结果不冒充成功', async () => {
  await assert.rejects(runFreeWorker('只分析', { executable: 'mock', launch: launcher('') }), /文本结果/);
});
