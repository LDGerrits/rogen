import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ConfigFormatter } from "../config-formatter.js";

const TABBED = `{
	"compiledPath": "out",
	"routes": { "server": "ServerScriptService", "*": "ReplicatedStorage" },
	"sourcePaths": ["src"],
	"name": "Game",
	"tree": { "ReplicatedStorage": { "$className": "ReplicatedStorage" }, "$className": "DataModel" },
	"servePort": 34873
}
`;

describe("ConfigFormatter", () => {
	let fs: MemoryFileSystemService;
	let formatter: ConfigFormatter;

	const format = (file = "/repo/default.rogen.json") =>
		formatter.format(file);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		formatter = new ConfigFormatter(fs);
	});

	it("should write Rogen's keys in order after the name and before the tree, with two-space indentation and no trailing newline", async () => {
		await fs.writeFile("/repo/default.rogen.json", TABBED);

		const result = await format();

		expect(result.unwrap()).toBe(true);
		expect(await fs.readFile("/repo/default.rogen.json")).toBe(
			[
				"{",
				'  "name": "Game",',
				'  "sourcePaths": [',
				'    "src"',
				"  ],",
				'  "routes": {',
				'    "server": "ServerScriptService",',
				'    "*": "ReplicatedStorage"',
				"  },",
				'  "compiledPath": "out",',
				'  "tree": {',
				'    "$className": "DataModel",',
				'    "ReplicatedStorage": {',
				'      "$className": "ReplicatedStorage"',
				"    }",
				"  },",
				'  "servePort": 34873',
				"}",
			].join("\n")
		);
	});

	it("should name a config after its folder when it has no name, as Rojo does a project file", async () => {
		await fs.writeFile("/repo/default.rogen.json", '{"servePort":34873}');

		await format();

		expect(
			JSON.parse(await fs.readFile("/repo/default.rogen.json"))
		).toEqual({
			name: "repo",
			servePort: 34873,
		});
	});

	it("should refuse a config with a key neither Rojo's nor Rogen's, as check does, and leave the file", async () => {
		const text =
			'{ "name": "u", "bogus": 1, "tree": { "$className": "DataModel" } }';
		await fs.writeFile("/repo/default.rogen.json", text);

		const result = await format();

		expect(result.isErr() ? result.error : []).toMatchObject([
			{
				code: "config.unknownField",
				resource: "/repo/default.rogen.json",
				position: { line: 1, column: 16 },
			},
		]);
		expect(await fs.readFile("/repo/default.rogen.json")).toBe(text);
	});

	it("should refuse a value Rojo can't read, as check does", async () => {
		const text = '{ "name": "u", "servePort": 70000 }';
		await fs.writeFile("/repo/default.rogen.json", text);

		const result = await format();

		expect(result.isErr() ? result.error : []).toMatchObject([
			{ code: "config.wrongType" },
		]);
		expect(await fs.readFile("/repo/default.rogen.json")).toBe(text);
	});

	it("should refuse a named config without a name rather than take the folder's", async () => {
		const text = '{ "servePort": 34873 }';
		await fs.writeFile("/repo/lobby.rogen.json", text);

		const result = await format("/repo/lobby.rogen.json");

		expect(result.isErr() ? result.error : []).toMatchObject([
			{ code: "config.unnamedProjectFile" },
		]);
		expect(await fs.readFile("/repo/lobby.rogen.json")).toBe(text);
	});

	it("should keep the name a config has", async () => {
		await fs.writeFile("/repo/default.rogen.json", '{"name":"Game"}');

		await format();

		expect(
			JSON.parse(await fs.readFile("/repo/default.rogen.json"))
		).toEqual({
			name: "Game",
		});
	});

	it("should leave a formatted file alone and say nothing changed", async () => {
		await fs.writeFile("/repo/default.rogen.json", TABBED);
		await format();

		const result = await format();

		expect(result.unwrap()).toBe(false);
	});

	describe("comments", () => {
		const formatted = async (text: string, file = "default.rogen.json") => {
			await fs.writeFile(`/repo/${file}`, text);
			const result = await format(`/repo/${file}`);
			expect(result.isOk()).toBe(true);
			return fs.readFile(`/repo/${file}`);
		};

		it("should format a default.rogen.jsonc without comments as it would a default.rogen.json", async () => {
			const jsonc = await formatted(TABBED, "default.rogen.jsonc");
			const json = await formatted(TABBED, "default.rogen.json");

			expect(jsonc).toBe(json);
		});

		it("should move a comment on its own line with the entry after it", async () => {
			const text = await formatted(
				'{\n  "servePort": 1, \n  // the name\n  "name": "Game"\n}',
				"default.rogen.jsonc"
			);

			expect(text).toBe(
				'{\n  // the name\n  "name": "Game",\n  "servePort": 1\n}'
			);
		});

		it("should move a comment at the end of a line with the entry on that line", async () => {
			const text = await formatted(
				'{ "servePort": 1, // the port\n "name": "Game" // the game\n}',
				"default.rogen.jsonc"
			);

			expect(text).toBe(
				'{\n  "name": "Game", // the game\n  "servePort": 1 // the port\n}'
			);
		});

		it("should keep a comment before a closing brace at the end of its object", async () => {
			const text = await formatted(
				'{\n  "name": "Game",\n  "tree": {\n    "$className": "DataModel"\n    // nothing else\n  }\n}',
				"default.rogen.jsonc"
			);

			expect(text).toBe(
				'{\n  "name": "Game",\n  "tree": {\n    "$className": "DataModel"\n    // nothing else\n  }\n}'
			);
		});

		it("should keep comments in a default.rogen.json too, and format it the same the second time", async () => {
			const once = await formatted(
				'{ /* a */ "tree": { "$className": "DataModel", "B": {}, // b\n "A": {} }, "name": "Game" }'
			);
			const twice = await formatted(once);

			expect(once).toContain("/* a */");
			expect(once).toContain("// b");
			expect(twice).toBe(once);
		});

		it("should keep the comments before and after the document", async () => {
			const text = await formatted(
				'// top\n{ "name": "Game" }\n// bottom',
				"default.rogen.jsonc"
			);

			expect(text).toBe('// top\n{\n  "name": "Game"\n}\n// bottom');
		});

		it("should keep the comment of an entry that formatting leaves out at the end of the object it was in", async () => {
			const text = await formatted(
				'{ "name": "Game", "tree": { "$className": "Folder",\n // props\n "$properties": {} } }',
				"default.rogen.jsonc"
			);

			expect(text).toBe(
				'{\n  "name": "Game",\n  "tree": {\n    "$className": "Folder"\n    // props\n  }\n}'
			);
		});

		it("should print an empty object with only a comment after its brace the same the second time", async () => {
			const once = await formatted(
				'{ "name": "Game", "tree": { // open\n } }',
				"default.rogen.jsonc"
			);
			const twice = await formatted(once, "default.rogen.jsonc");

			expect(once).toBe(
				'{\n  "name": "Game",\n  "tree": { // open\n  }\n}'
			);
			expect(twice).toBe(once);
		});

		it("should keep the comments of a multi-line block comment aligned", async () => {
			const text = await formatted(
				'{\n      /* one\n         two */\n  "name": "Game"\n}',
				"default.rogen.jsonc"
			);

			expect(text).toBe('{\n  /* one\n     two */\n  "name": "Game"\n}');
		});
	});

	it("should refuse a tree value Rojo can't read, as rojo fmt-project does, and leave the file", async () => {
		const text =
			'{ "name": "Game", "tree": { "$className": "DataModel", "StarterGui": { "Bar": { "$className": "Frame", "$properties": { "Size": [[0, 0], [0.5, -5]] } } } } }';
		await fs.writeFile("/repo/default.rogen.json", text);

		const result = await format();

		expect(result.isErr() ? result.error : []).toMatchObject([
			{
				code: "tree.unreadableValue",
				resource: "/repo/default.rogen.json",
				position: { line: 1, column: 129 },
			},
		]);
		expect(await fs.readFile("/repo/default.rogen.json")).toBe(text);
	});

	it("should format a default.rogen.json with a trailing comma", async () => {
		await fs.writeFile(
			"/repo/default.rogen.json",
			'{ "name": "Game", "tree": { "$className": "DataModel", }, }'
		);

		const result = await format();

		expect(result.unwrap()).toBe(true);
		expect(
			JSON.parse(await fs.readFile("/repo/default.rogen.json"))
		).toEqual({ name: "Game", tree: { $className: "DataModel" } });
	});

	it("should not take a // inside a string for a comment", async () => {
		await fs.writeFile(
			"/repo/default.rogen.json",
			'{ "name": "Game", "tree": { "$className": "DataModel", "$path": "http://x" } }'
		);

		const result = await format();

		expect(result.isOk()).toBe(true);
	});

	it("should format a file that starts with a byte order mark", async () => {
		await fs.writeFile("/repo/default.rogen.json", `\uFEFF${TABBED}`);

		const result = await format();

		expect(result.unwrap()).toBe(true);
		expect(
			JSON.parse(await fs.readFile("/repo/default.rogen.json")).name
		).toBe("Game");
	});

	it("should report a file that isn't JSON where it breaks", async () => {
		await fs.writeFile("/repo/default.rogen.json", '{ "name": ');

		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("config.invalidSyntax");
	});

	it("should report a file that doesn't exist", async () => {
		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("config.unreadable");
	});
});
