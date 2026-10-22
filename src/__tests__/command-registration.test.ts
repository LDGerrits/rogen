import fs from "fs";
import path from "path";

const SRC = path.resolve(import.meta.dirname, "..");
const CLI_PAGE = path.resolve(SRC, "../docs/content/docs/v2/cli.mdx");

const commandIds = fs
	.readdirSync(path.join(SRC, "commands"), { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && entry.name !== "__tests__")
	.map((entry) => entry.name);

describe("the commands", () => {
	it("should each be imported by main, which registers them", () => {
		const main = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");

		expect(
			commandIds.filter(
				(id) =>
					!main.includes(
						`import "./commands/${id}/${id}-command.js";`
					)
			)
		).toEqual([]);
	});

	it("should each have a section on the command line page", () => {
		const page = fs.readFileSync(CLI_PAGE, "utf8");

		expect(
			commandIds.filter(
				(id) => !new RegExp(`^### \`${id}[ \`]`, "m").test(page)
			)
		).toEqual([]);
	});
});

describe("the services", () => {
	const sourcesUnder = (dir: string): string[] =>
		fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory())
				return entry.name === "__tests__" ? [] : sourcesUnder(full);
			return entry.name.endsWith(".ts") ? [full] : [];
		});

	it("should each be set in main when a command asks for it", () => {
		const main = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");
		const provided = new Set(
			[...main.matchAll(/services\.set\(\s*(\w+)/g)].map(([, id]) => id)
		);
		const asked = new Set(
			sourcesUnder(path.join(SRC, "commands")).flatMap((file) =>
				[
					...fs
						.readFileSync(file, "utf8")
						.matchAll(/accessor\.get\((\w+)\)/g),
				].map(([, id]) => id)
			)
		);

		expect([...asked].filter((id) => !provided.has(id))).toEqual([]);
	});
});
