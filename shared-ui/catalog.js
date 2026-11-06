// Per-extension field catalog for the AIWUK config panels. catalog.json mirrors the Mothership catalog
// (docs/catalog.snapshot.json from the mothership protocol package); tests/config-panel-catalog.test.mjs asserts equality.
// A "ref" is the env-style name that the managed manifest and the credential store use; labels carry en and zh.
import entries from './catalog.json' with { type: 'json' };

export const CATALOG = Object.freeze(entries.map(entry => Object.freeze(entry)));
export const catalogEntry = ref => CATALOG.find(item => item.ref === ref);
/** Catalog entries of one extension (search | memory | autocomplete | team | connector). */
export const catalogOf = extension => CATALOG.filter(item => item.extension === extension);
