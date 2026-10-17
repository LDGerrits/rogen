import { LogLevel } from "../../../platform/log/log-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreRojoRunner } from "../core-rojo-runner.js";
import { ServerExecutable } from "../rojo-runner.js";
import { ServerMessage, SyncServer } from "../sync-server.js";

describe("CoreRojoRunner", () => {
	let processes: MockProcessService;
	let runner: CoreRojoRunner;

	const executable: ServerExecutable = {
		server: SyncServer.ROJO,
		file: "/bin/rojo",
		version: "7.7.1",
	};

	beforeEach(() => {
		processes = new MockProcessService();
		runner = new CoreRojoRunner(
			new CoreToolchainService(new MemoryFileSystemService()),
			processes
		);
	});

	describe("start", () => {
		it("should run the command on the project file, with the flags last", () => {
			runner.start(
				executable,
				"serve",
				"lobby.project.json",
				["--port", "1"],
				"/repo"
			);

			expect(processes.spawned[0].file).toBe("/bin/rojo");
			expect(processes.spawned[0].args).toEqual([
				"serve",
				"lobby.project.json",
				"--port",
				"1",
			]);
			expect(processes.spawned[0].options.cwd).toBe("/repo");
		});

		it.each([
			[LogLevel.Info, []],
			[LogLevel.Debug, ["-v"]],
			[LogLevel.Trace, ["-vv"]],
		])(
			"should pass Rogen's log level %s on to Rojo as %j",
			(level, flags) => {
				runner = new CoreRojoRunner(
					new CoreToolchainService(new MemoryFileSystemService()),
					processes,
					level
				);

				runner.start(
					executable,
					"build",
					"a.json",
					["-o", "x"],
					"/repo"
				);

				expect(processes.spawned[0].args).toEqual([
					"build",
					"a.json",
					...flags,
					"-o",
					"x",
				]);
			}
		);

		it("should run the command with the flags alone when it has no project file", () => {
			runner.start(executable, "plugin", undefined, ["install"], "/repo");

			expect(processes.spawned[0].args).toEqual(["plugin", "install"]);
		});

		it("should read what it prints into messages", () => {
			const said: ServerMessage[] = [];
			const rojo = runner.start(
				executable,
				"serve",
				"a.json",
				[],
				"/repo"
			);
			rojo.onDidMessage((message) => said.push(message));

			processes.spawned[0].printError("error: no such project\n");
			processes.spawned[0].exit({ code: 1, signal: null });

			expect(said).toEqual([
				{ severity: "error", text: "no such project" },
			]);
		});

		it("should tell when it exits, after the messages it left unsaid", () => {
			const events: string[] = [];
			const rojo = runner.start(
				executable,
				"serve",
				"a.json",
				[],
				"/repo"
			);
			rojo.onDidMessage(({ text }) => events.push(text));
			rojo.onDidExit(({ code }) => events.push(`exit ${code}`));

			processes.spawned[0].printError("error: no such project\n");
			processes.spawned[0].exit({ code: 1, signal: null });

			expect(events).toEqual(["no such project", "exit 1"]);
		});

		it("should end the process when told to", async () => {
			const rojo = runner.start(
				executable,
				"serve",
				"a.json",
				[],
				"/repo"
			);

			await rojo.terminate();

			expect(processes.spawned[0].terminated).toBe(true);
		});
	});
});
