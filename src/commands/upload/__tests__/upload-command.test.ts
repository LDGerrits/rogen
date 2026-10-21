import path from "path";
import "../upload-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import {
	MockConfigService,
	brokenEntry,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("upload command", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const buildable = (folder = "", overrides = {}) =>
		mockEntry(
			{
				name: folder || "repo",
				sourcePaths: [abs(folder, "src")],
				routes: { "*": "ReplicatedStorage" },
				...overrides,
			},
			abs(folder, "rogen.json")
		);

	const start = (
		config: MockConfigService,
		options: CommandLine["options"] = { asset_id: "123" }
	) => {
		const log = new MockLogService();
		const running = commandHarness({
			fs,
			log,
			config,
			processes,
		}).run("upload", { positionals: [], options });
		return { log, running };
	};

	const spawnedCount = async (count: number) => {
		for (let i = 0; i < 50 && processes.spawned.length < count; i++)
			await new Promise((resolve) => setImmediate(resolve));
		return processes.spawned;
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		await fs.writeFile(abs("src/A.luau"), "");
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.7.1\n",
			stderr: "",
		});
	});

	it("should write the project file, then upload it with Rojo's flags as Rojo spells them", async () => {
		const { running } = start(new MockConfigService([buildable()]), {
			asset_id: "123",
			api_key: "key",
			universe_id: "45",
			cookie: "cookie",
		});
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(await fs.exists(abs("default.project.json"))).toBe(true);
		expect(rojo.args).toEqual([
			"upload",
			"default.project.json",
			"--asset_id",
			"123",
			"--api_key",
			"key",
			"--universe_id",
			"45",
			"--cookie",
			"cookie",
		]);
		expect(rojo.options.cwd).toBe("/repo");
	});

	it("should ask for --asset_id before it writes anything", async () => {
		const { running } = start(new MockConfigService([buildable()]), {});

		expect(((await running) as ResultError<Error>).error.message).toBe(
			"--asset_id names the place or model to upload to, and Rojo needs it."
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
		expect(processes.spawned).toEqual([]);
	});

	it("should say to name one place when it selects several, before it writes anything", async () => {
		const { running } = start(
			new MockConfigService([
				buildable("places/lobby", { isPlace: true }),
				buildable("places/arena", { isPlace: true }),
			])
		);

		expect(((await running) as ResultError<Error>).error.message).toBe(
			"'rojo upload' runs on one project, and this selects 2. Name one: a folder with a rogen.json."
		);
		expect(await fs.exists(abs("places/lobby/default.project.json"))).toBe(
			false
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should not upload when the project files have errors", async () => {
		const { running } = start(
			new MockConfigService([
				brokenEntry([
					errorDiagnostic(
						"config.invalidSyntax",
						{ resource: abs("rogen.json") },
						"bad"
					),
				]),
			])
		);

		const result = await running;

		expect(result.isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should show what Rojo said", async () => {
		const { log, running } = start(new MockConfigService([buildable()]));
		const [rojo] = await spawnedCount(1);
		rojo.print("Uploaded to asset 123\n[WARN rojo] odd file\n");
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.lines).toContain("print: Uploaded to asset 123");
		expect(log.texts("warn")).toContain("Rojo: odd file");
	});

	it("should leave stdout to Rojo's lines, unless it prints a document", async () => {
		const printed = start(new MockConfigService([buildable()]));
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });
		await printed.running;
		expect(printed.log.reserved).toBe(true);

		const json = start(new MockConfigService([buildable()]), {
			asset_id: "123",
			json: true,
		});
		const [, second] = await spawnedCount(2);
		second.exit({ code: 0, signal: null });
		await json.running;
		expect(json.log.reserved).toBe(false);
	});

	it("should report the failure when Rojo fails", async () => {
		const { running } = start(new MockConfigService([buildable()]));
		const [rojo] = await spawnedCount(1);
		rojo.print("[ERROR rojo] --universe_id must be provided\n");
		rojo.exit({ code: 1, signal: null });

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"'rojo upload' failed (exit code 1): --universe_id must be provided"
		);
	});

	it("should print one document with --json, without the credentials", async () => {
		const { log, running } = start(new MockConfigService([buildable()]), {
			asset_id: "123",
			api_key: "secret",
			json: true,
		});
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.json()).toMatchObject({
			changed: true,
			rojo: {
				command: "upload",
				outcome: "built",
				project: abs("default.project.json"),
			},
		});
		expect(JSON.stringify(log.json())).not.toContain("secret");
	});
});
