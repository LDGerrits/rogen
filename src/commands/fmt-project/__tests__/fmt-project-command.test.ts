import { ResultError } from "../../../base/result.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	CommandHarness,
	commandHarness,
} from "../../__tests__/command-harness.js";
import "../fmt-project-command.js";

const CONFIG = JSON.stringify({
	sourcePaths: ["src"],
	routes: { "*": "ReplicatedStorage" },
	name: "Game",
});

describe("fmt-project command", () => {
	let logService: MockLogService;
	let harness: CommandHarness<MockLogService>;

	const fmt = (...positionals: string[]) =>
		harness.run("fmt-project", { positionals });

	beforeEach(() => {
		logService = new MockLogService();
		harness = commandHarness({ log: logService });
	});

	it("should format the config here and say which file it formatted", async () => {
		await harness.fs.writeFile("/repo/rogen.json", CONFIG);

		const result = await fmt();

		expect(result.isOk()).toBe(true);
		expect(logService.texts("print")).toContain("formatted rogen.json");
		expect(
			Object.keys(
				JSON.parse(await harness.fs.readFile("/repo/rogen.json"))
			)
		).toEqual(["name", "sourcePaths", "routes"]);
	});

	it("should say nothing when the file is already formatted", async () => {
		await harness.fs.writeFile("/repo/rogen.json", CONFIG);
		await fmt();
		logService.clear();

		const result = await fmt();

		expect(result.isOk()).toBe(true);
		expect(logService.texts("print")).toEqual([]);
	});

	it("should format every place of a root, and the root", async () => {
		await harness.fs.createDirectory("/repo/places/lobby");
		await harness.fs.writeFile(
			"/repo/rogen.json",
			JSON.stringify({
				placePaths: ["places/*"],
				name: "Game",
			})
		);
		await harness.fs.writeFile(
			"/repo/places/lobby/rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				routes: { "*": "ReplicatedStorage" },
				name: "Lobby",
			})
		);

		await fmt();

		expect(logService.texts("print")).toContain("formatted rogen.json");
		expect(logService.texts("print")).toContain(
			"formatted places/lobby/rogen.json"
		);
	});

	it("should format only the place it is given when the root doesn't load", async () => {
		await harness.fs.createDirectory("/repo/places/lobby");
		await harness.fs.writeFile(
			"/repo/rogen.json",
			'{ "placePaths": ["places/*"], "name": "Game", "routes": 5 }'
		);
		await harness.fs.writeFile(
			"/repo/places/lobby/rogen.json",
			JSON.stringify({ sourcePaths: ["src"], name: "Lobby" })
		);

		await fmt("places/lobby");

		expect(logService.texts("print")).toContain(
			"formatted places/lobby/rogen.json"
		);
		expect(logService.texts("print")).not.toContain("formatted rogen.json");
	});

	it("should tell each file's outcome with --json", async () => {
		await harness.fs.writeFile("/repo/rogen.json", CONFIG);

		await harness.run("fmt-project", {
			positionals: [],
			options: { json: true },
		});
		await harness.run("fmt-project", {
			positionals: [],
			options: { json: true },
		});

		const [first, second] = logService
			.texts("print")
			.map((text) => JSON.parse(text));
		expect(first).toEqual({
			changed: true,
			files: [
				{
					file: "/repo/rogen.json",
					outcome: "wrote",
					diagnostics: [],
				},
			],
		});
		expect(second.changed).toBe(false);
		expect(second.files[0].outcome).toBe("unchanged");
		expect(logService.texts("print")).toHaveLength(2);
	});

	it("should tell a refused file in the document, and exit 1", async () => {
		await harness.fs.writeFile("/repo/rogen.jsonc", CONFIG);

		const result = await harness.run("fmt-project", {
			positionals: [],
			options: { json: true },
		});

		expect(result.isErr()).toBe(true);
		const document = JSON.parse(logService.texts("print")[0]);
		expect(document.files[0]).toMatchObject({
			file: "/repo/rogen.jsonc",
			outcome: "failed",
			diagnostics: [{ code: "format.commentsLost", severity: "error" }],
		});
	});

	it("should refuse a rogen.jsonc and exit with the diagnostic", async () => {
		await harness.fs.writeFile("/repo/rogen.jsonc", CONFIG);

		const result = await fmt();

		expect((result as ResultError<Error>).error.message).toContain(
			"format.commentsLost"
		);
		expect(await harness.fs.readFile("/repo/rogen.jsonc")).toBe(CONFIG);
	});

	it("should fail when there is no config to format", async () => {
		const result = await fmt();

		expect(result.isErr()).toBe(true);
	});
});
