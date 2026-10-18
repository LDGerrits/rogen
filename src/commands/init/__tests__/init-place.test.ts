import path from "path";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { parseJsonc } from "../../../base/jsonc.js";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	CANCEL,
	MockPromptService,
	PromptScript,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";

const LISTING = "How do you want to list this place?";
const PLACE_ID = "Place ID";

describe("init for a place", () => {
	const root = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;
	let log: MockLogService;

	const run = async (
		positionals: string[],
		answers: PromptScript = [],
		interactive = false,
		cwd = root,
		options: Record<string, string | readonly string[]> = {}
	) => {
		log = new MockLogService();
		const harness = commandHarness({
			cwd,
			fs: memFs,
			log,
			prompt: new MockPromptService(answers, interactive),
			environment: new NativeEnvironmentService({}, cwd),
		});
		return harness.run("init", { positionals, options });
	};

	const write = (file: string, content: unknown = "") =>
		memFs.writeFile(
			path.join(root, file),
			typeof content === "string" ? content : JSON.stringify(content)
		);
	const read = (file: string) => memFs.readFile(path.join(root, file));
	const readJson = async (file: string) => JSON.parse(await read(file));
	const exists = (file: string) => memFs.exists(path.join(root, file));
	const failure = (result: Awaited<ReturnType<typeof run>>) =>
		(result as ResultError<Error>).error;

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory(root);
		await write("rogen.json", {
			routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
			placePaths: ["places/*"],
		});
	});

	it("should write the place's rogen.json with the port it is served on, and its source folder", async () => {
		const result = await run(["places/lobby"]);

		expect(result.isOk()).toBe(true);
		expect(await readJson("places/lobby/rogen.json")).toEqual({
			$schema: expect.any(String),
			servePort: 34872,
		});
		expect(
			await memFs.isDirectory(path.join(root, "places/lobby/src"))
		).toBe(true);
	});

	it("should leave the config that lists the place alone when a glob already lists it", async () => {
		const before = await read("rogen.json");

		await run(["places/lobby"]);

		expect(await read("rogen.json")).toBe(before);
	});

	it("should build the place it adds", async () => {
		await run(["places/lobby"]);

		expect(await exists("places/lobby/default.project.json")).toBe(true);
	});

	it("should count the places that are there when it picks the port, and keep the ones they pin", async () => {
		await write("places/arena/rogen.json", { servePort: 34872 });
		await memFs.createDirectory(path.join(root, "places/hub"));

		await run(["places/lobby"]);

		expect((await readJson("places/lobby/rogen.json")).servePort).toBe(
			34874
		);
	});

	it("should pin a port that does not move when a place that sorts earlier is added", async () => {
		await run(["places/lobby"]);
		await run(["places/arena"]);

		expect((await readJson("places/lobby/rogen.json")).servePort).toBe(
			34872
		);
		expect((await readJson("places/arena/rogen.json")).servePort).toBe(
			34873
		);
	});

	it("should give a place that sorts first a port that moves none of the places that pin none", async () => {
		await memFs.createDirectory(path.join(root, "places/arena"));

		await run(["places/aaa"]);

		expect((await readJson("places/aaa/rogen.json")).servePort).toBe(34873);
	});

	it("should add the parent folder as a glob to placePaths, without asking, when nothing is a place yet", async () => {
		await write("rogen.json", { routes: { "*": "ReplicatedStorage" } });

		await run(["places/lobby"]);

		expect((await readJson("rogen.json")).placePaths).toEqual(["places/*"]);
		expect(log.texts("success")).toContain(
			'Added "places/*" as a place path to rogen.json.'
		);
	});

	it("should keep what rogen.json holds when it adds the glob", async () => {
		await write("rogen.json", {
			name: "Game",
			routes: { "*": "ReplicatedStorage" },
		});

		await run(["places/lobby"]);

		expect(await readJson("rogen.json")).toEqual({
			name: "Game",
			routes: { "*": "ReplicatedStorage" },
			placePaths: ["places/*"],
		});
	});

	it("should add to the list when a glob does not match the place", async () => {
		await write("rogen.json", {
			routes: { "*": "ReplicatedStorage" },
			placePaths: ["games/*"],
		});

		await run(["places/lobby"]);

		expect((await readJson("rogen.json")).placePaths).toEqual([
			"games/*",
			"places/*",
		]);
	});

	it("should ask whether to list the glob or the folder in a terminal", async () => {
		await write("rogen.json", { routes: { "*": "ReplicatedStorage" } });

		await run(
			["places/lobby"],
			{ [LISTING]: "folder", [PLACE_ID]: "" },
			true
		);

		expect((await readJson("rogen.json")).placePaths).toEqual([
			"places/lobby",
		]);
	});

	it("should list the folder itself when it sits directly in the root", async () => {
		await write("rogen.json", { routes: { "*": "ReplicatedStorage" } });

		await run(["lobby"], { [PLACE_ID]: "" }, true);

		expect((await readJson("rogen.json")).placePaths).toEqual(["lobby"]);
	});

	it("should write the place's own source paths when asked for others", async () => {
		await run(
			["places/lobby"],
			{ "Source paths": "code, dev", [PLACE_ID]: "" },
			true
		);

		expect(await readJson("places/lobby/rogen.json")).toMatchObject({
			sourcePaths: ["code", "dev"],
		});
		expect(
			await memFs.isDirectory(path.join(root, "places/lobby/code"))
		).toBe(true);
	});

	describe("the place ID", () => {
		it("should ask for it once in a terminal, and pin it as servePlaceIds", async () => {
			await run(["places/lobby"], { [PLACE_ID]: "1818" }, true);

			expect(await readJson("places/lobby/rogen.json")).toMatchObject({
				servePort: 34872,
				servePlaceIds: [1818],
			});
			expect(log.texts("info").join("\n")).not.toContain("--place-id");
		});

		it("should take several, separated by commas", async () => {
			await run(["places/lobby"], { [PLACE_ID]: "1818, 2020" }, true);

			expect(
				(await readJson("places/lobby/rogen.json")).servePlaceIds
			).toEqual([1818, 2020]);
		});

		it("should write none when the answer is empty, for a place that isn't published", async () => {
			await run(["places/lobby"], { [PLACE_ID]: "" }, true);

			expect(
				await readJson("places/lobby/rogen.json")
			).not.toHaveProperty("servePlaceIds");
		});

		it("should refuse a place ID that is not a number", async () => {
			await expect(
				run(["places/lobby"], { [PLACE_ID]: "lobby" }, true)
			).rejects.toThrow("rejected");
		});

		it("should skip it without a terminal, and say which flag gives one", async () => {
			await run(["places/lobby"]);

			expect(
				await readJson("places/lobby/rogen.json")
			).not.toHaveProperty("servePlaceIds");
			expect(log.texts("info").join("\n")).toContain(
				", --place-id none."
			);
		});

		it("should take it from --place-id, and ask nothing", async () => {
			await run(["places/lobby"], [], false, root, {
				"place-id": ["1818"],
			});

			expect(
				(await readJson("places/lobby/rogen.json")).servePlaceIds
			).toEqual([1818]);
			expect(log.texts("info").join("\n")).not.toContain("--place-id");
		});

		it("should write nothing when the user cancels it", async () => {
			const result = await run(
				["places/lobby"],
				{ [PLACE_ID]: CANCEL },
				true
			);

			expect(result.isErr()).toBe(true);
			expect(await exists("places/lobby/rogen.json")).toBe(false);
		});
	});

	it("should write nothing when the user cancels", async () => {
		const result = await run(
			["places/lobby"],
			{ "Source paths": CANCEL },
			true
		);

		expect(result.isErr()).toBe(true);
		expect(await exists("places/lobby/rogen.json")).toBe(false);
	});

	it("should write a workspace file that lists the config's folder and every place", async () => {
		await write("places/arena/rogen.json", "{}");

		await run(["places/lobby"]);

		expect(await readJson("my-game.code-workspace")).toEqual({
			folders: [
				{ path: "." },
				{ path: "places/arena" },
				{ path: "places/lobby" },
			],
		});
	});

	it("should leave a workspace file that is there alone, and say what to add", async () => {
		await write("game.code-workspace", "{}");

		await run(["places/lobby"]);

		expect(await read("game.code-workspace")).toBe("{}");
		expect(await exists("my-game.code-workspace")).toBe(false);
		expect(log.texts("info").join("\n")).toContain(
			'add the folder "places/lobby" to game.code-workspace'
		);
	});

	describe("a workspace file that is there", () => {
		it("should gain the place, with its comments and settings kept", async () => {
			const before = [
				"{",
				"\t// the editor",
				'\t"folders": [{ "path": "." }, { "path": "places/arena" }],',
				'\t"settings": { "luau-lsp.platform.type": "roblox" }',
				"}",
				"",
			].join("\n");
			await write("game.code-workspace", before);

			await run(["places/lobby"]);

			const after = await read("game.code-workspace");
			expect(after).toContain("// the editor");
			expect(after).toContain('"luau-lsp.platform.type": "roblox"');
			expect(parseJsonc(after).value).toEqual({
				folders: [
					{ path: "." },
					{ path: "places/arena" },
					{ path: "places/lobby" },
				],
				settings: { "luau-lsp.platform.type": "roblox" },
			});
			expect(log.texts("success")).toContain(
				"Added places/lobby to game.code-workspace."
			);
		});

		it("should put the place among the others by path", async () => {
			await write("game.code-workspace", {
				folders: [{ path: "." }, { path: "places/zed" }],
			});

			await run(["places/lobby"]);

			expect(
				(await readJson("game.code-workspace")).folders.map(
					(folder: { path: string }) => folder.path
				)
			).toEqual([".", "places/lobby", "places/zed"]);
		});

		it("should not take an entry with no path for the root, and say what to add", async () => {
			await write("game.code-workspace", {
				folders: [{ uri: "vscode-remote://host/game" }],
			});
			const before = await read("game.code-workspace");

			await run(["places/lobby"]);

			expect(await read("game.code-workspace")).toBe(before);
			expect(log.texts("info").join("\n")).toContain(
				'add the folder "places/lobby" to game.code-workspace'
			);
		});

		it.each([
			["a Windows path", "places\\lobby"],
			["a path with a detour", "places/x/../lobby"],
			["an absolute path", path.join(root, "places/lobby")],
		])("should find the place listed as %s", async (_, listed) => {
			await write("game.code-workspace", {
				folders: [{ path: "." }, { path: listed }],
			});
			const before = await read("game.code-workspace");

			await run(["places/lobby"]);

			expect(await read("game.code-workspace")).toBe(before);
		});

		it("should not list a place twice", async () => {
			await write("game.code-workspace", {
				folders: [{ path: "." }, { path: "./places/lobby/" }],
			});
			const before = await read("game.code-workspace");

			await run(["places/lobby"]);

			expect(await read("game.code-workspace")).toBe(before);
		});

		it("should edit every workspace file that lists the root", async () => {
			await write("a.code-workspace", { folders: [{ path: "." }] });
			await write("b.code-workspace", { folders: [{ path: root }] });

			await run(["places/lobby"]);

			for (const name of ["a", "b"])
				expect(
					(await readJson(`${name}.code-workspace`)).folders
				).toContainEqual({ path: "places/lobby" });
		});
	});

	it("should take the folder of a place the config lists that has no rogen.json yet", async () => {
		await memFs.createDirectory(path.join(root, "places/lobby"));

		const result = await run(["places/lobby"]);

		expect(result.isOk()).toBe(true);
		expect(await exists("places/lobby/rogen.json")).toBe(true);
	});

	it("should refuse the folder that holds a source path, which is the code the places share", async () => {
		await write("rogen.json", {
			sourcePaths: ["places/shared/src"],
			routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
			placePaths: ["places/*"],
		});
		await memFs.createDirectory(path.join(root, "places/shared/src"));

		const result = await run(["places/shared"]);

		expect(failure(result).message).toContain(
			"places/shared holds a source path of rogen.json, so it is the code the places share, not a place."
		);
		expect(await exists("places/shared/rogen.json")).toBe(false);
	});

	it("should not count the code the places share when it picks the port", async () => {
		await write("rogen.json", {
			sourcePaths: ["places/shared/src"],
			routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
			placePaths: ["places/*"],
		});
		await memFs.createDirectory(path.join(root, "places/shared/src"));

		await run(["places/lobby"]);

		expect((await readJson("places/lobby/rogen.json")).servePort).toBe(
			34872
		);
	});

	it("should work from a folder below the config", async () => {
		await memFs.createDirectory(path.join(root, "places"));

		const result = await run(
			["lobby"],
			[],
			false,
			path.join(root, "places")
		);

		expect(result.isOk()).toBe(true);
		expect(await exists("places/lobby/rogen.json")).toBe(true);
	});

	it("should say what it wrote and what to do next", async () => {
		await run(["places/lobby"]);

		expect(log.texts("success")).toEqual(
			expect.arrayContaining([
				"Created places/lobby/rogen.json.",
				"Created my-game.code-workspace.",
			])
		);
		expect(log.texts("info").join("\n")).toContain(
			"lobby is served on port 34872"
		);
	});

	describe("a flag for a place", () => {
		it.each([
			["place-id", ["1818"], "--place-id"],
			["place-listing", "folder", "--place-listing"],
		])(
			"should refuse --%s when no place folder is given",
			async (name, value, flag) => {
				const result = await run([], [], false, root, {
					[name]: value,
				});

				expect(failure(result).message).toContain(
					`${flag} is for a place folder`
				);
			}
		);
	});

	describe("what it refuses", () => {
		it("should refuse a folder that has a config", async () => {
			await write("places/lobby/rogen.json", "{}");

			const result = await run(["places/lobby"]);

			expect(failure(result)).toBeInstanceOf(DiagnosticsError);
			expect(
				(failure(result) as DiagnosticsError).diagnostics[0].code
			).toBe("init.configExists");
		});

		it("should refuse a config that has errors", async () => {
			await write("rogen.json", { sourcePaths: "src" });

			const result = await run(["places/lobby"]);

			expect(failure(result)).toBeInstanceOf(DiagnosticsError);
			expect(await exists("places/lobby/rogen.json")).toBe(false);
		});

		it("should refuse to add a place below a place", async () => {
			await write("places/lobby/rogen.json", "{}");

			const result = await run(["places/lobby/sub"]);

			expect(failure(result).message).toContain(
				"is a place of rogen.json"
			);
		});

		it("should not rewrite a .jsonc config, and say what to add", async () => {
			await memFs.delete(path.join(root, "rogen.json"));
			await write(
				"rogen.jsonc",
				'{ // routes\n "routes": { "*": "ReplicatedStorage" } }'
			);

			const result = await run(["places/lobby"]);

			expect(failure(result).message).toContain(
				'"placePaths": ["places/*"]'
			);
			expect(await read("rogen.jsonc")).toContain("// routes");
			expect(await exists("places/lobby/rogen.json")).toBe(false);
		});

		it("should not rewrite a rogen.json that holds comments either", async () => {
			await write(
				"rogen.json",
				'{ // routes\n "routes": { "*": "ReplicatedStorage" } }'
			);

			const result = await run(["places/lobby"]);

			expect(failure(result).message).toContain(
				'"placePaths": ["places/*"]'
			);
			expect(await read("rogen.json")).toContain("// routes");
		});

		it("should take one folder only", async () => {
			const result = await run(["places/a", "places/b"]);

			expect(failure(result).message).toBe(
				"init takes one folder, the place to add."
			);
		});
	});
});
