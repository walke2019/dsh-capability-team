// sharedProjectFilter null = not set here: the deployment setting `integrations.memory.sharedRecall` (file,
// MEMORY_SHARED_RECALL environment variable or same-named DSH credential) decides at search time.
export const defaults = Object.freeze({ enabled: true, autoRecall: true, injectChars: 2400, recallK: 6, recallTimeoutMs: 2000, sharedRecall: true, sharedProjectFilter: null, syncWrites: true });
export function configuration(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid configuration');
  const c = { ...defaults, ...input };
  for (const key of Object.keys(input)) if (!(key in defaults)) throw new Error(`Unknown configuration: ${key}`);
  for (const key of ['enabled','autoRecall','sharedRecall','syncWrites']) if (typeof c[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  for (const [key, min, max] of [['injectChars',200,6000],['recallK',1,20],['recallTimeoutMs',100,10000]]) if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`Invalid ${key}`);
  if (c.sharedProjectFilter !== null && !['current','none'].includes(c.sharedProjectFilter)) throw new Error('Invalid sharedProjectFilter');
  return c;
}
export const Config = { type: 'object', additionalProperties: false, properties: {
  enabled: { type: 'boolean', default: true }, autoRecall: { type: 'boolean', default: true },
  injectChars: { type: 'integer', minimum: 200, maximum: 6000, default: 2400 },
  recallK: { type: 'integer', minimum: 1, maximum: 20, default: 6 }, recallTimeoutMs: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 },
  sharedRecall: { type: 'boolean', default: true }, sharedProjectFilter: { type: ['string','null'], enum: ['current','none',null], default: null }, syncWrites: { type: 'boolean', default: true },
} };
 function object(properties, required) { return { type: 'object', additionalProperties: false, properties, required }; }
const str = (maxLength, minLength = 1) => ({ type: 'string', minLength, maxLength });
const enumeration = values => ({ type: 'string', enum: values });
export const searchSchema = object({ query: str(2000), k: { type: 'integer', minimum: 1, maximum: 20 }, kinds: { type: 'array', maxItems: 5, items: enumeration(['handoff','result','pitfall','decision','note']) }, scope: enumeration(['all','project','session','global']), shared_project_filter: enumeration(['current','none']) }, ['query']);
export const writeSchema = object({ kind: enumeration(['pitfall','decision','note']), text: str(2000), scope: enumeration(['project','session','global']), key: str(120), tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 64 } } }, ['kind','text']);
export function validate(schema, value) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid arguments');
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`Missing ${key}`);
    for (const [key, v] of Object.entries(value)) { if (!schema.properties[key]) throw new Error(`Unknown ${key}`); validate(schema.properties[key], v); }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) throw new Error('Invalid array');
    value.forEach(v => validate(schema.items, v));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || schema.enum && !schema.enum.includes(value)) throw new Error('Invalid string');
  } else if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw new Error('Invalid integer');
}
