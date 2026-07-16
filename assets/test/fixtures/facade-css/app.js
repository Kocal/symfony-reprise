import './app.css';

// The top-level await, combined with this module being imported by another entry (other.js), makes
// Rollup emit `app` as a thin *facade* chunk that only re-imports the real chunk; the CSS then rides
// on that real chunk, not the facade. This reproduces the Encore -> Reprise migration bug where entry
// CSS went missing from entrypoints.json/manifest.json.
await import('./lazy.js');

export const a = 1;
