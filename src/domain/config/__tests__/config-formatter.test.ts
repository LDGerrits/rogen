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

	it("should write Rojo's keys first and Rogen's after in order, with two-space indentation and no trailing newline", async () => {
		await fs.writeFile("/repo/default.rogen.json", TABBED);

		const result = await format();

		expect(result.unwrap()).toBe(true);
		expect(await fs.readFile("/repo/default.rogen.json")).toBe(
			[
				"{",
				'  "name": "Game",',
				'  "tree": {',
				'    "$className": "DataModel",',
				'    "ReplicatedStorage": {',
				'      "$className": "ReplicatedStorage"',
				"    }",
				"  },",
				'  "servePort": 34873,',
				'  "sourcePaths": [',
				'    "src"',
				"  ],",
				'  "routes": {',
				'    "server": "ServerScriptService",',
				'    "*": "ReplicatedStorage"',
				"  },",
				'  "compiledPath": "out"',
				"}",
			].join("\n")
		);
	});

	it("should name a config after its folder when it has no name, as Rojo does a project file", async () => {
		await fs.writeFile(
			"/repo/default.rogen.json",
			'{"sourcePaths":["src"]}'
		);

		await format();

		expect(
			JSON.parse(await fs.readFile("/repo/default.rogen.json"))
		).toEqual({
			name: "repo",
			sourcePaths: ["src"],
		});
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

	it("should refuse a default.rogen.jsonc and leave it as it is", async () => {
		await fs.writeFile("/repo/default.rogen.jsonc", '{ "name": "Game" }');

		const result = await format("/repo/default.rogen.jsonc");

		expect(result.isErr()).toBe(true);
		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic).toMatchObject({
			code: "format.commentsLost",
			resource: "/repo/default.rogen.jsonc",
			message:
				"default.rogen.jsonc may hold comments, and formatting writes none. Rename it to default.rogen.json to format it, or format it in your editor.",
		});
		expect(await fs.readFile("/repo/default.rogen.jsonc")).toBe(
			'{ "name": "Game" }'
		);
	});

	it.each([
		'{ // the name\n "name": "Game" }',
		'{ /* the name */ "name": "Game" }',
	])("should refuse a default.rogen.json with comments", async (text) => {
		await fs.writeFile("/repo/default.rogen.json", text);

		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("format.commentsLost");
		expect(diagnostic.message).toBe(
			"default.rogen.json has comments, and formatting writes none. Remove them first, or format it in your editor."
		);
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
