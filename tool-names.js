// Host aliases supported by the existing workflow: optional MCP envelope and one word prefix.
// A suffix is NOT proof of native tool identity. Use these candidates only to ADD restrictions,
// never to grant permissions, mark a tool read-only, or establish sandbox/confirmation trust.
export function restrictiveToolName(name, known) {
  const raw = String(name ?? '').replace(/^mcp__.+?__/, '');
  const has = value => typeof known === 'function' ? known(value) : known instanceof Set ? known.has(value) : Object.hasOwn(known, value);
  if (has(raw)) return raw;
  const tail = raw.slice(raw.indexOf('_') + 1);
  return raw.includes('_') && has(tail) ? tail : raw;
}
