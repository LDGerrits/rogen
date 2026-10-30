import "../plugin-command.js";
import "../../help/help-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

describe("plugin command", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const start = (positionals: string[], options: { json?: boolean } = {}) => {
		const log = new MockLogService();
		const running = commandHarness({ fs, log, processes }).run("plugin", {
			positionals,
			options,
		});
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
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.7.1\n",
			stderr: "",
		});
	});

	it.each([
		["install", "Installed Rojo's plugin."],
		["uninstall", "Removed Rojo's plugin."],
	])(
		"should run Rojo's plugin %s, show what it said, and say in one line what it did",
		async (action, said) => {
			const { log, running } = start([action]);
			const [rojo] = await spawnedCount(1);
			rojo.print("Done\n");
			rojo.exit({ code: 0, signal: null });

			expect((await running).isOk()).toBe(true);
			expect(rojo.args).toEqual(["plugin", action]);
			expect(rojo.options.cwd).toBe("/repo");
			expect(log.lines).toEqual(["info: Rojo: Done", `success: ${said}`]);
		}
	);

	it.each([[[]], [["update"]], [["install", "extra"]]])(
		"should say what it takes when given %j",
		async (positionals) => {
			const { running } = start(positionals);

			expect(((await running) as ResultError<Error>).error.message).toBe(
				"'rogen plugin' takes install, uninstall or help."
			);
			expect(processes.spawned).toEqual([]);
		}
	);

	it.each([[["help"]], [["help", "install"]], [["help", "uninstall"]]])(
		"should print its own help for %j, without running Rojo",
		async (positionals) => {
			const { log, running } = start(positionals);

			expect((await running).isOk()).toBe(true);
			expect(log.texts("print").join("\n")).toContain(
				"Installs or removes Rojo's Studio plugin"
			);
			expect(processes.spawned).toEqual([]);
		}
	);

	it("should print one JSON document with --json, and Rojo's lines in it", async () => {
		const { log, running } = start(["install"], { json: true });
		const [rojo] = await spawnedCount(1);
		rojo.print("Done\n");
		rojo.exit({ code: 0, signal: null });

		expect((await running).isOk()).toBe(true);
		expect(log.texts("print").map((text) => JSON.parse(text))).toEqual([
			{
				action: "install",
				outcome: "done",
				messages: [{ severity: "info", text: "Done" }],
			},
		]);
		expect(log.reserved).toBe(false);
	});

	it("should print the failure as the JSON document of an error with --json", async () => {
		const { log, running } = start(["install"], { json: true });
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 1, signal: null });

		expect((await running).isErr()).toBe(true);
		expect(log.texts("print").map((text) => JSON.parse(text))).toEqual([
			{
				action: "install",
				outcome: "failed",
				messages: [],
				error: expect.objectContaining({ kind: "tool" }),
			},
		]);
	});

	it("should print its lines on stdout, as Rojo does", async () => {
		const { log, running } = start(["install"]);
		const [rojo] = await spawnedCount(1);
		rojo.exit({ code: 0, signal: null });
		await running;

		expect(log.reserved).toBe(false);
	});

	it("should report the failure when Rojo fails", async () => {
		const { running } = start(["install"]);
		const [rojo] = await spawnedCount(1);
		rojo.print("[ERROR rojo] Your platform is not currently supported\n");
		rojo.exit({ code: 1, signal: null });

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"Rojo couldn't run 'rojo plugin install':\n  Your platform is not currently supported"
		);
	});

	it("should fail when no Rojo is found", async () => {
		processes.installed.clear();

		const { running } = start(["install"]);

		expect((await running).isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});
});
