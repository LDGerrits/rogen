import { jest } from "@jest/globals";
import { ResultError } from "../../../base/result.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
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
	let logService: NullLogService;
	let print: ReturnType<typeof jest.spyOn>;
	let harness: CommandHarness<NullLogService>;

	const fmt = (...positionals: string[]) =>
		harness.run("fmt-project", { positionals });

	beforeEach(() => {
		logService = new NullLogService();
		print = jest.spyOn(logService, "print");
		harness = commandHarness({ log: logService });
	});

	it("should format the config here and say which file it formatted", async () => {
		await harness.fs.writeFile("/repo/rogen.json", CONFIG);

		const result = await fmt();

		expect(result.isOk()).toBe(true);
		expect(print).toHaveBeenCalledWith("formatted rogen.json");
		expect(
			Object.keys(
				JSON.parse(await harness.fs.readFile("/repo/rogen.json"))
			)
		).toEqual(["name", "sourcePaths", "routes"]);
	});

	it("should say nothing when the file is already formatted", async () => {
		await harness.fs.writeFile("/repo/rogen.json", CONFIG);
		await fmt();
		print.mockClear();

		const result = await fmt();

		expect(result.isOk()).toBe(true);
		expect(print).not.toHaveBeenCalled();
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

		expect(print).toHaveBeenCalledWith("formatted rogen.json");
		expect(print).toHaveBeenCalledWith("formatted places/lobby/rogen.json");
	});

	it("should format a place that drops a key it inherits with null", async () => {
		await harness.fs.createDirectory("/repo/places/lobby");
		await harness.fs.writeFile(
			"/repo/rogen.json",
			JSON.stringify({
				placePaths: ["places/*"],
				name: "Game",
				servePlaceIds: [1818],
			})
		);
		await harness.fs.writeFile(
			"/repo/places/lobby/rogen.json",
			JSON.stringify({ servePlaceIds: null, servePort: 34872 })
		);

		await fmt();

		expect(print).toHaveBeenCalledWith("formatted places/lobby/rogen.json");
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

		expect(print).toHaveBeenCalledWith("formatted places/lobby/rogen.json");
		expect(print).not.toHaveBeenCalledWith("formatted rogen.json");
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

		const [first, second] = print.mock.calls.map((call: unknown[]) =>
			JSON.parse(String(call[0]))
		);
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
		expect(print).toHaveBeenCalledTimes(2);
	});

	it("should tell a refused file in the document, and exit 1", async () => {
		await harness.fs.writeFile("/repo/rogen.jsonc", CONFIG);

		const result = await harness.run("fmt-project", {
			positionals: [],
			options: { json: true },
		});

		expect(result.isErr()).toBe(true);
		const document = JSON.parse(String(print.mock.calls[0][0]));
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
