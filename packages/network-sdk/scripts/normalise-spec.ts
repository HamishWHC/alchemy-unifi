/**
 * Fixes the published UniFi Network OpenAPI spec before distilled converts it:
 *
 * - schema names contain spaces and punctuation ("Create or update Network"),
 *   so they are rewritten to PascalCase identifiers, including the plain-string
 *   references inside `discriminator.mapping`;
 * - polymorphic types use Java-style `discriminator.mapping` on a base schema
 *   whose subtypes `allOf` it. The converter ignores the mapping, so the base
 *   is split into `<Name>Base` and `<Name>` becomes a `oneOf` of its subtypes,
 *   each with its discriminator pinned to a literal. The literal comes first
 *   because the converter keeps the first definition of a merged member.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const refPrefix = "#/components/schemas/";

const toIdentifier = (name: string) => {
	const id = name
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join("");
	return /^\d/.test(id) ? `_${id}` : id;
};

const mapRefs = (value: Json, rename: (name: string) => string): Json => {
	if (Array.isArray(value)) return value.map((item) => mapRefs(item, rename));
	if (!isObject(value)) return value;
	const out: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		out[key] =
			key === "$ref" && typeof child === "string" && child.startsWith(refPrefix)
				? refPrefix + rename(child.slice(refPrefix.length))
				: mapRefs(child, rename);
	}
	return out;
};

const renameSchemas = (spec: JsonObject): JsonObject => {
	const components = spec["components"];
	if (!isObject(components) || !isObject(components["schemas"])) throw new Error("spec has no schemas");
	const names = new Map<string, string>();
	const used = new Set<string>();
	for (const name of Object.keys(components["schemas"])) {
		let id = toIdentifier(name);
		for (let i = 2; used.has(id); i++) id = `${toIdentifier(name)}${i}`;
		used.add(id);
		names.set(name, id);
	}
	const rename = (name: string) => names.get(name) ?? name;
	const schemas: JsonObject = {};
	for (const [name, schema] of Object.entries(components["schemas"])) {
		if (isObject(schema) && isObject(schema["discriminator"]) && isObject(schema["discriminator"]["mapping"])) {
			const mapping: JsonObject = {};
			for (const [tag, ref] of Object.entries(schema["discriminator"]["mapping"])) {
				mapping[tag] = typeof ref === "string" ? refPrefix + rename(ref.slice(refPrefix.length)) : ref;
			}
			schemas[rename(name)] = { ...schema, discriminator: { ...schema["discriminator"], mapping } };
		} else {
			schemas[rename(name)] = schema;
		}
	}
	const renamed = mapRefs({ ...spec, components: { ...components, schemas } }, rename);
	if (!isObject(renamed)) throw new Error("unreachable");
	return renamed;
};

const expandDiscriminators = (schemas: JsonObject) => {
	for (const [name, schema] of Object.entries({ ...schemas })) {
		if (!isObject(schema) || !isObject(schema["discriminator"])) continue;
		const { mapping, propertyName } = schema["discriminator"];
		if (!isObject(mapping) || typeof propertyName !== "string") continue;

		const baseName = `${name}Base`;
		const { discriminator: _, ...base } = schema;
		schemas[baseName] = base;

		const variants: Json[] = [];
		for (const [tag, ref] of Object.entries(mapping)) {
			if (typeof ref !== "string") continue;
			const variantName = ref.slice(refPrefix.length);
			const variant = mapRefs(schemas[variantName] ?? null, (n) => (n === name ? baseName : n));
			if (!isObject(variant)) continue;
			const literal: Json = {
				type: "object",
				required: [propertyName],
				properties: { [propertyName]: { type: "string", enum: [tag] } },
			};
			const { allOf, ...rest } = variant;
			schemas[variantName] = Array.isArray(allOf)
				? { ...rest, allOf: [literal, ...allOf] }
				: { allOf: [literal, variant] };
			variants.push({ $ref: refPrefix + variantName });
		}
		schemas[name] = {
			...(typeof schema["description"] === "string" ? { description: schema["description"] } : {}),
			oneOf: variants,
		};
	}
};

export const normalise = (spec: unknown): JsonObject => {
	if (!isObject(spec)) throw new Error("spec is not a JSON object");
	const renamed = renameSchemas(spec);
	const components = renamed["components"];
	if (!isObject(components) || !isObject(components["schemas"])) throw new Error("unreachable");
	expandDiscriminators(components["schemas"]);
	return renamed;
};
