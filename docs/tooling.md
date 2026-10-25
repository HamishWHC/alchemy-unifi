# Tooling

Rules that aren't obvious from the config files.

- **Markdown code blocks are formatted by oxfmt**, so code samples must be valid TypeScript (e.g. wrap `yield*` in `Effect.gen`).
- **`exports` always point at `dist/`**, so consumers, including injected `file:` consumers, get build output. Tests import `src/` relatively.
- **`dependencies` and `peerDependencies` use literal ranges**, not `catalog:`, because a `file:` consumer can't resolve catalog references. `devDependencies` use the catalog.
- **`alchemy` and `effect` are peer dependencies**, as in Alchemy's own provider packages.
