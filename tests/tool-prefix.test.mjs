import test from 'node:test';
import assert from 'node:assert/strict';
import { toolClass, canonicalTool } from '../workflow.js';

const wf = { analysisTools: ['read', 'grep', 'read_image'], coordinationTools: ['spawn_teammate', 'send_message', 'list_agents', 'team_task_list', 'wait_agent'] };

test('prefixed host tool names classify like their canonical names', () => {
  assert.equal(toolClass('wise_grep', wf), 'analysis');
  assert.equal(toolClass('expect_read_image', wf), 'analysis');
  assert.equal(toolClass('mcp__million_silent__symptom_read', wf), 'analysis');
  assert.equal(toolClass('brisk_spawn_teammate', wf), 'coordination');
  assert.equal(toolClass('forget_send_message', wf), 'coordination');
  assert.equal(toolClass('embark_team_task_list', wf), 'coordination');
  assert.equal(toolClass('modify_capability_dispatch_plan', wf), 'coordination');
  assert.equal(toolClass('foster_capability_free_task', wf), 'free');
  assert.equal(canonicalTool('brisk_spawn_teammate', wf), 'spawn_teammate');
});

test('unknown or multi-word prefixes stay execution', () => {
  assert.equal(toolClass('trumpet_pwsh', wf), 'execution');
  assert.equal(toolClass('polar_write', wf), 'execution');
  assert.equal(toolClass('pact_cpa_search', wf), 'execution');
  assert.equal(toolClass('a_b_grep', wf), 'execution');
});
