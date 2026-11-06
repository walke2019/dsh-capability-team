import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIELD_TEXT, DEFAULT_CONFIG } from '../packages/autocomplete/schema.js';
import { teamActivity } from '../ui.js';
import { applyTranscribe } from '../transcribe.js';

const loadSchema = language => JSON.parse(readFileSync(new URL(`../packages/autocomplete/locale/schema.${language}.json`, import.meta.url), 'utf8'));
test('autocomplete schema resources preserve every field in both languages and ship in the package', () => {
  for (const [locale, language] of [['en-US', 'en'], ['zh-CN', 'zh']]) {
    assert.deepEqual(FIELD_TEXT[locale], loadSchema(language));
    assert.deepEqual(Object.keys(FIELD_TEXT[locale]).sort(), Object.keys(DEFAULT_CONFIG).sort());
  }
  const manifest = JSON.parse(readFileSync(new URL('../packages/autocomplete/package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('locale/*.json'));
  assert.match(FIELD_TEXT['zh-CN'].enabled, /绝不自动发送/);
  assert.match(FIELD_TEXT['en-US'].enabled, /never sends/);
});

test('diagnostics follow locale while transcription tools stay English and approval survives a locale change', async () => {
  const before = process.env.AIWUK_LOCALE;
  const root = await mkdtemp(join(tmpdir(), 'i18n-audio-'));
  try {
    await writeFile(join(root, 'clip.wav'), 'RIFF');
    for (const language of ['en', 'zh']) {
      process.env.AIWUK_LOCALE = language;
      assert.match(teamActivity({}, {}).unavailable, language === 'zh' ? /团队服务/ : /team services/);
      const tools = new Map();
      applyTranscribe({ effect: fn => fn(), tools: { register: def => tools.set(def.name, def) },
        workingDirectory: { ensure: async () => root },
        userQuestions: { ask: async ({ questions: [question] }) => {
          assert.match(question.header, language === 'zh' ? /允许上传/ : /Allow audio upload/);
          assert.match(question.detail, /clip\.wav/);
          process.env.AIWUK_LOCALE = language === 'zh' ? 'en' : 'zh';
          return { answers: [{ id: 'upload', selected: [question.options[0].label] }] };
        } },
      });
      const tool = tools.get('omni_transcribe');
      assert.match(tool.description, /explicit user approval/);
      assert.doesNotMatch(tool.description, /[\u3400-\u9fff]/u);
      // Stop immediately after consent, before credentials or network access.
      const signal = AbortSignal.abort();
      await assert.rejects(tool.execute({ file_path: 'clip.wav' }, { agent: {}, signal }), error => {
        assert.doesNotMatch(error.message, /did not authorize/);
        return true;
      });
    }
  } finally {
    if (before === undefined) delete process.env.AIWUK_LOCALE; else process.env.AIWUK_LOCALE = before;
    await rm(root, { recursive: true, force: true });
  }
});
