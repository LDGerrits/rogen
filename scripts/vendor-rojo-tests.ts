import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const REPOSITORY = "rojo-rbx/rojo";
const VENDORED: readonly { readonly source: string; readonly dir: string }[] = [
	{ source: "rojo-test/build-tests/", dir: "e2e/rojo-build-tests" },
	{ source: "rojo-test/syncback-tests/", dir: "e2e/rojo-syncback-tests" },
];
const VERSION_FILE = "VERSION";

export function pinnedRojoVersion(manifest: string): string {
	const version = /rojo-rbx\/rojo@(\S+?)"/.exec(manifest)?.[1];
	if (!version) throw new Error("rokit.toml does not pin Rojo.");
	return version;
}

async function fetchText(url: string): Promise<Buffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

async function vendorRojoTests(
	version: string,
	source: string,
	outDir: string
): Promise<number> {
	const tree = JSON.parse(
		(
			await fetchText(
				`https://api.github.com/repos/${REPOSITORY}/git/trees/v${version}?recursive=1`
			)
		).toString("utf8")
	) as { tree: { path: string; type: string }[] };
	const files = tree.tree.filter(
		(entry) => entry.type === "blob" && entry.path.startsWith(source)
	);
	fs.rmSync(outDir, { recursive: true, force: true });
	for (const file of files) {
		const target = path.join(outDir, file.path.slice(source.length));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(
			target,
			await fetchText(
				`https://raw.githubusercontent.com/${REPOSITORY}/v${version}/${file.path}`
			)
		);
	}
	fs.writeFileSync(
		path.join(outDir, "LICENSE.txt"),
		await fetchText(
			`https://raw.githubusercontent.com/${REPOSITORY}/v${version}/LICENSE.txt`
		)
	);
	fs.writeFileSync(path.join(outDir, VERSION_FILE), `${version}\n`);
	return files.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const version = pinnedRojoVersion(fs.readFileSync("rokit.toml", "utf8"));
	for (const { source, dir } of VENDORED) {
		const count = await vendorRojoTests(version, source, path.resolve(dir));
		console.log(`Copied ${count} files of Rojo ${version} to ${dir}.`);
	}
}
