import path from "path";
import "../sourcemap-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import {
	MockConfigService,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("sourcemap command", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const validEntry = (folder = "", overrides = {}) =>
		mockEntry(
			{
				name: folder || "repo",
				sourcePaths: [abs(folder, "src")],
				routes: { "*": "ReplicatedStorage" },
				...overrides,
			},
			abs(folder, "default.rogen.json")
		);

	const start = (
		config: MockConfigService,
		options: CommandLine["options"] = {},
		positionals: string[] = []
	) => {
		const log = new MockLogService();
		const running = commandHarness({
			fs,
			log,
			config,
			processes,
		}).run("sourcemap", { positionals, options });
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

	it("should leave stdout to the sourcemap and Rojo's lines", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
		});
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.reserved).toBe(true);
	});

	it("should print the line Rojo prints about the file it wrote on stdout, as Rojo does", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
		});
		const [rojo] = await spawnedCount(1);
		rojo.print("Created sourcemap at map.json\n");
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.texts("print")).toEqual(["Created sourcemap at map.json"]);
	});

	it("should print what Rojo writes to a file of its own, and nothing else on stdout", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]));
		const [rojo] = await spawnedCount(1);
		const output = rojo.args[rojo.args.indexOf("--output") + 1];
		await fs.writeFile(output, '{"name":"repo"}\n');
		rojo.print(`Created sourcemap at ${output}\n`);
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(rojo.args.slice(0, 2)).toEqual([
			"sourcemap",
			"default.project.json",
		]);
		expect(log.texts("print")).toEqual(['{"name":"repo"}']);
		expect(log.texts("success")).toEqual([]);
		expect(log.texts("outro")).toEqual([]);
		expect(await fs.exists(output)).toBe(false);
	});

	it("should fail when Rojo succeeds but leaves no sourcemap to print", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]));
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"Failed to read the sourcemap Rojo wrote"
		);
		expect(log.texts("print")).toEqual([]);
	});

	it("should pass -o, --include-non-scripts and --absolute to Rojo", async () => {
		const { running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
			"include-non-scripts": true,
			absolute: true,
		});
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(rojo.args.slice(2)).toEqual([
			"--include-non-scripts",
			"--absolute",
			"--output",
			"map.json",
		]);
		expect(rojo.options.cwd).toBe("/repo");
	});

	it("should say where it wrote the sourcemap and show Rojo's warnings", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
		});
		const [rojo] = await spawnedCount(1);
		rojo.print("Created sourcemap at map.json\n[WARN rojo] odd file\n");
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.texts("success")).toContain("map.json · wrote");
		expect(log.texts("warn")).toContain("Rojo: odd file");
		expect(log.lines).not.toContain(
			"info: Rojo: Created sourcemap at map.json"
		);
	});

	it("should refuse a second project, as Rojo's sourcemap does", async () => {
		const { running } = start(
			new MockConfigService([validEntry("places/lobby")]),
			{},
			["places/lobby", "places/arena"]
		);

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"unexpected argument 'places/arena'"
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should ask for -o when --json would share the screen with the sourcemap", async () => {
		const { running } = start(new MockConfigService([validEntry()]), {
			json: true,
		});

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"leaves no room for --json"
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should report the failure when Rojo fails", async () => {
		const { running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
		});
		const [rojo] = await spawnedCount(1);
		rojo.printError("ERROR: no such folder\n");
		rojo.exit({ code: 1, signal: null });

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"'rojo sourcemap' failed (exit code 1): no such folder"
		);
	});

	it("should print one document with --json and -o", async () => {
		const { log, running } = start(new MockConfigService([validEntry()]), {
			output: "map.json",
			json: true,
		});
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.json()).toMatchObject({
			changed: true,
			rojo: {
				command: "sourcemap",
				output: abs("map.json"),
				outcome: "built",
				project: abs("default.project.json"),
			},
		});
		expect(log.json()).not.toHaveProperty("sourcemaps");
	});
});
