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

	const buildable = () =>
		mockEntry(
			{
				name: "repo",
				sourcePaths: [abs("src")],
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
			},
			abs("rogen.json")
		);

	const start = (
		options: CommandLine["options"] = { input: "game.rbxl" },
		prompt = new MockPromptService([], false)
	) => {
		const log = new MockLogService();
		const running = commandHarness({
			fs,
			log,
			config: new MockConfigService([buildable()]),
			processes,
			prompt,
		}).run("syncback", { positionals: [], options });
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

	it("should refuse to write without -y when it cannot ask", async () => {
		const { running } = start();

		expect(((await running) as ResultError<Error>).error.message).toBe(
			"syncback writes and removes files, and this run can't ask. Pass -y/--non-interactive to write without asking, or --dry-run to list what it would do."
		);
		expect(processes.spawned).toEqual([]);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should list what a dry run would do, and write none of it", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"dry-run": true,
		});
		const [rojo] = await rojoRuns(1);
		rojo.print("Writing src/Combat/Server/Loot.luau\n");
		rojo.print("Removing src/Combat/Server/Hit.luau\n");
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(rojo.args).toEqual([
			"syncback",
			"rogen-syncback.project.json",
			"--input",
			"game.rbxl",
			"--non-interactive",
			"--dry-run",
			"--list",
		]);
		expect(said(log)).toEqual(
			expect.arrayContaining([
				"write  src/Combat/Server/Loot.luau",
				"remove src/Combat/Server/Hit.luau",
				"Syncback would change 2 files (1 to write, 1 to remove).",
			])
		);
		expect(processes.spawned).toHaveLength(1);
		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
	});

	it("should write, in a second run of Rojo, when it is told to", async () => {
		const { running, log } = start({
			input: "game.rbxl",
			"non-interactive": true,
		});
		const [dry] = await rojoRuns(1);
		dry.print("Writing src/Combat/Server/Loot.luau\n");
		dry.exit({ code: 0, signal: null });
		const [, real] = await rojoRuns(2);
		real.print("Writing src/Combat/Server/Loot.luau\n");
		real.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(real.args).not.toContain("--dry-run");
		expect(said(log)).toContain("Syncback wrote 1 change.");
	});

	it("should ask first in a terminal, and write nothing on a no", async () => {
		const { running, log } = start(
			{ input: "game.rbxl" },
			new MockPromptService([false], true)
		);
		const [dry] = await rojoRuns(1);
		dry.print("Removing src/Combat/Server/Hit.luau\n");
		dry.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);

		expect(processes.spawned).toHaveLength(1);
		expect(said(log)).toContain("remove src/Combat/Server/Hit.luau");
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
