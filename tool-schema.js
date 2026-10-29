// ctx.tools.register sends `parameters` to the model verbatim as JSON Schema (draft 2020-12),
// so tool parameters must be a raw object-rooted schema, not the defineTool shorthand
// (`{name: {type, required: true}}`). DSH accepts only this keyword subset.
const ALLOWED = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']);

/** Object-rooted parameter schema; `required` lists property names. */
export function params(properties = {}, required = []) {
  for (const name of required) if (!Object.hasOwn(properties, name)) throw new Error(`required parameter ${name} is not declared`);
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** Throws when a schema uses keywords outside the DSH subset or the shorthand `required: true`. */
export function assertToolSchema(schema, path = 'parameters') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${path} must be a schema object`);
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED.has(key)) throw new Error(`${path}.${key} is not a supported keyword`);
    if (key === 'required' && !(Array.isArray(value) && value.every(v => typeof v === 'string'))) throw new Error(`${path}.required must be an array of property names`);
  }
  if (path === 'parameters' && schema.type !== 'object') throw new Error('parameters must have type "object" at the root');
  for (const [name, sub] of Object.entries(schema.properties ?? {})) assertToolSchema(sub, `${path}.properties.${name}`);
  if (schema.items) assertToolSchema(schema.items, `${path}.items`);
  for (const [i, sub] of (schema.oneOf ?? []).entries()) assertToolSchema(sub, `${path}.oneOf[${i}]`);
}
