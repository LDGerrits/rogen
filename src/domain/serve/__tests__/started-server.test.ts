import { jest } from "@jest/globals";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import {
	MockConfigSelection,
	mockConfig,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { CoreRojoRunner } from "../../runner/core-rojo-runner.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { ServeAddress } from "../serve.js";
import {
	ServePlan,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "../serve-service.js";
import { ServerProbe } from "../server-probe.js";
import { ServerRecords } from "../server-records.js";
import { StartedServer } from "../started-server.js";

const ROJO_URL = "http://127.0.0.1:34872/api/rojo";

describe("StartedServer", () => {
	let fileSystem: MemoryFileSystemService;
	let processes: MockProcessService;
	let requests: MockRequestService;
	let records: ServerRecords;
	let served: ServerReadyEvent[];
	let said: ServerOutputEvent[];
	let stops: ServerExitEvent[];
	let failures: Error[];
	let connections: string[];
	let server: StartedServer;

	const config = mockConfig({ file: "/repo/default.rogen.json" });
	const target: ServeTarget = {
		config,
		project: "repo",
		address: new ServeAddress("127.0.0.1", 34872),
	};
	const plan = new ServePlan(
		new MockConfigSelection(),
		{ file: "/bin/rojo", version: "7.7.1" },
		target,
		["--port", "34872"]
	);

	const start = (built: ResolvedConfig = config) => {
		server = new StartedServer(
			{ ...target, config: built },
			plan,
			new CoreRojoRunner(new CoreToolchainService(fileSystem), processes),
			new ServerProbe(requests),
			records,
			{
				served: (serving) => served.push(serving),
				said: (message) => said.push(message),
				stopped: (stop) => stops.push(stop),
				failed: (error) => failures.push(error),
				connection: (change) =>
					connections.push(
						`${change.opened ? "opened" : "closed"} ${change.clients}`
					),
			}
		);
		return processes.spawned[0];
	};

	beforeEach(() => {
		jest.useFakeTimers();
		fileSystem = new MemoryFileSystemService();
		processes = new MockProcessService();
		requests = new MockRequestService();
		records = new ServerRecords(fileSystem, "/tmp", 4242);
		served = [];
		said = [];
		stops = [];
		failures = [];
		connections = [];
	});

	afterEach(() => {
		server[Symbol.dispose]();
		jest.useRealTimers();
	});

	it("should spawn the server on the project file, in the folder of the selection", () => {
		const child = start();

		expect(child.file).toBe("/bin/rojo");
		expect(child.args).toEqual([
			"serve",
			"default.project.json",
			"--port",
			"34872",
		]);
		expect(child.options).toEqual({
			cwd: "/repo",
			env: { RUST_LOG: expect.any(Function) },
		});
	});

	it("should say when the server answers for its project, and record it", async () => {
		start();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});

		await jest.advanceTimersByTimeAsync(250);

		expect(served).toHaveLength(1);
		expect(served[0].info.project).toBe("repo");
		expect(
			await records.recordOf(target.address, served[0].info)
		).toMatchObject({
			projectFile: "/repo/default.project.json",
		});
		await server.unrecord();
		expect(
			await records.recordOf(target.address, served[0].info)
		).toBeUndefined();
	});

	describe("as Studio plugins connect", () => {
		const websocket = (what: string) =>
			`[DEBUG librojo::web::api] WebSocket subscription ${what}\n`;
		const answer = async () => {
			requests.answer(ROJO_URL, {
				projectName: "repo",
				serverVersion: "7.7.1",
				sessionId: "s1",
			});
			await jest.advanceTimersByTimeAsync(250);
		};

		it("should count the connections it is told of, and tell its listener each one", async () => {
			const child = start();
			await answer();

			child.print(websocket("established for session s1"));
			child.print(websocket("established for session s1"));
			child.print(websocket("closed by client"));
			await jest.advanceTimersByTimeAsync(100);

			expect(connections).toEqual(["opened 1", "opened 2", "closed 1"]);
		});

		it("should not count below none", async () => {
			const child = start();
			await answer();

			child.print(websocket("closed by client"));
			await jest.advanceTimersByTimeAsync(100);

			expect(connections).toEqual(["closed 0"]);
		});

		it("should count a plugin that connected before it was seen to answer", async () => {
			const child = start();
			child.print(websocket("established for session s1"));
			await jest.advanceTimersByTimeAsync(100);

			await answer();

			expect(connections).toEqual(["opened 1"]);
		});

		it("should tell nothing of connections that end because it is stopping", async () => {
			const child = start();
			await answer();

			await server.terminate();
			child.print(websocket("closed by client"));
			await jest.advanceTimersByTimeAsync(100);

			expect(connections).toEqual([]);
		});

		it("should not write its record for a connection after it was told to stop", async () => {
			const child = start();
			await answer();
			const write = jest.spyOn(records, "write");

			await server.terminate();
			child.print(websocket("closed by client"));
			await jest.advanceTimersByTimeAsync(100);

			expect(write).not.toHaveBeenCalled();
		});
	});

	it("should report a failure to write its record, and still say it serves", async () => {
		jest.spyOn(records, "write").mockRejectedValue(new Error("disk full"));
		start();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
		});

		await jest.advanceTimersByTimeAsync(250);

		expect(served).toHaveLength(1);
		expect(failures.map((error) => error.message)).toEqual(["disk full"]);
	});

	it("should keep asking while it answers for another project", async () => {
		start();
		requests.answer(ROJO_URL, {
			projectName: "other",
			serverVersion: "7.7.1",
		});

		await jest.advanceTimersByTimeAsync(2_000);

		expect(served).toEqual([]);
		expect(requests.requested.length).toBeGreaterThan(2);
	});

	it("should ask again after 200ms, then at doubling gaps up to one second", async () => {
		start();
		const askedAfter = async (ms: number) => {
			await jest.advanceTimersByTimeAsync(ms);
			return requests.requested.filter((url) => url === ROJO_URL).length;
		};

		expect(await askedAfter(199)).toBe(0);
		expect(await askedAfter(1)).toBe(1);
		expect(await askedAfter(399)).toBe(1);
		expect(await askedAfter(1)).toBe(2);
		expect(await askedAfter(799)).toBe(2);
		expect(await askedAfter(1)).toBe(3);
		expect(await askedAfter(999)).toBe(3);
		expect(await askedAfter(1)).toBe(4);
		expect(await askedAfter(999)).toBe(4);
		expect(await askedAfter(1)).toBe(5);
	});

	it("should say once, after ten seconds, that the server has not answered", async () => {
		start();

		await jest.advanceTimersByTimeAsync(9_000);
		expect(said).toEqual([]);
		await jest.advanceTimersByTimeAsync(30_000);

		expect(said).toEqual([
			{
				target,
				message: {
					severity: "warning",
					text: "Rojo hasn't answered on port 34872 yet; still waiting.",
				},
			},
		]);
		expect(requests.requested.length).toBeGreaterThan(20);
	});

	it("should say what else answers on the port when it is not the server for the project", async () => {
		start();
		requests.answer(ROJO_URL, {
			projectName: "other",
			serverVersion: "7.7.1",
		});

		await jest.advanceTimersByTimeAsync(12_000);

		expect(said).toHaveLength(1);
		expect(said[0].message.text).toContain(
			"port 34872 is answered by something other than Rojo"
		);
	});

	it("should not warn once the server answers", async () => {
		start();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
		});

		await jest.advanceTimersByTimeAsync(20_000);

		expect(said).toEqual([]);
	});

	it("should pass on what the server says", async () => {
		const child = start();

		child.print("[ERROR rojo] it broke\n");
		await jest.advanceTimersByTimeAsync(60);

		expect(said).toEqual([
			{
				target,
				message: { severity: "error", text: "it broke" },
			},
		]);
	});

	it("should stop with the server's code and why when it exits on its own", () => {
		const child = start();
		child.print("[ERROR rojo] it broke\n");

		child.exit({ code: 3, signal: null });

		expect(stops).toHaveLength(1);
		expect(stops[0]).toMatchObject({
			interrupted: false,
			failure: {
				code: "serve.serverExited",
				message:
					"Rojo stopped serving repo with exit code 3; see what it said above.",
			},
		});
	});

	it("should say it stopped without saying why when it printed nothing", () => {
		start().exit({ code: 1, signal: null });

		expect(stops[0].failure?.message).toContain("without saying why");
	});

	it("should stop without a failure when Ctrl+C ended it", () => {
		start().exit({ code: 130, signal: null, interrupted: true });

		expect(stops).toHaveLength(1);
		expect(stops[0]).toMatchObject({ interrupted: true });
		expect(stops[0].failure).toBeUndefined();
	});

	it("should name the signal when a signal ended it", () => {
		start().exit({ code: null, signal: "SIGKILL" });

		expect(stops[0]).toMatchObject({
			failure: {
				message: expect.stringContaining(
					"stopped serving repo with signal SIGKILL"
				),
			},
		});
	});

	it("should stop without a failure when it exits cleanly on its own", () => {
		start().exit({ code: 0, signal: null });

		expect(stops).toHaveLength(1);
		expect(stops[0]).toMatchObject({ interrupted: false });
		expect(stops[0].failure).toBeUndefined();
	});

	it("should fail when a signal from someone else ended it", () => {
		start().exit({ code: null, signal: "SIGTERM" });

		expect(stops[0]).toMatchObject({
			interrupted: false,
			failure: { code: "serve.serverExited" },
		});
	});

	it("should show a Windows status code in hex", () => {
		start().exit({ code: 0xc0000005, signal: null });

		expect(stops[0].failure?.message).toContain("exit code 0xC0000005");
	});

	it("should fail when it couldn't start", () => {
		start().exit({
			code: null,
			signal: null,
			error: new Error("spawn rojo ENOENT"),
		});

		expect(stops[0]).toMatchObject({
			failure: {
				message: "Rojo couldn't start to serve repo: spawn rojo ENOENT",
			},
		});
	});

	it("should report no stop for a server it was told to terminate", async () => {
		const child = start();

		await server.terminate();

		expect(child.terminated).toBe(true);
		expect(stops).toEqual([]);
	});

	it("should stop asking its port once it is terminated", async () => {
		start();
		await server.terminate();

		await jest.advanceTimersByTimeAsync(3_000);

		expect(requests.requested).toEqual([]);
	});
});
