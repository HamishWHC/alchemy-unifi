# Spec generation

`pnpm generate` (in `packages/network-sdk`, or via turbo at the root) rebuilds the SDK from the vendored spec:

```text
openapi/network-10.6.106.json
   │  scripts/normalise-spec.ts   (fixes for the published spec, run as convert's preprocess hook)
   │  scripts/convert.ts          distilled OpenAPI → Smithy  ⇒ .generated-specs/network.json (gitignored)
   │  scripts/generate.ts         distilled Smithy → Effect   ⇒ src/services/*.ts (committed)
   ▼
oxfmt package.json                (the generator stamps `distilled.generatedAt` into it)
```

Generation is deterministic: two runs produce byte-identical output. Only the generated TypeScript is committed, so spec or normaliser changes show up as diffs in `src/services`.

## What the normaliser fixes

UniFi's published spec trips up the converter in two ways.

1. **Schema names** contain spaces and punctuation (`"Create or update Network"`). They're rewritten to PascalCase identifiers everywhere, including in `discriminator.mapping`, whose values are plain strings rather than `$ref`s.
2. **Polymorphism** is Java-style: a base schema carries `discriminator.mapping`, and its subtypes `allOf` the base. The converter ignores the mapping, which would turn every polymorphic type into `unknown`. Instead:
    - the base becomes `<Name>Base`;
    - `<Name>` becomes a `oneOf` of its subtypes;
    - each subtype gets its discriminator pinned to a literal enum.

    The literal goes **first** in the subtype's `allOf`, because the converter keeps the first definition of a merged member.

## Generator configuration (`generate.ts`)

- `unionStyle: "untagged"`: unions are validated against their case schemas.
- Offset pagination:
    - List operations whose input has `offset` and whose output has `totalCount` and `data` get the `smithy.api#paginated` trait.
    - The trait's `mode` is `"token"`, because the trait type only accepts known modes. That mode is mapped to our own `paginateOffset` strategy.
- Sensitive members get `T.SensitiveValue` and accept `string | Redacted<string>`.
- Output goes to `src/services`. The hand-written files beside it follow distilled's layout (see [sdk.md](sdk.md)).

## Fixing the spec

Never edit `src/services`; changes there are lost on the next generate.

- **Structural problems** affecting many schemas (naming, polymorphism) belong in `normalise-spec.ts`.
- **Targeted fixes** use distilled's patch mechanism: RFC-6902 operations in `packages/network-sdk/patches/`, picked up by `convert.ts` (distilled's default `patchesDir`). Examples are adding a schema to an untyped member, marking a field required, or adding a typed error response. Patches target the converted Smithy model (`/shapes/...`), not the OpenAPI spec, and a patch whose path no longer resolves fails generation.

## Bumping the spec

1. Download `https://developer.ui.com/network/v<version>/openapi.json` into `openapi/network-<version>.json`.
2. Update `SPEC_VERSION` in `src/version.ts`. The provider warns when a console's major.minor version differs from it.
3. Run `pnpm generate`, then fix any compile errors in hand-written code.
4. Re-check the spec-quirk list in [unifi-api.md](unifi-api.md) against the test controller.
