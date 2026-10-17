import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServerInfo, SyncServer } from "../../runner/sync-server.js";
import { ServeAddress } from "../serve.js";
import { ServerRecords } from "../server-records.js";

describe("ServerRecords", () => {
	let fs: MemoryFileSystemService;
	let records: ServerRecords;

	const address = new ServeAddress("127.0.0.1", 34872);
	const info: ServerInfo = {
		server: SyncServer.ROJO,
		project: "Game",
		version: "7.7.1",
		session: "s1",
	};
	const built = { projectFile: "/repo/default.project.json" };

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		records = new ServerRecords(fs, "/tmp", 4242);
	});

	describe("recordOf", () => {
		it("should give back what a serve recorded for the server that answers", async () => {
			await records.write(address, info, built);

			expect(await records.recordOf(address, info)).toEqual({
				host: "127.0.0.1",
				port: 34872,
				server: "rojo",
				project: "Game",
				session: "s1",
				owner: 4242,
				...built,
			});
		});

		it("should record which serve wrote it and the process that leads the server", async () => {
			await records.write(address, info, { ...built, pid: 1001 });

			expect(await records.recordOf(address, info)).toEqual(
				expect.objectContaining({ owner: 4242, pid: 1001 })
			);
		});

		it.each([
			["another session", { ...info, session: "s2" }],
			["another project", { ...info, project: "Other" }],
		])("should give nothing for %s", async (_, answering) => {
			await records.write(address, info, built);

			expect(await records.recordOf(address, answering)).toBeUndefined();
		});

		it("should give nothing for a record it can't read", async () => {
			await fs.writeFile("/tmp/rogen-serve/34872.json", "{");

			expect(await records.recordOf(address, info)).toBeUndefined();
		});
	});

	describe("all", () => {
		it("should list every record, and skip the ones it can't read", async () => {
			await records.write(address, info, built);
			await records.write(new ServeAddress("127.0.0.1", 34873), info, {
				...built,
				projectFile: "/repo/lobby.project.json",
			});
			await fs.writeFile("/tmp/rogen-serve/34874.json", "{");
			await fs.writeFile("/tmp/rogen-serve/34875.json", '{"port":1}');

			const listed = await records.all();

			expect(listed.map(({ port }) => port).sort()).toEqual([
				34872, 34873,
			]);
		});

		it("should list nothing when no serve ever recorded one", async () => {
			expect(await records.all()).toEqual([]);
		});
	});

	describe("remove", () => {
		it("should forget a record", async () => {
			await records.write(address, info, built);

			await records.remove(address);

			expect(await records.all()).toEqual([]);
		});
	});
});
