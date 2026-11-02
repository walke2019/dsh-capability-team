import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyOf, keyPresence, refreshCredentials, resolveIntegrations, setCredentialResolver, validateIntegrations } from '../integrations-config.js';
import { checkResult, gateway, searchSchemas } from '../search.js';
import { readAudio, transcribe, audioStatus } from '../transcribe.js';

const config = { baseUrl: 'https://gw.example', searchPath: '/v1/search', fetchPath: '/v1/crawl', providersPath: '/v1/search/providers', headers: {}, providers: [], fetchProviders: [], timeoutMs: 120000, fetchTimeoutMs: 120000 };
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('密钥先取 DSH 凭据库，再取环境变量；状态只报有无', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cred-'));
  t.after(() => setCredentialResolver(undefined));
  setCredentialResolver(async name => (name === 'CPA_API_KEY' ? 'from-store' : undefined));
  const resolved = resolveIntegrations({ root, env: process.env });
  resolved.effective.search.apiKeyEnv = 'CPA_API_KEY';
  await refreshCredentials(resolved);
  assert.equal(keyOf('search', resolved), 'from-store');
  const presence = await keyPresence(resolved);
  assert.equal(presence.search.present, true);
  assert.ok(!JSON.stringify(presence).includes('from-store'));
  // An explicit env object (tests, previews) never sees the store.
  assert.equal(keyOf('search', resolveIntegrations({ root, env: { OMNI_SEARCH_API_KEY: 'env' } })), 'env');
});

test('HTTP 200 也要校验真实结果；错误按状态码给出处理提示，不回显正文', async () => {
  assert.throws(() => checkResult('search', { status: 'ok' }), /没有 results/);
  assert.throws(() => checkResult('fetch', { url: 'x', content: '  ' }), /没有网页正文/);
  assert.deepEqual(checkResult('search', { results: [] }).results, []);
  const call = (status, body) => gateway('search', { query: 'q' }, { settings: { config, key: 'K' }, fetcher: async () => reply(status, body) });
  await assert.rejects(call(429, { error: 'secret upstream detail' }), e => /429（限流，请退避后重试）/.test(e.message) && !e.message.includes('secret'));
  await assert.rejects(call(401, {}), /客户端鉴权/);
  await assert.rejects(call(502, {}), /上游失败/);
  await assert.rejects(call(200, { provider: 'x' }), /没有 results/);
  assert.equal((await call(200, { provider: 'serper', results: [{ url: 'https://a' }] })).results.length, 1);
});

test('渠道列表用 GET，路径来自配置；未配置时不注册该工具', async () => {
  let seen;
  const out = await gateway('providers', {}, { settings: { config, key: 'K' }, fetcher: async (url, init) => { seen = { url, init }; return reply(200, { data: [{ id: 'serper-search' }] }); } });
  assert.equal(seen.url, 'https://gw.example/v1/search/providers');
  assert.equal(seen.init.method, 'GET'); assert.equal(seen.init.body, undefined);
  assert.equal(seen.init.headers.Authorization, 'Bearer K');
  assert.equal(out.data[0].id, 'serper-search');
  assert.ok('omni_search_providers' in searchSchemas({ ...config, engines: null }));
  assert.ok(!('omni_search_providers' in searchSchemas({ ...config, providersPath: null })));
  assert.deepEqual(validateIntegrations({ search: { fetchPath: '/v1/crawl', timeoutMs: 120000 } }).search, { fetchPath: '/v1/crawl', timeoutMs: 120000 });
});

test('语音：授权前不读文件，超限不读；multipart 上传真实字节，密钥只在请求头', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audio-'));
  const file = join(dir, 'clip.wav');
  await writeFile(file, Buffer.from('RIFF....WAVEfmt fake-bytes'));
  await assert.rejects(readAudio(file, 1024, async () => { throw new Error('用户未授权上传该文件'); }), /未授权/);
  await assert.rejects(readAudio(file, 4, async () => assert.fail('不应询问')), /超过上传上限/);
  await assert.rejects(readAudio(join(dir, 'a.exe'), 1024), /不支持的音频格式/);
  let asked = 0;
  const bytes = await readAudio(file, 1024, async size => { asked = size; });
  assert.equal(asked, bytes.byteLength);
  let sent;
  const settings = { key: 'K', keyEnv: 'CPA_API_KEY', config: { baseUrl: 'https://gw.example', path: '/v1/audio/transcriptions', statusPath: '/v1/audio/status', headers: {}, model: 'whisper-large-v3-turbo', timeoutMs: 125000 } };
  const result = await transcribe({ bytes, name: 'clip.wav', language: 'zh' }, { settings, fetcher: async (url, init) => { sent = { url, init }; return reply(200, { text: '你好' }); } });
  assert.equal(result.text, '你好');
  assert.ok(sent.init.body instanceof FormData);
  assert.equal(sent.init.headers['Content-Type'], undefined, 'boundary 由 HTTP 库设置');
  const part = sent.init.body.get('file');
  assert.equal(part.name, 'clip.wav'); assert.equal(part.type, 'audio/wav');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes);
  assert.equal(sent.init.body.get('model'), 'whisper-large-v3-turbo');
  assert.ok(![...sent.init.body.values()].some(v => v === 'K'));
  await assert.rejects(transcribe({ bytes, name: 'clip.wav' }, { settings, fetcher: async () => reply(200, { text: '' }) }), /没有转写文本/);
  await assert.rejects(transcribe({ bytes, name: 'clip.wav' }, { settings, fetcher: async () => reply(413, {}) }), /413（内容超过服务上限）/);
  const status = await audioStatus({ settings, fetcher: async () => reply(200, { mode: 'direct' }) });
  assert.match(status.note, /不代表上游/);
});

test('语音：符号链接按真实目标检查格式并在确认框显示真实路径；状态接口不回传凭据或响应片段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audio-link-'));
  const secret = join(dir, 'id_rsa'); await writeFile(secret, 'PRIVATE KEY');
  await symlink(secret, join(dir, 'meeting.mp3'));
  await assert.rejects(readAudio(join(dir, 'meeting.mp3'), 1024, async () => assert.fail('不应询问')), /不支持的音频格式/);
  const real = join(dir, 'real.wav'); await writeFile(real, 'RIFF');
  await symlink(real, join(dir, 'alias.mp3'));
  let shown; await readAudio(join(dir, 'alias.mp3'), 1024, async (_size, path) => { shown = path; });
  assert.equal(shown, real);
  const settings = { key: 'sk-live-SECRET123', keyEnv: 'K', config: { baseUrl: 'https://gw.example', statusPath: '/s', headers: {} } };
  await assert.rejects(audioStatus({ settings, fetcher: async () => reply(200, { client: { auth: 'Bearer sk-live-SECRET123' } }) }), /包含凭据/);
  await assert.rejects(audioStatus({ settings, fetcher: async () => reply(200, 'not-json-body-xyz') }), error => /不是 JSON/.test(error.message) && !error.message.includes('not-json'));
});
