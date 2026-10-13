import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { ServedProjectFiles } from "../served-project-files.js";
import { ServerProbe } from "../server-probe.js";
import { ServerRecords } from "../server-records.js";
import { recordFile } from "./record-fixtures.js";

const ROJO_URL = "http://127.0.0.1:34872/api/rojo";

describe("ServedProjectFiles", () => {
	let fs: MemoryFileSystemService;
	let requests: MockRequestService;
	let files: ServedProjectFiles;

	const record = (projectFile = "/repo/default.project.json") =>
		fs.writeFile(...recordFile(34872, "repo", projectFile));

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
			new ServerRecords(fs, "/mock/tmp"),
			new ServerProbe(requests)
		);
	});

	describe("serving", () => {
		it("should give the record of the running serve that serves each file", async () => {
			await record();
			answer();

			const found = await files.serving([
				"/repo/default.project.json",
				"/repo/lobby.project.json",
			]);

			expect([...found.keys()]).toEqual(["/repo/default.project.json"]);
			expect(found.get("/repo/default.project.json")).toMatchObject({
				port: 34872,
			});
		});

		it("should give nothing for a serve that no longer runs", async () => {
			await record();

			expect(
				(await files.serving(["/repo/default.project.json"])).size
			).toBe(0);
		});

		it("should give nothing when another server has taken the port since", async () => {
			await record();
			answer("s2");

			expect(
				(await files.serving(["/repo/default.project.json"])).size
			).toBe(0);
		});

		it("should give nothing for a file no serve serves", async () => {
			await record("/repo/other.project.json");
			answer();

			expect(
				(await files.serving(["/repo/default.project.json"])).size
			).toBe(0);
		});
	});
});
