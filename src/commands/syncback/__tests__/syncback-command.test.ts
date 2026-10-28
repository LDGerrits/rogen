import path from "path";
import "../syncback-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import {
	MockConfigService,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("syncback command", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const validEntry = () =>
		mockEntry(
			{
				name: "repo",
				sourcePaths: [abs("src")],
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
			},
			abs("default.rogen.json")
		);

	const start = (
		options: CommandLine["options"] = { input: "game.rbxl" },
		prompt = new MockPromptService([], false),
		positionals: string[] = []
	) => {
		const log = new MockLogService();
		const running = commandHarness({
			fs,
			log,
			config: new MockConfigService([validEntry()]),
			processes,
			prompt,
		}).run("syncback", { positionals, options });
		return { log, running };
	};

	const rojoRuns = async (count: number) => {
		for (let i = 0; i < 100 && processes.spawned.length < count; i++)
			await new Promise((resolve) => setImmediate(resolve));
		return processes.spawned;
	};

	const said = (log: MockLogService) => log.entries.map(({ text }) => text);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		await fs.writeFile(abs("src/Combat/Server/Combat.luau"), "");
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.7.1\n",
			stderr: "",
		});
	});

	it("should ask for --input before it writes anything", async () => {
		const { running } = start({});

		expect(((await running) as ResultError<Error>).error.message).toBe(
			"--input names the place or model file to bring changes from, and Rojo needs it."
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it.each(["a.rbxl", "dir/a.RBXLX", "a.rbxm", "a.rbxmx"])(
		"should say to pass the place file %s as --input when it is given as the project",
		async (file) => {
			const { running } = start({}, undefined, [file]);

			expect(((await running) as ResultError<Error>).error.message).toBe(
				`--input names the place or model file to bring changes from, and Rojo needs it. '${file}' is a place or model file, not a project: pass it as --input ${file}.`
			);
		}
	);

	it("should refuse a second project, as Rojo's syncback does, and run nothing", async () => {
		const { running } = start(
			{ input: "game.rbxl", "non-interactive": true },
			undefined,
			["a", "b"]
		);

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"unexpected argument 'b' found: syncback takes one [PROJECT]"
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should refuse to write without -y when it cannot ask", async () => {
		const { running } = start();

		expect(((await running) as ResultError<Error>).error.message).toBe(
			"syncback writes and removes files, and this run can't ask. Pass -y/--non-interactive to write without asking, or --dry-run to list what it would do."
		);
		expect(processes.spawned).toEqual([]);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should run on a project with a compiled path, and list the compiled code it leaves out", async () => {
		await fs.writeFile(abs("dist/Combat/Server/Combat.luau"), "");
		const log = new MockLogService();
		const running = commandHarness({
			fs,
			log,
			config: new MockConfigService([
				mockEntry(
					{
						name: "repo",
						sourcePaths: [abs("src")],
						routes: { Server: "ServerScriptService" },
						compiledPath: abs("dist"),
					},
					abs("default.rogen.json")
				),
			]),
			processes,
			prompt: new MockPromptService([], false),
		}).run("syncback", {
			positionals: [],
			options: { input: "game.rbxl", "non-interactive": true },
		});
		const [rojo] = await rojoRuns(1);
		await fs.delete(
			abs(".rogen-syncback/mirror/ServerScriptService/Combat/Combat.luau")
		);
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(said(log).filter((text) => text.includes("(syncback."))).toEqual(
			[
				"/repo/default.rogen.json - warning: ServerScriptService/Combat/Combat was removed from the place, but it is compiled into dist, so syncback left it out. Remove it from the source files. (syncback.compiledPath)",
			]
		);
		expect(await fs.exists(abs("dist/Combat/Server/Combat.luau"))).toBe(
			true
		);
	});

	/** What the test's Rojo does to the mirror it runs on: Loot added, Combat removed. */
	const editMirror = async () => {
		await fs.writeFile(
			abs(".rogen-syncback/mirror/ServerScriptService/Combat/Loot.luau"),
			"return 1"
		);
		await fs.delete(
			abs(".rogen-syncback/mirror/ServerScriptService/Combat/Combat.luau")
		);
	};

	it("should list what a dry run would do, and write none of it", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"dry-run": true,
		});
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(rojo.args).toEqual([
			"syncback",
			"rogen-syncback.project.json",
			"--input",
			"game.rbxl",
			"--non-interactive",
			"--list",
		]);
		expect(said(log)).toEqual(
			expect.arrayContaining([
				"Writing src/Combat/Server/Loot.luau",
				"Removing src/Combat/Server/Combat.luau",
				"Syncback would change 2 files (1 to write, 1 to remove).",
			])
		);
		expect(await fs.exists(abs("src/Combat/Server/Combat.luau"))).toBe(
			true
		);
		expect(await fs.exists(abs("src/Combat/Server/Loot.luau"))).toBe(false);
		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
	});

	it("should say wouldWrite for the config and the syncback of a dry run, by the config file", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"dry-run": true,
			json: true,
		});
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });
		await running;

		const document = log.json();
		expect(document.configs).toEqual([
			{
				config: "default.rogen.json",
				projectFile: abs("default.project.json"),
				outcome: "wouldWrite",
				diagnostics: [],
			},
		]);
		expect(document.syncback).toMatchObject({
			outcome: "wouldWrite",
			config: "default.rogen.json",
		});
		expect(document.syncback).not.toHaveProperty("project");
		expect(document.changed).toBe(false);
	});

	it("should write no project file in a dry run, and leave a stale one as it was", async () => {
		const first = start({ input: "game.rbxl", "dry-run": true });
		const [rojo] = await rojoRuns(1);
		rojo.exit({ code: 0, signal: null });
		await first.running;
		expect(await fs.exists(abs("default.project.json"))).toBe(false);

		await fs.writeFile(abs("default.project.json"), "{}\n");
		processes.spawned.length = 0;
		const second = start({ input: "game.rbxl", "dry-run": true });
		const [again] = await rojoRuns(1);
		again.exit({ code: 0, signal: null });
		await second.running;

		expect(await fs.readFile(abs("default.project.json"))).toBe("{}\n");
	});

	it("should write, in one run of Rojo, when it is told to", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"non-interactive": true,
		});
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(processes.spawned).toHaveLength(1);
		expect(await fs.readFile(abs("src/Combat/Server/Loot.luau"))).toBe(
			"return 1"
		);
		expect(said(log)).toContain("Syncback wrote 2 changes.");
	});

	it("should print the list on stdout, where Rojo prints it, and the rest on stderr", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"dry-run": true,
		});
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.reserved).toBe(true);
		expect(log.texts("print")).toEqual([
			"Removing src/Combat/Server/Combat.luau",
			"Writing src/Combat/Server/Loot.luau",
		]);
	});

	it("should run Rojo once, ask, and write what it listed, in a terminal", async () => {
		const { running, log } = start(
			{ input: "game.rbxl" },
			new MockPromptService([true], true)
		);
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(processes.spawned).toHaveLength(1);
		expect(
			said(log).filter(
				(line) => line === "Writing src/Combat/Server/Loot.luau"
			)
		).toHaveLength(1);
		expect(said(log)).toContain("Syncback wrote 2 changes.");
		expect(await fs.exists(abs("src/Combat/Server/Combat.luau"))).toBe(
			false
		);
	});

	it("should warn about the compiled code it leaves out before it asks, and only then", async () => {
		await fs.writeFile(abs("dist/Combat/Server/Combat.luau"), "");
		await fs.writeFile(abs("Packages/Lib.luau"), "");
		const log = new MockLogService();
		const warning = (text: string) =>
			text.includes("(syncback.compiledPath)");
		let warnedBeforeAsking = false;
		const prompt = new MockPromptService([true], true);
		const confirm = prompt.confirm.bind(prompt);
		prompt.confirm = async (options) => {
			warnedBeforeAsking = said(log).some(warning);
			return confirm(options);
		};
		const running = commandHarness({
			fs,
			log,
			config: new MockConfigService([
				mockEntry(
					{
						name: "repo",
						sourcePaths: [abs("src")],
						routes: { Server: "ServerScriptService" },
						compiledPath: abs("dist"),
						project: {
							tree: {
								$className: "DataModel",
								ReplicatedStorage: {
									Packages: { $path: "Packages" },
								},
							},
						},
					},
					abs("default.rogen.json")
				),
			]),
			processes,
			prompt,
		}).run("syncback", {
			positionals: [],
			options: { input: "game.rbxl" },
		});
		const [rojo] = await rojoRuns(1);
		await fs.writeFile(
			abs(".rogen-syncback/mirror/ReplicatedStorage/Packages/Lib.luau"),
			"return 2"
		);
		await fs.delete(
			abs(".rogen-syncback/mirror/ServerScriptService/Combat/Combat.luau")
		);
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(warnedBeforeAsking).toBe(true);
		expect(said(log).filter(warning)).toHaveLength(1);
		expect(await fs.readFile(abs("Packages/Lib.luau"))).toBe("return 2");
	});

	it("should ask first in a terminal, and write nothing on a no", async () => {
		const { running, log } = start(
			{ input: "game.rbxl" },
			new MockPromptService([false], true)
		);
		const [rojo] = await rojoRuns(1);
		await editMirror();
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(processes.spawned).toHaveLength(1);
		expect(said(log)).toContain("Removing src/Combat/Server/Combat.luau");
		expect(said(log)).toContain("Nothing was written.");
		expect(await fs.exists(abs("src/Combat/Server/Combat.luau"))).toBe(
			true
		);
	});

	it("should say when a Rojo is too old", async () => {
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.4.4\n",
			stderr: "",
		});
		const { running } = start({ input: "game.rbxl", "dry-run": true });

		const failed = (await running) as ResultError<DiagnosticsError>;

		expect(failed.error.diagnostics).toMatchObject([
			{ code: "rojo.commandUnsupported" },
		]);
	});
});
