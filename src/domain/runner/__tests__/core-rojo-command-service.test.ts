import { ResultError } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import {
	MockConfigSelection,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreRojoCommandService } from "../core-rojo-command-service.js";
import { CoreRojoRunner } from "../core-rojo-runner.js";
import { RojoCompatibility } from "../rojo-compatibility.js";

const VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };

describe("CoreRojoCommandService", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;
	let service: CoreRojoCommandService;

	const selection = (...stems: string[]) =>
		new MockConfigSelection([
			mockEntry(
				{},
				"/repo/rogen.json",
				Object.fromEntries(stems.map((stem) => [stem, {}]))
			),
		]);

	const run = (chosen = selection(), flags: string[] = ["-o", "a.rbxl"]) =>
		service.run(chosen, { command: "build", flags, cwd: "/repo" });

	const finish = async (lines: string[], code: number) => {
		await new Promise((resolve) => setImmediate(resolve));
		const [child] = processes.spawned;
		for (const line of lines) child.print(`${line}\n`);
		child.exit({ code, signal: null });
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", VERSION);
		service = new CoreRojoCommandService(
			new CoreRojoRunner(new CoreToolchainService(fs), processes),
			new RojoCompatibility(fs, false)
		);
	});

	it("should run Rojo on the default project, with the flags after its file", async () => {
		const running = run();
		await finish(["Built project to a.rbxl"], 0);

		const ran = (await running).unwrap();

		expect(ran.project.stem).toBe("default");
		expect(ran.messages).toEqual([
			{ severity: "info", text: "Built project to a.rbxl" },
		]);
		const [child] = processes.spawned;
		expect(child.file).toBe("/bin/rojo");
		expect(child.args).toEqual([
			"build",
			"default.project.json",
			"-o",
			"a.rbxl",
		]);
		expect(child.options.cwd).toBe("/repo");
	});

	it("should run on the project the selection names", async () => {
		const chosen = new MockConfigSelection(
			[mockEntry({}, "/repo/rogen.json", { release: {} })],
			"/repo",
			new Map([["/repo/rogen.json", "release"]])
		);
		const running = run(chosen);
		await finish([], 0);

		expect((await running).unwrap().project.stem).toBe("release");
		expect(processes.spawned[0].args[1]).toBe("release.project.json");
	});

	it("should return a run with a failure, and what Rojo said, when it exits with an error", async () => {
		const running = run();
		await finish(["ERROR: could not write a.rbxl"], 1);

		const ran = (await running).unwrap();

		expect(ran.failure?.diagnostics[0]).toMatchObject({
			code: "rojo.commandFailed",
			resource: "/repo/default.project.json",
			message:
				"'rojo build' failed (exit code 1): could not write a.rbxl",
		});
		expect(ran.messages).toEqual([
			{ severity: "error", text: "could not write a.rbxl" },
		]);
	});

	it("should fail when the selection holds several projects", async () => {
		const result = await run(
			new MockConfigSelection([
				mockEntry({}, "/repo/a/rogen.json"),
				mockEntry({}, "/repo/b/rogen.json"),
			])
		);

		expect((result as ResultError<Error>).error.message).toBe(
			"'rojo build' runs on one project, and this selects 2. Name one: a folder with a rogen.json, or a project."
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should fail without running Rojo when no Rojo is found", async () => {
		processes.installed.clear();

		const result = await run();

		expect(result.isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should not start Rojo when the signal has already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await service.run(selection(), {
			command: "build",
			flags: [],
			cwd: "/repo",
			signal: controller.signal,
		});

		expect(result.isOk()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should call a Rojo that something else interrupted a failure", async () => {
		const running = run();
		await new Promise((resolve) => setImmediate(resolve));
		processes.spawned[0].exit({
			code: 130,
			signal: null,
			interrupted: true,
		});

		expect((await running).unwrap().failure).toBeDefined();
	});

	it("should name the one project, or say there is none, before it runs", () => {
		expect(service.choose(selection(), "build").unwrap().stem).toBe(
			"default"
		);
		const none = service.choose(new MockConfigSelection([]), "build");
		expect((none as ResultError<Error>).error.message).toBe(
			"There is no project to run 'rojo build' on."
		);
	});

	it("should end Rojo when the signal aborts", async () => {
		const controller = new AbortController();
		const running = service.run(selection(), {
			command: "build",
			flags: [],
			cwd: "/repo",
			signal: controller.signal,
		});
		await new Promise((resolve) => setImmediate(resolve));

		controller.abort();

		expect((await running).isOk()).toBe(true);
		expect(processes.spawned[0].terminated).toBe(true);
	});
});
