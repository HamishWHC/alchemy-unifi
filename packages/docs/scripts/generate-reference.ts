/**
 * Generates the resource reference (`src/content/docs/reference/`) from the
 * JSDoc in `@alchemy-unifi/network`'s published declarations, so the pages
 * describe the package as packed. It reads the installed workspace package,
 * or `NETWORK_PACKAGE_DIR` (an unpacked tarball) when set, as CI does.
 *
 * A declaration tagged `@resource` gets a page. Its JSDoc reads like
 * Alchemy's: a summary, then `### Section` headings, each with prose and
 * `**Example:** Title` blocks.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parseSync } from "oxc-parser";

const PACKAGE = "@alchemy-unifi/network";
const SOURCE_URL = "https://github.com/HamishWHC/alchemy-unifi/blob/main/packages/network/src";

interface Example {
	readonly title: string;
	body: string;
}

interface Section {
	readonly title: string;
	description: string;
	readonly examples: Array<Example>;
}

interface Doc {
	readonly summary: string;
	readonly sections: ReadonlyArray<Section>;
	readonly tags: ReadonlySet<string>;
}

/** The text of a `/** … *\/` comment's body, without the leading `*`s. */
const commentLines = (value: string) =>
	value
		.split("\n")
		.map((line) => line.replace(/^\s*\* ?/, ""))
		.join("\n")
		.trim()
		.split("\n");

const parseDoc = (value: string): Doc => {
	const summary: Array<string> = [];
	const sections: Array<Section> = [];
	const tags = new Set<string>();
	let section: Section | undefined;
	let example: Example | undefined;
	let inFence = false;

	for (const line of commentLines(value)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```")) inFence = !inFence;
		const heading = inFence ? null : /^###\s+(.+)$/.exec(trimmed);
		const exampleStart = inFence ? null : /^\*\*Example:\*\*\s*(.*)$/.exec(trimmed);
		const tag = inFence ? null : /^@(\w+)\s*(.*)$/.exec(trimmed);
		if (heading?.[1] !== undefined) {
			example = undefined;
			section = { title: heading[1], description: "", examples: [] };
			sections.push(section);
		} else if (exampleStart !== null || tag?.[1] === "example") {
			if (section === undefined) {
				section = { title: "Examples", description: "", examples: [] };
				sections.push(section);
			}
			example = { title: (exampleStart?.[1] ?? tag?.[2] ?? "").trim() || "Example", body: "" };
			section.examples.push(example);
		} else if (tag?.[1] !== undefined) {
			tags.add(tag[1]);
			example = undefined;
		} else if (example !== undefined) {
			example.body += `${line}\n`;
		} else if (section !== undefined) {
			section.description += `${line}\n`;
		} else {
			summary.push(line);
		}
	}
	return { summary: summary.join("\n").trim(), sections, tags };
};

const slug = (name: string) => name.toLowerCase();

/** `{@link Network.lookup}` → a link to that resource's page, or inline code. */
const linkify = (markdown: string, pages: ReadonlySet<string>) =>
	markdown.replace(/\{@link\s+([\w.]+)(?:\s*\|\s*([^}]+))?\}/g, (_, target: string, label?: string) => {
		const [resource] = target.split(".");
		const text = `\`${label?.trim() ?? target}\``;
		return resource !== undefined && pages.has(resource) ? `[${text}](/reference/${slug(resource)}/)` : text;
	});

const yamlString = (value: string) => JSON.stringify(value);

const firstSentence = (summary: string) => {
	const paragraph = summary.split("\n\n")[0]?.replaceAll("\n", " ") ?? "";
	return (/^(.+?\.)(\s|$)/.exec(paragraph)?.[1] ?? paragraph).replaceAll("`", "");
};

const renderPage = (
	name: string,
	doc: Doc,
	pages: ReadonlySet<string>,
	version: string,
	sourceFile: string | undefined,
) => {
	const parts = [
		"---",
		`title: ${yamlString(name)}`,
		`description: ${yamlString(firstSentence(doc.summary))}`,
		"editUrl: false",
		"---",
		"",
		"<!-- Generated from the package's JSDoc by scripts/generate-reference.ts. Don't edit. -->",
		"",
	];
	const source = sourceFile === undefined ? "" : ` · **Source:** [\`${sourceFile}\`](${SOURCE_URL}/${sourceFile})`;
	parts.push(`> **Package:** \`${PACKAGE}@${version}\`${source}`, "");
	if (doc.summary) parts.push(doc.summary, "");
	for (const section of doc.sections) {
		parts.push(`## ${section.title}`, "");
		if (section.description.trim()) parts.push(section.description.trim(), "");
		for (const example of section.examples) {
			if (section.examples.length > 1 || example.title !== "Example") parts.push(`**${example.title}**`, "");
			parts.push(example.body.trim(), "");
		}
	}
	return `${linkify(parts.join("\n").trimEnd(), pages)}\n`;
};

/** Every top-level declaration's name and leading JSDoc, and the module's export names. */
const declarations = (file: string, text: string) => {
	const { program, comments, errors } = parseSync(file, text);
	if (errors.length > 0) throw new Error(`${file}: ${errors.map((error) => error.message).join("; ")}`);
	const exported = new Set<string>();
	const docs = new Map<string, string>();
	const jsdocBefore = (start: number) => {
		const comment = comments.findLast((c) => c.end <= start);
		return comment?.type === "Block" &&
			comment.value.startsWith("*") &&
			text.slice(comment.end, start).trim() === ""
			? comment.value.slice(1)
			: undefined;
	};
	for (const statement of program.body) {
		const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
		if (statement.type === "ExportNamedDeclaration") {
			for (const specifier of statement.specifiers) {
				if (specifier.exported.type === "Identifier") exported.add(specifier.exported.name);
			}
		}
		if (declaration?.type !== "VariableDeclaration") continue;
		for (const declarator of declaration.declarations) {
			if (declarator.id.type !== "Identifier") continue;
			if (statement.type === "ExportNamedDeclaration") exported.add(declarator.id.name);
			const doc = jsdocBefore(statement.start);
			if (doc !== undefined) docs.set(declarator.id.name, doc);
		}
	}
	return { exported, docs };
};

const Manifest = Schema.Struct({
	version: Schema.String,
	exports: Schema.Struct({ ".": Schema.Struct({ types: Schema.String }) }),
});

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const root = path.resolve(import.meta.dirname, "..");
	const packageDir = process.env["NETWORK_PACKAGE_DIR"] ?? path.join(root, "node_modules", PACKAGE);
	const manifest = yield* Schema.decodeUnknownEffect(Manifest)(
		JSON.parse(yield* fs.readFileString(path.join(packageDir, "package.json"))),
	);
	const typesFile = path.join(packageDir, manifest.exports["."].types);
	if (!(yield* fs.exists(typesFile))) {
		return yield* Effect.die(new Error(`${typesFile} is missing: build ${PACKAGE} first`));
	}
	const { exported, docs } = declarations(typesFile, yield* fs.readFileString(typesFile));

	const resources = new Map<string, Doc>();
	for (const [name, raw] of docs) {
		const doc = parseDoc(raw);
		if (doc.tags.has("resource") && exported.has(name)) resources.set(name, doc);
	}
	if (resources.size === 0) return yield* Effect.die(new Error(`No @resource declarations in ${typesFile}`));

	const outDir = path.join(root, "src", "content", "docs", "reference");
	yield* fs.remove(outDir, { recursive: true, force: true });
	yield* fs.makeDirectory(outDir, { recursive: true });
	const names = new Set(resources.keys());
	for (const [name, doc] of resources) {
		const sourceFile = `${name}.ts`;
		const hasSource = yield* fs.exists(path.join(packageDir, "src", sourceFile));
		yield* fs.writeFileString(
			path.join(outDir, `${slug(name)}.md`),
			renderPage(name, doc, names, manifest.version, hasSource ? sourceFile : undefined),
		);
	}
	yield* Console.log(
		`Generated ${resources.size} reference pages from ${PACKAGE}@${manifest.version}: ${[...names].join(", ")}`,
	);
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
