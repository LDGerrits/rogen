import { jest } from "@jest/globals";
import path from "path";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { ToolLocator } from "../../toolchain/tool-locator.js";
import { InitPlan, InitWritten, PlannedCommand } from "../init-service.js";
import { InitWriter } from "../init-writer.js";
import { gitOf } from "./init-of.js";

const directory = path.resolve("/repo");

const planOf = (overrides: Partial<InitPlan> = {}): InitPlan => ({
	directory,
	action: "create",
	summary: [],
	moves: [],
	files: [],
	directories: [],
	commands: [],
	configs: [],
	notes: [],
	warnings: [],
	nextSteps: { setup: [], run: [], edits: [] },
	asked: false,
	decided: [],
	gitInit: false,
	...overrides,
});

const commandOf = (file: string, ...args: string[]): PlannedCommand => ({
	command: [file, ...args].join(" "),
	file,
	args,
	timeout: 1000,
});

describe("InitWriter", () => {
	let fileSystem: MemoryFileSystemService;
	let processes: MockProcessService;
	let lifecycle: MockLifecycleService;
	let writer: InitWriter;
	let written: InitWritten[];

	const locator: ToolLocator = {
		_serviceBrand: undefined,
		find: async (command) => processes.installed.get(command),
	};

	const write = (plan: InitPlan, dryRun = false) =>
		writer.write(plan, (item) => written.push(item), dryRun);

	const install = (file: string, code: number, stdout = "", stderr = "") => {
		processes.installed.set(file, `/bin/${file}`);
		processes.outputs.set(`/bin/${file}`, { code, stdout, stderr });
	};

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(directory);
		processes = new MockProcessService();
		lifecycle = new MockLifecycleService();
		written = [];
		writer = instantiationOf(
			[FileSystemService, fileSystem],
			[ProcessService, processes],
			[ToolLocator, locator],
			[LifecycleService, lifecycle]
		).createInstance(InitWriter, gitOf(processes, fileSystem));
	});

	it("should run each command after the files, and stop at the first that fails, naming those it skips", async () => {
		install("npm", 0);
		install("lune", 1, "", "lune broke\nmore");
		const [npm, lune, last] = [
			commandOf("npm", "install"),
			commandOf("lune", "run"),
			commandOf("npm", "run", "build"),
		];

		(
			await write(
				planOf({
					files: [{ fileName: "a.txt", content: "a" }],
					commands: [npm, lune, last],
				})
			)
		).unwrap();

		expect(written).toEqual([
			{ kind: "file", file: { fileName: "a.txt", content: "a" } },
			{ kind: "command", command: npm },
			{
				kind: "command",
				command: lune,
				failed: "lune broke",
				skipped: [last],
			},
		]);
		expect(processes.execs.map(({ file, cwd }) => [file, cwd])).toEqual([
			["/bin/npm", directory],
			["/bin/lune", directory],
		]);
	});

	it.each([
		["what it printed when it prints no error", "done half\n", "done half"],
		["its exit code when it prints nothing", "", "exit code 2"],
	])("should name as a command's failure %s", async (_, stdout, failed) => {
		install("lune", 2, stdout);
		const lune = commandOf("lune");

		(await write(planOf({ commands: [lune] }))).unwrap();

		expect(written).toEqual([
			{ kind: "command", command: lune, failed, skipped: [] },
		]);
	});

	it("should have git follow a rename that differs only in case, after every change is made", async () => {
		install("git", 0, "100644 aaa 0\tsrc/server/A.luau\0");
		await fileSystem.writeFile(
			path.join(directory, "src/server/A.luau"),
			""
		);
		await fileSystem.writeFile(path.join(directory, "B.luau"), "");

		(
			await write(
				planOf({
					moves: [
						{ from: "src/server", to: "src/Server" },
						{ from: "B.luau", to: "C.luau" },
					],
					files: [{ fileName: "a.txt", content: "a" }],
				})
			)
		).unwrap();

		expect(processes.execs.map(({ args }) => args[0])).toEqual([
			"ls-files",
			"update-index",
			"update-index",
		]);
		expect(processes.execs[0].args).toContain("src/server");
	});

	it("should leave git alone in a dry run", async () => {
		install("git", 0, "100644 aaa 0\tsrc/server/A.luau\0");

		(
			await write(
				planOf({ moves: [{ from: "src/server", to: "src/Server" }] }),
				true
			)
		).unwrap();

		expect(processes.execs).toEqual([]);
	});

	it("should report the commands without running them in a dry run", async () => {
		install("npm", 1);
		const npm = commandOf("npm", "install");

		(await write(planOf({ commands: [npm] }), true)).unwrap();

		expect(written).toEqual([{ kind: "command", command: npm }]);
		expect(processes.execs).toEqual([]);
	});

	it("should stop before it moves anything when shut down while the starter tool runs, and put the folder back", async () => {
		install("npm", 0);
		const exec = processes.exec.bind(processes);
		jest.spyOn(processes, "exec").mockImplementation(
			async (file, args, options) => {
				await fileSystem.writeFile(
					path.join(directory, "package.json"),
					"{}"
				);
				lifecycle.shutdown();
				return exec(file, args, options);
			}
		);
		await fileSystem.writeFile(path.join(directory, "A.luau"), "");

		const result = await write(
			planOf({
				scaffold: { command: commandOf("npm", "create"), replaces: [] },
				moves: [{ from: "A.luau", to: "B.luau" }],
			})
		);

		expect(result.isErr() && result.error.message).toBe(
			"init stopped before it finished, and put the folder back as it was."
		);
		expect(await fileSystem.exists(path.join(directory, "A.luau"))).toBe(
			true
		);
		expect(
			await fileSystem.exists(path.join(directory, "package.json"))
		).toBe(false);
		expect(written).toEqual([]);
	});

	it("should fail before it runs the starter tool when it can't make the folder", async () => {
		install("npm", 0);
		const fresh = path.join(directory, "fresh");
		jest.spyOn(fileSystem, "createDirectory").mockRejectedValue(
			new Error("EACCES")
		);

		const result = await write(
			planOf({
				directory: fresh,
				scaffold: { command: commandOf("npm", "create"), replaces: [] },
			})
		);

		expect(result.isErr() && result.error.message).toBe(
			`Failed to create ${fresh}: EACCES`
		);
		expect(processes.execs).toEqual([]);
	});
});
