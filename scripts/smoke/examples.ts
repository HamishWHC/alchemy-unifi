/**
 * Writes every TypeScript code block in the docs site, the package READMEs
 * and the packages' doc comments to `<out>/<file>-<n>.ts`, so the smoke test
 * can typecheck them against the packed packages. Each block is a complete
 * module. Usage: node scripts/smoke/examples.ts <out>
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const [out] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: node scripts/smoke/examples.ts <out>");

const docsDir = "packages/docs/src/content/docs";
const sources = [
	// The docs site's hand-written pages. The reference is generated from the doc comments below, and the
	// tutorial is replayed part by part (scripts/smoke/tutorial.ts).
	...fs
		.readdirSync(path.join(root, docsDir), { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".mdx") && !/^(reference|tutorial)[/\\]/u.test(file))
		.map((file) => path.join(docsDir, file)),
	"packages/network/README.md",
	"packages/network-sdk/README.md",
	// Doc comments in hand-written sources (the SDK's generated `services/` has none).
	...["packages/network/src", "packages/network-sdk/src"].flatMap((dir) =>
		fs
			.readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".ts") && !file.startsWith("services"))
			.map((file) => path.join(dir, file)),
	),
];

/** A source's text, with doc-comment line prefixes (` * `) removed from `.ts` files. */
const read = (source: string) => {
	const text = fs.readFileSync(path.join(root, source), "utf8");
	return source.endsWith(".ts") ? text.replace(/^[ \t]*\* ?/gmu, "") : text;
};

fs.mkdirSync(out, { recursive: true });
let count = 0;
for (const source of sources) {
	const text = read(source);
	const blocks = [...text.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1] ?? "");
	blocks.forEach((block, i) => {
		const name = `${source.replace(/\.(mdx?|ts)$/u, "").replace(/[/\\]/gu, "-")}-${i + 1}.ts`;
		fs.writeFileSync(path.join(out, name), block);
		count++;
	});
}
process.stdout.write(`${count} examples\n`);
