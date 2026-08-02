// A CSS-only dynamic import: rolldown-vite prunes the async JS chunk but still lists its name in
// dynamicImports. Mirrors a lazy UX Stimulus controller whose autoimport is a stylesheet.
window.addEventListener('DOMContentLoaded', () => {
    import('./lazy.css');
});
