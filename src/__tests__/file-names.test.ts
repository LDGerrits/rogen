import fs from "fs";
import path from "path";

const LAYERS = ["platform", "domain", "commands"];

const EXCEPTIONS: Readonly<Record<string, string>> = {
	"platform/environment/args":
		"the parser, the CommandLine it makes and the global options sit together",
};

const kebab = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const sourceFiles = (dir: string): string[] =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : sourceFiles(full);
		}
		return entry.name.endsWith(".ts") ? [full] : [];
	});

const exportedNames = (text: string) =>
	[
		...text.matchAll(
			/^export (?:declare )?(?:abstract )?(?:async )?(?:const )?(?:class|interface|type|enum|const|function) ([A-Za-z0-9_]+)/gm
		),
	].map(([, name]) => kebab(name));

describe("file names", () => {
	const files = LAYERS.flatMap((layer) =>
		sourceFiles(path.join("src", layer)).map((file) => ({
			id: path.relative("src", file).replace(/\.ts$/, ""),
			module: path.basename(path.dirname(file)),
			stem: path.basename(file, ".ts"),
			names: exportedNames(fs.readFileSync(file, "utf8")),
		}))
	);

	it.each(files.map((file) => [file.id, file] as const))(
		"should name what %s holds",
		(id, { module, stem, names }) => {
			const namesStem =
				stem === module ||
				stem.endsWith("-command") ||
				names.includes(stem) ||
				names.includes(stem.replace(/s$/, "")) ||
				id in EXCEPTIONS;

			expect(namesStem).toBe(true);
		}
	);

	it("should list only exceptions that still exist", () => {
		const ids = new Set(files.map(({ id }) => id));

		expect(Object.keys(EXCEPTIONS).filter((id) => !ids.has(id))).toEqual(
			[]
		);
	});
});
