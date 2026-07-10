# Reference repositories

Read-only clones under `.references/` (git-ignored), kept as pattern references for building `@kocal/unplugin-symfony`. Refresh by re-cloning; never edit in place. Each clone has an `AGENTS.md` explaining what to study.

| Local path                            | Upstream                                            | Why                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.references/unplugin-vue-components` | https://github.com/unplugin/unplugin-vue-components | Mature unplugin: factory + per-bundler entries + resolver + `.d.ts` generation                                                                     |
| `.references/unplugin-auto-import`    | https://github.com/unplugin/unplugin-auto-import    | Virtual-module code injection + preset config + `.d.ts` side-file generation                                                                       |
| `.references/unplugin-icons`          | https://github.com/unplugin/unplugin-icons          | On-demand `resolveId`/`load` virtual modules — model for the Stimulus `virtual:symfony/controllers`                                                |
| `.references/unplugin-dts`            | https://github.com/qmhc/unplugin-dts                | `.d.ts` emission plugin; monorepo, relevant package is `packages/unplugin-dts` (ships its own `AGENTS.md`)                                         |
| `.references/unplugin-swc`            | https://github.com/unplugin/unplugin-swc            | Minimal unplugin (single `transform` hook) — simplest factory example                                                                              |
| `.references/vite-plugin-symfony`     | https://github.com/lhapaipai/vite-plugin-symfony    | Understand the problem space only (Symfony+Vite dev-server/HMR, Stimulus). **Do not copy its code** — our impl is independent (Vite API + Encore). |
| `.references/vite-bundle`             | https://github.com/lhapaipai/vite-bundle            | Understand only how a PHP consumer of a dev-aware `entrypoints.json` behaves. **Do not copy its code.**                                            |
