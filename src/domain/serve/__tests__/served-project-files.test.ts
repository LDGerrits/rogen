import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { PendingWrite } from "../../build/build.js";
import { ServedProjectFiles } from "../served-project-files.js";
import { ServerProbe } from "../server-probe.js";
import { ServerRecords } from "../server-records.js";
import { recordFile } from "./record-fixtures.js";

const ROJO_URL = "http://127.0.0.1:34872/api/rojo";

describe("ServedProjectFiles", () => {
	let fs: MemoryFileSystemService;
	let requests: MockRequestService;
	let files: ServedProjectFiles;

	const dev = { mode: "dev", variants: { mock: true } };
	const prod = { mode: "prod", variants: { mock: false } };
	const writeOf = (
		setting: PendingWrite["setting"],
		file = "/repo/default.project.json"
	): PendingWrite => ({ file, label: "default", setting });

	const record = (
		setting = dev,
		projectFile = "/repo/default.project.json",
		pid = 200
	) =>
		fs.writeFile(
			...recordFile(34872, "repo", projectFile, { setting, pid })
		);

	const answer = (sessionId = "s1") =>
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId,
		});

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		requests = new MockRequestService();
		files = new ServedProjectFiles(
			new ServerRecords(fs, "/mock/tmp", 100),
			new ServerProbe(requests)
		);
	});

	it("should refuse a write in another setting to a file a running serve serves, and say how to go on", async () => {
		await record();
		answer();

		const refusal = await files.refusalFor(writeOf(prod));

		expect(refusal).toMatchObject({
			code: "output.servedInOtherMode",
			resource: "/repo/default.project.json",
		});
		expect(refusal?.message).toBe(
			"default.project.json is served by a running rogen serve (Rojo at 127.0.0.1:34872) as built in mode dev with mock on, and this build is mode prod, so writing it would change what Studio gets. Build to another file, as 'rogen build default -o <file>', or stop that serve."
		);
	});

	it("should allow a write in the setting the serve built in", async () => {
		await record();
		answer();

		expect(await files.refusalFor(writeOf(dev))).toBeUndefined();
	});

	it("should refuse a write that differs only in a variant", async () => {
		await record();
		answer();

		expect(
			await files.refusalFor(
				writeOf({ mode: "dev", variants: { mock: false } })
			)
		).toMatchObject({ code: "output.servedInOtherMode" });
	});

	it("should allow a write to another file", async () => {
		await record();
		answer();

		expect(
			await files.refusalFor(
				writeOf(prod, "/repo/default.prod.project.json")
			)
		).toBeUndefined();
	});

	it("should allow a write when no serve left a record", async () => {
		expect(await files.refusalFor(writeOf(prod))).toBeUndefined();
	});

	it("should allow a write when the serve that left the record no longer runs", async () => {
		await record();

		expect(await files.refusalFor(writeOf(prod))).toBeUndefined();
	});

	it("should allow a write when another server has taken the port since", async () => {
		await record();
		answer("s2");

		expect(await files.refusalFor(writeOf(prod))).toBeUndefined();
	});

	it("should allow the serve that wrote a record to rebuild its own file in another setting", async () => {
		await record(dev, "/repo/default.project.json", 100);
		answer();

		expect(await files.refusalFor(writeOf(prod))).toBeUndefined();
	});

	describe("serving", () => {
		it("should give the record of the running serve that serves each file, whatever its mode", async () => {
			await record(prod);
			answer();

			const found = await files.serving([
				"/repo/default.project.json",
				"/repo/lobby.project.json",
			]);

			expect([...found.keys()]).toEqual(["/repo/default.project.json"]);
			expect(found.get("/repo/default.project.json")).toMatchObject({
				port: 34872,
				setting: prod,
			});
		});

		it("should give nothing for a serve that no longer runs", async () => {
			await record(dev);

			expect(
				(await files.serving(["/repo/default.project.json"])).size
			).toBe(0);
		});
	});
});
