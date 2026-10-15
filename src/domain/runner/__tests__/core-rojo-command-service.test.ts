import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import {
	MockConfigSelection,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { NamedProjects } from "../../config/config-service.js";
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

	it("should run on the project file the request names, when it is not the project's own", async () => {
		const running = service.run(selection(), {
			command: "syncback",
			flags: ["--input", "a.rbxl"],
			cwd: "/repo",
			projectFile: "/repo/temporary.project.json",
		});
		await finish([], 0);

		await running;

		expect(processes.spawned[0].args).toEqual([
			"syncback",
			"temporary.project.json",
			"--input",
			"a.rbxl",
		]);
	});

	it("should refuse a Rojo older than the release that has the command, and say which", async () => {
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.6.1\n",
			stderr: "",
		});

		const refused = await service.run(selection(), {
			command: "syncback",
			flags: [],
			cwd: "/repo",
			since: "7.7.0",
		});

		expect(
			(refused as ResultError<DiagnosticsError>).error.diagnostics
		).toMatchObject([
			{
				code: "rojo.commandUnsupported",
				message:
					"Rojo 7.6.1 has no 'syncback' command; Rojo 7.7.0 added it. Change your Rojo pin to 7.7.0 or later, or update the Rojo on the PATH.",
			},
		]);
		expect(processes.spawned).toEqual([]);
	});

	it("should run on the project the selection names", async () => {
		const chosen = new MockConfigSelection(
			[mockEntry({}, "/repo/rogen.json", { release: {} })],
			"/repo",
			new Map([
				["/repo/rogen.json", { names: ["release"], usual: false }],
			])
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

	it("should run on the project the request names when the selection holds several", async () => {
		const chosen = new MockConfigSelection([
			mockEntry({}, "/repo/a/rogen.json"),
			mockEntry({}, "/repo/b/rogen.json"),
		]);
		const [, second] = service.projects(chosen);

		const running = service.run(chosen, {
			command: "sourcemap",
			flags: [],
			cwd: "/repo/b",
			project: second,
		});
		await finish([], 0);

		expect((await running).unwrap().project).toBe(second);
		expect(processes.spawned[0].args).toEqual([
			"sourcemap",
			"default.project.json",
		]);
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

	describe("with places", () => {
		const places = (named = new Map<string, NamedProjects>()) =>
			new MockConfigSelection(
				[
					mockEntry({ hasPlaces: true }, "/repo/rogen.json"),
					mockEntry(
						{ isPlace: true, rootFile: "/repo/rogen.json" },
						"/repo/places/lobby/rogen.json"
					),
					mockEntry(
						{ isPlace: true, rootFile: "/repo/rogen.json" },
						"/repo/places/arena/rogen.json"
					),
				],
				"/repo",
				named
			);

		it("should leave out the root that lists them, which is the sum of them", () => {
			expect(service.projects(places()).map(({ file }) => file)).toEqual([
				"/repo/places/lobby/rogen.json",
				"/repo/places/arena/rogen.json",
			]);
		});

		it("should keep the root when it is named", () => {
			const named = new Map([
				["/repo/rogen.json", { names: ["default"], usual: false }],
			]);

			expect(service.projects(places(named))).toHaveLength(3);
		});

		it("should count the places alone when it says to name one", () => {
			const chosen = service.choose(places(), "upload");

			expect((chosen as ResultError<Error>).error.message).toBe(
				"'rojo upload' runs on one project, and this selects 2. Name one: a folder with a rogen.json, or a project."
			);
		});
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

	describe("runBare", () => {
		const install = () =>
			service.runBare({ args: ["plugin", "install"], cwd: "/repo" });

		it("should run Rojo with the arguments alone, in the folder", async () => {
			const running = install();
			await finish(["Installed Rojo plugin"], 0);

			const ran = (await running).unwrap();

			expect(ran.messages).toEqual([
				{ severity: "info", text: "Installed Rojo plugin" },
			]);
			expect(ran.failure).toBeUndefined();
			expect(processes.spawned[0].file).toBe("/bin/rojo");
			expect(processes.spawned[0].args).toEqual(["plugin", "install"]);
			expect(processes.spawned[0].options.cwd).toBe("/repo");
		});

		it("should return a run with a failure that names no file when Rojo exits with an error", async () => {
			const running = install();
			await finish(["ERROR: no plugins folder"], 1);

			const ran = (await running).unwrap();

			expect(ran.failure?.message).toBe(
				"'rojo plugin install' failed (exit code 1): no plugins folder"
			);
			expect(ran.failure).not.toBeInstanceOf(DiagnosticsError);
		});

		it("should fail without running Rojo when no Rojo is found", async () => {
			processes.installed.clear();

			expect((await install()).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});
	});
});
