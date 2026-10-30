// Extract only recorded model identities, never prompt/content/replayState.
// Request headers prove configuration admission, not successful provider completion.
export function requestEvidence(snapshot, limit = 30) {
  const inherited = snapshot.inheritedEventCount ?? 0;
  const result = [];
  for (let i = snapshot.events.length - 1; i >= inherited && result.length < limit; i--) {
    const event = snapshot.events[i];
    let source, evidence;
    if (event.type === 'request/header') { source = event.data?.header?.config; evidence = 'request-header'; }
    else if (event.type === 'assistant/message') { source = event.data?.message?.source; evidence = 'assistant-message'; }
    if (typeof source?.provider !== 'string' || typeof source?.model !== 'string') continue;
    result.push({ seq: event.seq, time: event.time, provider: source.provider, model: source.model, evidence,
      ...(event.data?.interrupted ? { interrupted: true } : {}) });
  }
  return result;
}
export async function readTeamEvidence(query, teams, agent) {
  let members;
  try { members = teams ? teams.listMembers(agent) : [{ id: agent.id, name: 'lead' }]; }
  catch (error) {
    return [{ sessionId: agent.id, name: 'lead', ...await readRequestEvidence(query, agent.id),
      unavailable: `团队成员读取失败：${error.message ?? error}` }];
  }
  const result = [];
  // Deliberately sequential: bound peak log memory to one member at a time.
  for (const member of members) {
    result.push({ sessionId: member.id, name: member.name, inheritedModel: member.model ?? null,
      ...await readRequestEvidence(query, member.id) });
  }
  return result;
}
export async function readRequestEvidence(query, sessionId) {
  if (!query) return { records: [], unavailable: '当前宿主未提供会话日志查询服务' };
  try { return { records: requestEvidence(await query.readSession(sessionId)) }; }
  catch (error) { return { records: [], unavailable: String(error.message ?? error) }; }
}
