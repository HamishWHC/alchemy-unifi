# Tooling

Rules that aren't obvious from the config files.

- **Markdown code blocks are formatted by oxfmt**, so code samples must be valid TypeScript (e.g. wrap `yield*` in `Effect.gen`).
- **`exports` point at `dist/`**, so consumers, including injected `file:` consumers, get build output. Each export also has an `@alchemy-unifi/source` condition pointing at `src/`. `customConditions` in `tsconfig.base.json` and `ssr.resolve.conditions` in vitest configs enable it, so typechecks and tests across packages don't need a build first. Tests import their own package's `src/` relatively.
- **Packages ship `src/` and declaration maps,** so go-to-definition in a consumer opens the TypeScript source rather than the bundled `.d.mts`. With tsdown's tsgo generator, the maps only point at `.ts` files when `declarationMap` is set in `tsconfig.base.json`; without it they point at intermediate `.d.ts` files that don't exist.
- **`dependencies` and `peerDependencies` use literal ranges**, not `catalog:`, because a `file:` consumer can't resolve catalog references. `devDependencies` use the catalog. The exception is `workspace:*` between our own packages (pnpm rewrites it on publish); a `file:` consumer has to override those with `file:` paths.
- **`alchemy`, `effect` and `@effect/platform-node` are peer dependencies**, so consumers have one instance of each, as in Alchemy's own provider packages.
- **oxlint ignores the `@alchemy-unifi/source` condition**, so its `import/namespace` rule reads the SDK's `dist/`. After adding an SDK export, run `pnpm build` (or delete the stale `dist/`), or lint reports the export as missing.
