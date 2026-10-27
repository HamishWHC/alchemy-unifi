/**
 * Replays the docs tutorial part by part, and writes each part's end state
 * to `<out>/part-<n>/`, so the smoke test can typecheck and deploy it.
 *
 * Every TypeScript block's first line is a `// <path>` comment. A `ts` block
 * is the whole file. A `diff lang="typescript"` block is the whole file too,
 * with `+` and `-` lines: without its `+` lines it must equal the file as the
 * previous blocks left it, so a step that doesn't apply fails here.
 * Usage: node scripts/smoke/tutorial.ts <out>
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const tutorialDir = path.join(root, "packages/docs/src/content/docs/tutorial");
const [out] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: node scripts/smoke/tutorial.ts <out>");

const parts = fs
	.readdirSync(tutorialDir)
	.map((file) => /^part-(\d+)\.mdx$/u.exec(file))
	.filter((match) => match !== null)
	.map((match) => ({ file: match[0], n: Number(match[1]) }))
	.toSorted((a, b) => a.n - b.n);

const files = new Map<string, string>();
const fail = (where: string, message: string): never => {
	throw new Error(`${where}: ${message}`);
};

for (const { file, n } of parts) {
	const text = fs.readFileSync(path.join(tutorialDir, file), "utf8");
	const blocks = text.matchAll(/^```(ts|typescript|diff lang="(?:ts|typescript)")\n([\s\S]*?)^```$/gmu);
	for (const [, lang, body = ""] of blocks) {
		const lines = body.replace(/\n$/u, "").split("\n");
		const target = /^\/\/ (\S+)$/u.exec(lines[0] ?? "")?.[1];
		const where = `${file} (${lines[0]})`;
		if (target === undefined) fail(file, `a TypeScript block doesn't start with a "// <path>" line: ${lines[0]}`);
		const key = target ?? "";
		if (lang?.startsWith("diff") === true) {
			const before = lines.filter((line) => !line.startsWith("+")).map((line) => line.replace(/^-/u, ""));
			const after = lines.filter((line) => !line.startsWith("-")).map((line) => line.replace(/^\+/u, ""));
			const current = files.get(key) ?? fail(where, `diff for a file no earlier block created`);
			if (current !== `${before.join("\n")}\n`) {
				const currentLines = current.split("\n");
				const at = before.findIndex((line, i) => line !== currentLines[i]);
				fail(where, `diff doesn't apply at line ${at + 1}: expected ${JSON.stringify(currentLines[at])}`);
			}
			files.set(key, `${after.join("\n")}\n`);
		} else {
			files.set(key, `${lines.join("\n")}\n`);
		}
	}
	const dir = path.join(out, `part-${n}`);
	for (const [name, content] of files) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), content);
	}
}
process.stdout.write(`${parts.length} tutorial parts\n`);
