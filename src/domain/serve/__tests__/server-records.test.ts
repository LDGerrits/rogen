import { jest } from "@jest/globals";
import { DeferredPromise } from "../../../base/async.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServerInfo } from "../../runner/rojo-server.js";
import { ServeAddress } from "../serve.js";
import { ServerRecords } from "../server-records.js";

describe("ServerRecords", () => {
	let fs: MemoryFileSystemService;
	let records: ServerRecords;

	const address = new ServeAddress("127.0.0.1", 34872);
	const info: ServerInfo = {
		project: "Game",
		version: "7.7.1",
		session: "s1",
	};
	const served = { projectFile: "/repo/default.project.json" };

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		records = new ServerRecords(fs, "/tmp", 4242);
	});

	describe("recordOf", () => {
		it("should give back what a serve recorded for the server that answers", async () => {
			await records.write(address, info, served);

			expect(await records.recordOf(address, info)).toEqual({
				host: "127.0.0.1",
				port: 34872,
				project: "Game",
				session: "s1",
				owner: 4242,
				...served,
			});
		});

		it("should record which serve wrote it and the process that leads the server", async () => {
			await records.write(address, info, { ...served, pid: 1001 });

			expect(await records.recordOf(address, info)).toEqual(
				expect.objectContaining({ owner: 4242, pid: 1001 })
			);
		});

		it.each([
			["another session", { ...info, session: "s2" }],
			["another project", { ...info, project: "Other" }],
		])("should give nothing for %s", async (_, answering) => {
			await records.write(address, info, served);

			expect(await records.recordOf(address, answering)).toBeUndefined();
		});

		it("should give nothing for a record it can't read", async () => {
			await fs.writeFile("/tmp/rogen-serve/34872.json", "{");

			expect(await records.recordOf(address, info)).toBeUndefined();
		});
	});

	describe("recordsFor", () => {
		it("should give the records of a project file on every port", async () => {
			await records.write(address, info, served);
			await records.write(
				new ServeAddress("127.0.0.1", 37001),
				info,
				served
			);
			await records.write(new ServeAddress("127.0.0.1", 37002), info, {
				projectFile: "/other/default.project.json",
			});
			await fs.writeFile("/tmp/rogen-serve/37003.json", "{");

			expect(
				(await records.recordsFor("/repo/default.project.json"))
					.map(({ port }) => port)
					.sort()
			).toEqual([34872, 37001]);
		});

		it("should give none when nothing was recorded", async () => {
			expect(
				await records.recordsFor("/repo/default.project.json")
			).toEqual([]);
		});
	});

	describe("write", () => {
		it("should leave the earlier record readable until the new one is whole", async () => {
			let held: DeferredPromise<void> | undefined = undefined;
			const halfWritten = new DeferredPromise<void>();
			const halting = new (class extends MemoryFileSystemService {
				override async writeFile(
					filePath: string,
					content: string
				): Promise<void> {
					if (!held) return super.writeFile(filePath, content);
					await super.writeFile(
						filePath,
						content.slice(0, content.length / 2)
					);
					halfWritten.complete();
					await held.p;
					await super.writeFile(filePath, content);
				}
			})();
			const reader = new ServerRecords(halting, "/tmp", 4242);
			await reader.write(address, info, served);
			held = new DeferredPromise<void>();

			const writing = new ServerRecords(halting, "/tmp", 5000).write(
				address,
				info,
				{ ...served, pid: 1001 }
			);
			await halfWritten.p;

			expect(await reader.recordOf(address, info)).toEqual(
				expect.objectContaining({ owner: 4242 })
			);
			held.complete();
			await writing;
			expect(await reader.recordOf(address, info)).toEqual(
				expect.objectContaining({ owner: 5000, pid: 1001 })
			);
		});
	});

	describe("remove", () => {
		it("should forget a record it wrote for the session", async () => {
			await records.write(address, info, served);

			await records.remove(address, info);

			expect(await records.recordOf(address, info)).toBeUndefined();
		});

		it.each([
			["another serve", 5000, info],
			["another session", 4242, { ...info, session: "s2" }],
		])(
			"should leave a record that %s wrote since",
			async (_, owner, written) => {
				await records.write(address, info, served);
				await new ServerRecords(fs, "/tmp", owner).write(
					address,
					written,
					served
				);

				await records.remove(address, info);

				expect(await records.recordOf(address, written)).toBeDefined();
			}
		);

		it("should leave a record it can't delete, without failing", async () => {
			await records.write(address, info, served);
			jest.spyOn(fs, "delete").mockRejectedValue(new Error("EBUSY"));

			await expect(
				records.remove(address, info)
			).resolves.toBeUndefined();
			expect(await records.recordOf(address, info)).toBeDefined();
		});

		it("should do nothing when there is no record", async () => {
			await expect(
				records.remove(address, info)
			).resolves.toBeUndefined();
		});
	});
});
