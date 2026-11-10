import { jest } from "@jest/globals";
import { Result, ResultError, err, ok } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { abs } from "../../write/__tests__/fixtures.js";
import { SyncbackStaging } from "../syncback-staging.js";

const LOCK = abs(".rogen-syncback/lock");
const STALE = abs(".rogen-syncback/mirror/Workspace/Stale.luau");

describe("SyncbackStaging", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;
	let lifecycle: MockLifecycleService;
	let staging: SyncbackStaging;

	const busyDiagnostics = (result: Result<unknown, Error>) =>
		(result as ResultError<DiagnosticsError>).error.diagnostics;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		processes = new MockProcessService();
		lifecycle = new MockLifecycleService();
		staging = new SyncbackStaging(fs, processes, lifecycle, 4242, abs());
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("should refuse while another syncback holds the folder, touching nothing", async () => {
		await fs.writeFile(LOCK, "77");
		await fs.writeFile(STALE, "return 1");
		processes.running.add(77);
		const work = jest.fn(async () => ok(undefined));

		const used = await staging.use(work);

		expect(used.isErr()).toBe(true);
		expect(busyDiagnostics(used)).toMatchObject([
			{
				code: "syncback.busy",
				resource: abs(),
				message:
					"another rogen syncback (process 77) is running in this folder, so this one stopped. Wait for it to end, or remove .rogen-syncback/lock if none is running.",
			},
		]);
		expect(work).not.toHaveBeenCalled();
		expect(await fs.readFile(LOCK)).toBe("77");
		expect(await fs.readFile(STALE)).toBe("return 1");
	});

	it("should take over the folder from a syncback that was killed, and clean what it left", async () => {
		await fs.writeFile(LOCK, "77");
		await fs.writeFile(STALE, "return 1");
		let lock: string | undefined;
		let stale: boolean | undefined;

		const used = await staging.use(async () => {
			lock = await fs.readFile(LOCK);
			stale = await fs.exists(STALE);
			return ok(undefined);
		});

		expect(used.isOk()).toBe(true);
		expect(lock).toBe("4242");
		expect(stale).toBe(false);
	});

	it("should take over a lock that names this process, since no other run is it", async () => {
		await fs.writeFile(LOCK, "4242");
		await fs.writeFile(STALE, "return 1");
		processes.running.add(4242);
		let stale: boolean | undefined;

		const used = await staging.use(async () => {
			stale = await fs.exists(STALE);
			return ok(undefined);
		});

		expect(used.isOk()).toBe(true);
		expect(stale).toBe(false);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it("should count a new lock that names no owner yet as held", async () => {
		await fs.writeFile(LOCK, "");

		const used = await staging.use(async () => ok(undefined));

		expect(busyDiagnostics(used)).toMatchObject([
			{ code: "syncback.busy" },
		]);
		expect(await fs.readFile(LOCK)).toBe("");
	});

	it("should take over an old lock that names no owner", async () => {
		await fs.writeFile(LOCK, "");
		const now = Date.now();
		jest.spyOn(Date, "now").mockReturnValue(now + 60_000);

		const used = await staging.use(async () => ok(undefined));

		expect(used.isOk()).toBe(true);
	});

	it("should not take over a lock another run made after it found a killed one's", async () => {
		await fs.writeFile(LOCK, "77");
		const read = fs.readFile.bind(fs);
		let raced = false;
		jest.spyOn(fs, "readFile").mockImplementation(async (file) => {
			const text = await read(file);
			if (file === LOCK && !raced) {
				raced = true;
				await fs.delete(file);
				await fs.createFile(file, "88");
				processes.running.add(88);
			}
			return text;
		});
		const work = jest.fn(async () => ok(undefined));

		const used = await staging.use(work);

		expect(busyDiagnostics(used)).toMatchObject([
			{ code: "syncback.busy", message: expect.stringContaining("88") },
		]);
		expect(await read(LOCK)).toBe("88");
		expect(work).not.toHaveBeenCalled();
	});

	it("should leave the files another run makes while it takes over a lock, until it lets go of the folder", async () => {
		await fs.writeFile(abs(".rogen-syncback/lock.88"), "77");
		await fs.writeFile(abs(".rogen-syncback/lock.1234.tmp"), "88");
		let left: boolean[] | undefined;

		const used = await staging.use(async () => {
			left = [
				await fs.exists(abs(".rogen-syncback/lock.88")),
				await fs.exists(abs(".rogen-syncback/lock.1234.tmp")),
			];
			return ok(undefined);
		});

		expect(used.isOk()).toBe(true);
		expect(left).toEqual([true, true]);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it("should take the folder when it was let go of while the lock was being made", async () => {
		const create = fs.createFile.bind(fs);
		let released = false;
		jest.spyOn(fs, "createFile").mockImplementation(
			async (file, content) => {
				if (!released) {
					released = true;
					throw Object.assign(new Error("ENOENT: no such file"), {
						code: "ENOENT",
					});
				}
				return create(file, content);
			}
		);
		let lock: string | undefined;

		const used = await staging.use(async () => {
			lock = await fs.readFile(LOCK);
			return ok(undefined);
		});

		expect(used.isOk()).toBe(true);
		expect(lock).toBe("4242");
	});

	it("should let the next run in once one has ended, whether it succeeded or failed", async () => {
		processes.running.add(4242);

		const failed = await staging.use(async () => err(new Error("no")));
		const first = await staging.use(async () => ok(1));
		const second = await staging.use(async () => ok(2));

		expect(failed.isErr()).toBe(true);
		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it.each([
		["the mirror an earlier run left", ".rogen-syncback/mirror"],
		["the project file an earlier run left", "rogen-syncback.project.json"],
	])(
		"should fail before its work when %s can't be removed",
		async (_, left) => {
			await fs.writeFile(STALE, "return 1");
			await fs.writeFile(abs("rogen-syncback.project.json"), "{}");
			const remove = fs.delete.bind(fs);
			jest.spyOn(fs, "delete").mockImplementation(
				async (target, recursive) => {
					if (target === abs(left))
						throw Object.assign(new Error("EBUSY: resource busy"), {
							code: "EBUSY",
						});
					return remove(target, recursive);
				}
			);
			const work = jest.fn(async () => ok(undefined));

			const used = await staging.use(work);

			expect((used as ResultError<Error>).error.message).toContain(
				abs(left)
			);
			expect(work).not.toHaveBeenCalled();
			expect(await fs.exists(LOCK)).toBe(false);
		}
	);

	it("should remove its files at once, and keep its lock until the work stopped, when asked to shut down", async () => {
		let left: boolean | undefined;
		let locked: boolean | undefined;
		let aborted: boolean | undefined;

		await staging.use(async (signal) => {
			await fs.writeFile(STALE, "return 1");
			await fs.writeFile(staging.file, "{}");
			lifecycle.shutdown("SIGINT");
			while (await fs.exists(staging.mirror))
				await new Promise((resolve) => setImmediate(resolve));
			left = await fs.exists(staging.file);
			locked = await fs.exists(LOCK);
			aborted = signal.aborted;
			return ok(undefined);
		});

		expect(left).toBe(false);
		expect(locked).toBe(true);
		expect(aborted).toBe(true);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it("should stop listening for a shutdown once the work ended", async () => {
		await staging.use(async () => ok(undefined));
		await fs.writeFile(LOCK, "77");

		lifecycle.shutdown("SIGINT");
		await Promise.resolve();

		expect(await fs.readFile(LOCK)).toBe("77");
	});
});
