import { jest } from "@jest/globals";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import {
	MockConfigSelection,
	mockConfig,
} from "../../config/__tests__/mock-config-service.js";
import { ServeAddress, SyncServer } from "../serve.js";
import {
	ServePlan,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "../serve-service.js";
import { ServerProbe } from "../server-probe.js";
import { ServerRecords } from "../server-record.js";
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
	let server: StartedServer;

	const config = mockConfig({
		file: "/repo/default.rogen.json",
		outFile: "/repo/default.project.json",
	});
	const target: ServeTarget = {
		config,
		project: "repo",
		address: new ServeAddress("127.0.0.1", 34872),
	};
	const plan = new ServePlan(
		new MockConfigSelection(),
		{ server: SyncServer.ROJO, file: "/bin/rojo", version: "7.7.1" },
		[target],
		["--port", "34872"]
	);

	const start = () => {
		server = new StartedServer(
			target,
			plan,
			processes,
			new ServerProbe(requests),
			records,
			{
				served: (serving) => served.push(serving),
				said: (message) => said.push(message),
				stopped: (stop) => stops.push(stop),
				failed: (error) => failures.push(error),
			}
		);
		return processes.spawned[0];
	};

	beforeEach(() => {
		jest.useFakeTimers();
		fileSystem = new MemoryFileSystemService();
		processes = new MockProcessService();
		requests = new MockRequestService();
		records = new ServerRecords(fileSystem, "/tmp");
		served = [];
		said = [];
		stops = [];
		failures = [];
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
		expect(child.options).toEqual({ cwd: "/repo" });
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
			await records.read(target.address, served[0].info)
		).toBeDefined();
		await server.unrecord();
		expect(
			await records.read(target.address, served[0].info)
		).toBeUndefined();
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
			exitCode: 3,
			failure: {
				code: "serve.serverExited",
				message:
					"Rojo stopped serving default with exit code 3; see what it said above.",
			},
		});
	});

	it("should say it stopped without saying why when it printed nothing", () => {
		start().exit({ code: 1, signal: null });

		expect(stops[0].failure?.message).toContain("without saying why");
	});

	it("should stop without a failure when Ctrl+C ended it", () => {
		start().exit({ code: 130, signal: null });

		expect(stops).toHaveLength(1);
		expect(stops[0]).toMatchObject({ interrupted: true });
		expect(stops[0].failure).toBeUndefined();
		expect(stops[0].exitCode).toBeUndefined();
	});

	it("should name the signal when a signal ended it", () => {
		start().exit({ code: null, signal: "SIGKILL" });

		expect(stops[0]).toMatchObject({
			exitCode: 1,
			failure: {
				message: expect.stringContaining(
					"stopped serving default with signal SIGKILL"
				),
			},
		});
	});

	it("should stop without a failure when it exits cleanly on its own", () => {
		start().exit({ code: 0, signal: null });

		expect(stops).toHaveLength(1);
		expect(stops[0]).toMatchObject({ interrupted: false });
		expect(stops[0].failure).toBeUndefined();
		expect(stops[0].exitCode).toBeUndefined();
	});

	it.each([
		{ code: 143, signal: null },
		{ code: 0xc000013a, signal: null },
		{ code: null, signal: "SIGINT" },
		{ code: null, signal: "SIGTERM" },
	] as const)("should count %j as an interruption", (exit) => {
		start().exit(exit);

		expect(stops[0]).toMatchObject({ interrupted: true });
		expect(stops[0].failure).toBeUndefined();
	});

	it("should show a Windows status code in hex", () => {
		start().exit({ code: 0xc0000005, signal: null });

		expect(stops[0].failure?.message).toContain("exit code 0xC0000005");
		expect(stops[0].exitCode).toBe(0xc0000005);
	});

	it("should fail with exit code 1 when it couldn't start", () => {
		start().exit({
			code: null,
			signal: null,
			error: new Error("spawn rojo ENOENT"),
		});

		expect(stops[0]).toMatchObject({
			exitCode: 1,
			failure: {
				message:
					"Rojo couldn't start to serve default: spawn rojo ENOENT",
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
