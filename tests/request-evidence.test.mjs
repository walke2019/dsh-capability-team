import test from 'node:test';
import assert from 'node:assert/strict';
import { requestEvidence, readRequestEvidence, readTeamEvidence } from '../request-evidence.js';
test('请求证据仅使用明确日志字段，跳过继承记录与敏感内容', () => {
  const events = [
    { seq: 1, type: 'request/header', data: { header: { config: { provider: 'parent', model: 'old' } } } },
    { seq: 2, type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { seq: 3, type: 'assistant/message', data: { message: { source: { provider: 'p', model: 'm' }, content: 'private' } } },
    { seq: 4, type: 'user/message', data: { model: 'fake' } },
  ];
  const rows = requestEvidence({ events, inheritedEventCount: 1 });
  assert.deepEqual(rows.map(r => r.seq), [3, 2]);
  assert.equal(rows[0].evidence, 'assistant-message');
  assert.equal(JSON.stringify(rows).includes('private'), false);
  assert.equal(requestEvidence({ events }, 1).length, 1);
});
test('团队证据只读取成员清单且保留单个读取错误', async () => {
  const read = [];
  const result = await readTeamEvidence({ readSession: async id => {
    read.push(id); if (id === 'mate') throw new Error('missing');
    return { events: [] };
  } }, { listMembers: () => [{ id: 'lead', name: 'lead' }, { id: 'mate', name: 'qa', model: 'inherited' }] }, {});
  assert.deepEqual(read, ['lead', 'mate']);
  assert.equal(result[1].unavailable, 'missing');
  assert.equal(result[1].inheritedModel, 'inherited');
  assert.deepEqual(result[1].records, []);
});
test('日志读取错误明确显示，不编造实际模型', async () => {
  const result = await readRequestEvidence({ readSession: async () => { throw new Error('fixture failure'); } }, 'fixture');
  assert.deepEqual(result.records, []); assert.equal(result.unavailable, 'fixture failure');
});
