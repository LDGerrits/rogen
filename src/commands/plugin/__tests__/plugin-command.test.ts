import "../plugin-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

describe("plugin command", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const start = (...positionals: string[]) => {
		const log = new MockLogService();
		const running = commandHarness({ fs, log, processes }).run("plugin", {
			positionals,
			options: {},
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

	it.each(["install", "uninstall"])(
		"should run Rojo's plugin %s, and show what it said",
		async (action) => {
			const { log, running } = start(action);
			const [rojo] = await spawnedCount(1);
			rojo.print("Done\n");
			rojo.exit({ code: 0, signal: null });

			expect((await running).isOk()).toBe(true);
			expect(rojo.args).toEqual(["plugin", action]);
			expect(rojo.options.cwd).toBe("/repo");
			expect(log.lines).toContain("info: Rojo: Done");
		}
	);

	it.each([[[]], [["update"]], [["install", "extra"]]])(
		"should say what it takes when given %j",
		async (positionals) => {
			const { running } = start(...positionals);

			expect(((await running) as ResultError<Error>).error.message).toBe(
				"'rogen plugin' takes install or uninstall."
			);
			expect(processes.spawned).toEqual([]);
		}
	);

	it("should report the failure when Rojo fails", async () => {
		const { running } = start("install");
		const [rojo] = await spawnedCount(1);
		rojo.print("[ERROR rojo] Your platform is not currently supported\n");
		rojo.exit({ code: 1, signal: null });

		expect(((await running) as ResultError<Error>).error.message).toContain(
			"'rojo plugin install' failed (exit code 1): Your platform is not currently supported"
		);
	});

	it("should fail when no Rojo is found", async () => {
		processes.installed.clear();

		const { running } = start("install");

		expect((await running).isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});
});
