/**
 * Release helpers for `.github/workflows/release.yml` (see `docs/releasing.md`).
 *
 *   node scripts/release.ts nightly          set each public package's version to a nightly of its next version
 *   node scripts/release.ts publish <tag>    pack each public package and publish versions npm doesn't have yet
 *   node scripts/release.ts notes            print tags and release notes for packages whose version differs from HEAD's, as JSON
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface Manifest {
	name: string;
	version: string;
	private?: boolean;
}

const root = path.resolve(import.meta.dirname, "..");
const print = (line: string) => process.stdout.write(`${line}\n`);
const run = (command: string, args: ReadonlyArray<string>, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// npm refuses to run inside the repo, whose `devEngines` asks for pnpm.
const npm = (args: ReadonlyArray<string>) => run("npm", args, os.tmpdir());

const packages = fs
	.readdirSync(path.join(root, "packages"))
	.map((dir) => {
		const file = path.join(root, "packages", dir, "package.json");
		const manifest: Manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		return { dir: path.dirname(file), file, manifest };
	})
	.filter(({ manifest }) => manifest.private !== true);

/** Next versions from the pending change intents (`pnpm change status`), by package name. */
const planned = () => {
	const next = new Map<string, string>();
	for (const match of run("pnpm", ["change", "status"]).matchAll(/^\s+(\S+): \S+ → (\S+)/gmu)) {
		const [, name, version] = match;
		if (name !== undefined && version !== undefined) next.set(name, version);
	}
	return next;
};

const bumpPatch = (version: string) => {
	const [major, minor, patch] = version.split("-")[0]?.split(".").map(Number) ?? [];
	return `${major}.${minor}.${(patch ?? 0) + 1}`;
};

/** The versions npm has of `name`; empty when the package doesn't exist there. Other failures throw. */
const publishedVersions = (name: string): ReadonlyArray<string> => {
	try {
		const versions: unknown = JSON.parse(npm(["view", name, "versions", "--json"]));
		return Array.isArray(versions) ? versions.filter((v) => typeof v === "string") : [String(versions)];
	} catch (error) {
		const output = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
		if (output.includes("E404")) return [];
		throw error;
	}
};

const commands: Record<string, (args: ReadonlyArray<string>) => void> = {
	nightly: () => {
		const next = planned();
		const sha = run("git", ["rev-parse", "--short=7", "HEAD"]).trim();
		const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
		for (const { file, manifest } of packages) {
			// Packages the intents don't bump are still published, so nightlies depend on each other's nightlies.
			const base = next.get(manifest.name) ?? bumpPatch(manifest.version);
			const version = `${base}-nightly.${stamp}.g${sha}`;
			const source = fs.readFileSync(file, "utf8");
			fs.writeFileSync(file, source.replace(`"version": "${manifest.version}"`, `"version": "${version}"`));
			print(`${manifest.name}@${version}`);
		}
	},
	publish: ([tag]) => {
		if (tag === undefined) throw new Error("usage: node scripts/release.ts publish <dist-tag>");
		const out = fs.mkdtempSync(path.join(os.tmpdir(), "alchemy-unifi-release-"));
		for (const { dir } of packages) {
			// Re-read: `nightly` may have changed the version.
			const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
			const versions = publishedVersions(manifest.name);
			// Trusted publishing only works for packages that exist (docs/releasing.md has the bootstrap).
			if (versions.length === 0) {
				if (tag === "latest") throw new Error(`${manifest.name} isn't on npm yet: bootstrap it first`);
				print(`${manifest.name} isn't on npm yet; skipping its ${tag}`);
				continue;
			}
			if (versions.includes(manifest.version)) {
				print(`${manifest.name}@${manifest.version} is already on npm`);
				continue;
			}
			// pnpm packs (rewriting `workspace:` ranges); npm publishes, as it handles trusted publishing.
			const tarball = run("pnpm", ["pack", "--pack-destination", out], dir).trim().split("\n").at(-1) ?? "";
			npm(["publish", path.resolve(dir, tarball), "--provenance", "--access", "public", "--tag", tag]);
			print(`published ${manifest.name}@${manifest.version} (${tag})`);
		}
	},
	notes: () => {
		const released = packages.filter(({ file, manifest }) => {
			const before: Manifest = JSON.parse(run("git", ["show", `HEAD:${path.relative(root, file)}`]));
			return before.version !== manifest.version;
		});
		const releases = released.map(({ dir, manifest }) => {
			const file = path.join(dir, "CHANGELOG.md");
			const changelog = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
			// The newest section: from the first `## ` heading to the next.
			const [, section = ""] = changelog.split(/^## /mu);
			const body = section.slice(section.indexOf("\n") + 1).trim();
			return { tag: `${manifest.name}@${manifest.version}`, body };
		});
		print(JSON.stringify(releases));
	},
};

const [name = "", ...rest] = process.argv.slice(2);
const command = commands[name];
if (command === undefined) {
	process.stderr.write("usage: node scripts/release.ts nightly | publish <tag> | notes\n");
	process.exitCode = 1;
} else {
	command(rest);
}
