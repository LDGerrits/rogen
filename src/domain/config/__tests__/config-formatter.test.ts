import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ConfigFormatter } from "../config-formatter.js";

const TABBED = `{
	"sourcePaths": ["src"],
	"routes": { "server": "ServerScriptService", "*": "ReplicatedStorage" },
	"name": "Game",
	"tree": { "ReplicatedStorage": { "$className": "ReplicatedStorage" }, "$className": "DataModel" },
	"servePort": 34873
}
`;

describe("ConfigFormatter", () => {
	let fs: MemoryFileSystemService;
	let formatter: ConfigFormatter;

	const format = (file = "/repo/rogen.json") => formatter.format(file);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		formatter = new ConfigFormatter(fs);
	});

	it("should write Rojo's keys first and Rogen's after, with two-space indentation and no trailing newline", async () => {
		await fs.writeFile("/repo/rogen.json", TABBED);

		const result = await format();

		expect(result.unwrap()).toBe(true);
		expect(await fs.readFile("/repo/rogen.json")).toBe(
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
				"  }",
				"}",
			].join("\n")
		);
	});

	it("should leave a formatted file alone and say nothing changed", async () => {
		await fs.writeFile("/repo/rogen.json", TABBED);
		await format();

		const result = await format();

		expect(result.unwrap()).toBe(false);
	});

	it("should refuse a rogen.jsonc and leave it as it is", async () => {
		await fs.writeFile("/repo/rogen.jsonc", '{ "name": "Game" }');

		const result = await format("/repo/rogen.jsonc");

		expect(result.isErr()).toBe(true);
		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic).toMatchObject({
			code: "format.commentsLost",
			resource: "/repo/rogen.jsonc",
			message:
				"rogen.jsonc may hold comments, and formatting writes none. Rename it to rogen.json to format it, or format it in your editor.",
		});
		expect(await fs.readFile("/repo/rogen.jsonc")).toBe(
			'{ "name": "Game" }'
		);
	});

	it.each([
		['{ // the name\n "name": "Game" }', "comment"],
		['{ "name": "Game", }', "trailing comma"],
	])("should refuse a rogen.json with a %s", async (text) => {
		await fs.writeFile("/repo/rogen.json", text);

		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("format.commentsLost");
		expect(diagnostic.message).toBe(
			"rogen.json has comments or trailing commas, and formatting writes none. Remove them first, or format it in your editor."
		);
		expect(await fs.readFile("/repo/rogen.json")).toBe(text);
	});

	it("should report a file that isn't JSON where it breaks", async () => {
		await fs.writeFile("/repo/rogen.json", '{ "name": ');

		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("config.invalidSyntax");
	});

	it("should report a file that doesn't exist", async () => {
		const result = await format();

		const [diagnostic] = result.isErr() ? result.error : [];
		expect(diagnostic.code).toBe("config.unreadable");
	});

	it("should order each project the way it orders the config", async () => {
		await fs.writeFile(
			"/repo/rogen.json",
			JSON.stringify({
				projects: {
					release: { routes: {}, globIgnorePaths: ["x"], name: "R" },
				},
				name: "Game",
			})
		);

		await format();

		const written = JSON.parse(await fs.readFile("/repo/rogen.json"));
		expect(Object.keys(written)).toEqual(["name", "projects"]);
		expect(Object.keys(written.projects.release)).toEqual([
			"name",
			"globIgnorePaths",
			"routes",
		]);
	});
});
