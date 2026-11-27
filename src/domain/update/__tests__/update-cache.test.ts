import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { UpdateCache } from "../update-cache.js";

const FILE = "/cache/rogen/update-check.json";
const DAY = 24 * 60 * 60 * 1000;

describe("UpdateCache", () => {
	let fs: MemoryFileSystemService;
	let clock: number;
	let cache: UpdateCache;

	const stored = async () =>
		JSON.parse(await fs.readFile(FILE)) as Record<string, unknown>;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		clock = 1_000 * DAY;
		cache = new UpdateCache(FILE, () => clock, fs);
	});

	describe("isDue", () => {
		it("should be due before any check", async () => {
			expect(await cache.isDue()).toBe(true);
		});

		it("should be due a day after a check, and not before", async () => {
			await cache.recordCheck(["2.0.1"]);

			clock += DAY - 1;
			expect(await cache.isDue()).toBe(false);

			clock += 1;
			expect(await cache.isDue()).toBe(true);
		});
	});

	describe("recordCheck", () => {
		it("should keep the versions it knew when a check found none", async () => {
			await cache.recordCheck(["2.0.1"]);
			clock += DAY;
			await cache.recordCheck([]);

			expect(await cache.versions()).toEqual(["2.0.1"]);
			expect((await stored()).checkedAt).toBe(clock);
		});

		it("should replace the versions with what a check found", async () => {
			await cache.recordCheck(["2.0.1"]);
			await cache.recordCheck(["2.0.2", "2.0.1"]);

			expect(await cache.versions()).toEqual(["2.0.2", "2.0.1"]);
		});

		it("should go on without a file it can't write", async () => {
			await fs.writeFile("/cache/rogen", "");

			await cache.recordCheck(["2.0.1"]);

			expect(await cache.versions()).toEqual([]);
			expect(await cache.announce("2.0.1")).toBe(true);
		});
	});

	describe("announce", () => {
		it("should announce a version once a day", async () => {
			expect(await cache.announce("2.0.1")).toBe(true);
			expect(await cache.announce("2.0.1")).toBe(false);

			clock += DAY - 1;
			expect(await cache.announce("2.0.1")).toBe(false);

			clock += 1;
			expect(await cache.announce("2.0.1")).toBe(true);
		});

		it("should announce a newer version at once", async () => {
			await cache.announce("2.0.1");

			expect(await cache.announce("2.0.2")).toBe(true);
		});

		it("should keep the versions a check found", async () => {
			await cache.recordCheck(["2.0.1"]);

			await cache.announce("2.0.1");

			expect(await cache.versions()).toEqual(["2.0.1"]);
		});

		it("should not lose a check that runs beside it", async () => {
			await Promise.all([
				cache.announce("2.0.1"),
				cache.recordCheck(["2.0.1"]),
			]);

			expect(await cache.versions()).toEqual(["2.0.1"]);
			expect(await cache.announce("2.0.1")).toBe(false);
		});
	});

	it("should read a file of another shape as empty", async () => {
		await fs.writeFile(
			FILE,
			'{ "checkedAt": "today", "versions": "2.0.0", "announced": { "version": 2 } }'
		);

		expect(await cache.versions()).toEqual([]);
		expect(await cache.isDue()).toBe(true);
	});

	it("should read a file that is damaged as empty", async () => {
		await fs.writeFile(FILE, "{ nope");

		expect(await cache.versions()).toEqual([]);
	});
});
