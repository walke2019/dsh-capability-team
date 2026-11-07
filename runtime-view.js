import { m as modelText } from './i18n.js';
// Shared read-only bridge. Keys are Agent objects, never guessed from a project or display name.
const readers = new WeakMap();
const writers = new WeakMap();
export function registerPolicyWriter(agent, save) {
  writers.set(agent, save);
  return () => { if (writers.get(agent) === save) writers.delete(agent); };
}
export async function saveTeamPolicy(agent, routes, revision) {
  const save = writers.get(agent);
  if (!save) throw new Error(modelText('runtime-view.372'));
  return save(routes, revision);
}
export function registerTeamReader(agent, read) {
  readers.set(agent, read);
  return () => { if (readers.get(agent) === read) readers.delete(agent); };
}
export async function readTeamSnapshot(agent) {
  const read = readers.get(agent);
  return read ? await read() : null;
}
