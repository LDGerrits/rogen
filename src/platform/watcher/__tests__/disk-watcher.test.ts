import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { FileChange, FileChangeType } from "../../fs/file-changes.js";
import { FileType } from "../../fs/file-system-service.js";
import { LogLevel } from "../../log/log-service.js";
import { NullLogService } from "../../log/null-log-service.js";
import { MockLogService } from "../../log/__tests__/mock-log-service.js";
import { DiskWatcher } from "../disk-watcher.js";
import { WatchOptions } from "../watcher.js";

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const check = () => {
			if (predicate()) resolve();
			else if (Date.now() - start > timeoutMs)
				reject(new Error("Timed out waiting for condition."));
			else setTimeout(check, 20);
		};
		check();
	});
}

const canDenyAccess = process.platform !== "win32";
const describeLocking = canDenyAccess ? describe : describe.skip;

describe("DiskWatcher", () => {
	let dir: string;
	let watcher: DiskWatcher;
	let store: DisposableStore;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "rogen-watcher-"));
		watcher = new DiskWatcher(new NullLogService());
		store = new DisposableStore();
	});

	afterEach(async () => {
		store[Symbol.dispose]();
		await watcher.stop();
		await fs.rm(dir, { recursive: true, force: true });
	});

	describe("watch", () => {
		it("should report a file created right after watch resolves", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));

			await watcher.watch([dir]);
			await fs.writeFile(path.join(dir, "a.luau"), "");

			const added = (c: FileChange) =>
				c.type === FileChangeType.ADDED &&
				c.path === toPosix(path.join(dir, "a.luau"));
			await waitFor(() => changes.some(added), 10000);

			expect(changes.some(added)).toBe(true);
		});

		describeLocking("a folder it may not read", () => {
			const watchLocked = async (options?: WatchOptions) => {
				const locked = path.join(dir, "locked");
				await fs.mkdir(locked);
				await fs.chmod(locked, 0);
				const logService = new MockLogService();
				logService.setLevel(LogLevel.Debug);
				const watching = new DiskWatcher(logService);
				try {
					await watching.watch([dir], options);
				} finally {
					await watching.stop();
					await fs.chmod(locked, 0o755);
				}
				return logService;
			};

			it("should warn of it once", async () => {
				const logService = await watchLocked();

				expect(logService.texts("error")).toEqual([]);
				expect(logService.texts("warn")).toEqual([
					expect.stringContaining("EACCES"),
				]);
			});

			it("should write only a debug line for it where the caller reports it", async () => {
				const logService = await watchLocked({
					reportsUnreadable: [dir],
				});

				expect(logService.texts("error")).toEqual([]);
				expect(logService.texts("warn")).toEqual([]);
				expect(logService.texts("debug")).toContainEqual(
					expect.stringContaining("EACCES")
				);
			});

			it.each([
				["a folder inside a root", false],
				["a root", true],
			])(
				"should report %s added once it can be read, and what changes in it then",
				async (_, isRoot) => {
					const changes: FileChange[] = [];
					store.add(
						watcher.onDidChangeFile((c) => changes.push(...c))
					);
					const locked = path.join(dir, "locked");
					await fs.mkdir(locked);
					await fs.chmod(locked, 0);
					await watcher.watch([isRoot ? locked : dir]);

					await fs.chmod(locked, 0o755);
					const added = (c: FileChange) =>
						c.type === FileChangeType.ADDED &&
						c.path === toPosix(locked) &&
						c.fileType === FileType.Directory;
					await waitFor(() => changes.some(added));
					await fs.writeFile(path.join(locked, "a.luau"), "");
					const inside = (c: FileChange) =>
						c.path === toPosix(path.join(locked, "a.luau"));
					await waitFor(() => changes.some(inside), 10000);

					expect(changes.filter(added)).toHaveLength(1);
				},
				20000
			);
		});

		it("should report a file made as soon as a folder is reported added once it can be read", async () => {
			if (!canDenyAccess) return;
			const rounds = 12;
			const made = new Set<string>();
			const reported = new Set<string>();
			store.add(
				watcher.onDidChangeFile((changes) => {
					for (const c of changes) {
						if (
							c.type === FileChangeType.ADDED &&
							c.fileType === FileType.Directory &&
							made.size < rounds &&
							path.basename(c.path).startsWith("locked-")
						) {
							const file = path.join(c.path, "a.luau");
							fsSync.writeFileSync(file, "");
							made.add(toPosix(file));
						}
						if (made.has(c.path)) reported.add(c.path);
					}
				})
			);
			const folders = Array.from({ length: rounds }, (_, i) =>
				path.join(dir, `locked-${i}`)
			);
			for (const folder of folders) {
				await fs.mkdir(folder);
				await fs.chmod(folder, 0);
			}
			await watcher.watch([dir]);

			for (const folder of folders) await fs.chmod(folder, 0o755);

			await waitFor(() => made.size === rounds, 10000);
			await waitFor(() => reported.size === rounds, 10000);

			expect(reported).toEqual(made);
		}, 30000);

		it("should report a root that was deleted and made again", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const root = path.join(dir, "pkg", "src");
			await fs.mkdir(root, { recursive: true });
			await watcher.watch([root]);

			await fs.rm(path.join(dir, "pkg"), { recursive: true });
			await fs.mkdir(root, { recursive: true });

			const added = (c: FileChange) =>
				c.type === FileChangeType.ADDED && c.path === toPosix(root);
			await waitFor(() => changes.some(added));

			expect(changes.some(added)).toBe(true);
		});

		it("should report a root that did not exist when it began", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const root = path.join(dir, "later", "src");
			await watcher.watch([root]);

			await fs.mkdir(root, { recursive: true });
			await fs.writeFile(path.join(root, "a.luau"), "");

			const added = (c: FileChange) =>
				c.type === FileChangeType.ADDED && c.path === toPosix(root);
			await waitFor(() => changes.some(added));

			expect(changes.some(added)).toBe(true);
		});

		it("should report nothing of a root made after a watch stopped before it was ready", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const root = path.join(dir, "later", "src");

			const watching = watcher.watch([root]);
			await new Promise((resolve) => setImmediate(resolve));
			await Promise.all([watching, watcher.stop()]);
			await fs.mkdir(root, { recursive: true });
			await new Promise((resolve) => setTimeout(resolve, 1200));

			expect(changes).toEqual([]);
		});

		it("should skip a file and a directory it was told to ignore", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const skippedDir = path.join(dir, "out");
			const skippedFile = path.join(dir, "a.project.json");
			await fs.mkdir(skippedDir);

			await watcher.watch([dir], {
				ignored: [skippedDir, skippedFile],
			});
			await fs.writeFile(path.join(skippedDir, "B.luau"), "");
			await fs.writeFile(skippedFile, "");
			await fs.writeFile(path.join(dir, "a.luau"), "");

			await waitFor(() =>
				changes.some(
					(c) => c.path === toPosix(path.join(dir, "a.luau"))
				)
			);

			expect(changes.map((c) => c.path)).toEqual([
				toPosix(path.join(dir, "a.luau")),
			]);
		});
	});

	describe("ignored patterns", () => {
		it("should skip a path that matches an ignored pattern", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const staged = path.join(dir, "a.project.json.abc.tmp");

			await watcher.watch([dir], {
				ignored: [/a\.project\.json\.[^/]+\.tmp$/],
			});
			await fs.writeFile(staged, "");
			await fs.writeFile(path.join(dir, "a.luau"), "");

			await waitFor(() =>
				changes.some(
					(c) => c.path === toPosix(path.join(dir, "a.luau"))
				)
			);

			expect(changes.map((c) => c.path)).toEqual([
				toPosix(path.join(dir, "a.luau")),
			]);
		});
	});

	describe("symbolic links", () => {
		let root: string;
		let outside: string;
		let changes: FileChange[];

		const linkPath = (...segments: string[]) =>
			toPosix(path.join(root, ...segments));
		const has = (type: FileChangeType, target: string) =>
			changes.some((c) => c.type === type && c.path === target);

		beforeEach(async () => {
			root = path.join(dir, "src");
			outside = path.join(dir, "shared");
			await fs.mkdir(path.join(outside, "deep"), { recursive: true });
			await fs.mkdir(root);
			await fs.writeFile(path.join(outside, "Util.luau"), "");
			changes = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
		});

		it("should report an edit inside a linked target that is outside the watched directory", async () => {
			await fs.symlink(outside, path.join(root, "Shared"), "junction");
			await watcher.watch([root]);

			await fs.writeFile(path.join(outside, "Util.luau"), "v2");
			await fs.writeFile(path.join(outside, "deep", "New.luau"), "");

			await waitFor(
				() =>
					has(FileChangeType.UPDATED, linkPath("Shared/Util.luau")) &&
					has(FileChangeType.ADDED, linkPath("Shared/deep/New.luau"))
			);

			expect(
				has(FileChangeType.UPDATED, linkPath("Shared/Util.luau"))
			).toBe(true);
		});

		it("should report a link added later, and what is under it, at the link path", async () => {
			await watcher.watch([root]);

			await fs.symlink(outside, path.join(root, "Shared"), "junction");

			await waitFor(
				() =>
					has(FileChangeType.ADDED, linkPath("Shared")) &&
					has(FileChangeType.ADDED, linkPath("Shared/Util.luau"))
			);
			expect(changes.every((c) => c.path.startsWith(linkPath()))).toBe(
				true
			);
		});

		it("should report a link removed, without touching its target", async () => {
			await fs.symlink(outside, path.join(root, "Shared"), "junction");
			await watcher.watch([root]);

			await fs.rm(path.join(root, "Shared"), { recursive: true });

			await waitFor(() =>
				has(FileChangeType.DELETED, linkPath("Shared"))
			);
			expect(
				await fs.readFile(path.join(outside, "Util.luau"), "utf-8")
			).toBe("");
		});

		const settled = async () => {
			await fs.writeFile(path.join(root, "Loop", "settled.luau"), "");
			await waitFor(() =>
				has(FileChangeType.ADDED, linkPath("settled.luau"))
			);
		};

		it("should report a link to its own parent added later, without following it", async () => {
			await watcher.watch([root]);

			await fs.symlink(root, path.join(root, "Loop"), "junction");

			await waitFor(() => has(FileChangeType.ADDED, linkPath("Loop")));
			await settled();
			expect(
				changes.filter((c) => c.path.startsWith(linkPath("Loop/")))
			).toEqual([]);
		});

		it("should report a link to nothing added later, and its removal", async () => {
			await watcher.watch([root]);

			await fs.symlink(
				path.join(dir, "missing"),
				path.join(root, "Broken"),
				"junction"
			);
			await waitFor(() => has(FileChangeType.ADDED, linkPath("Broken")));
			await fs.rm(path.join(root, "Broken"));

			await waitFor(() =>
				has(FileChangeType.DELETED, linkPath("Broken"))
			);
			expect(has(FileChangeType.DELETED, linkPath("Broken"))).toBe(true);
		});

		it("should not report a link seen by a replaced watch when it is removed", async () => {
			await fs.symlink(
				path.join(dir, "missing"),
				path.join(root, "Broken"),
				"junction"
			);
			await watcher.watch([root]);
			await watcher.watch([outside]);

			await fs.rm(path.join(root, "Broken"));
			await fs.writeFile(path.join(outside, "Later.luau"), "");

			await waitFor(() =>
				changes.some(
					(c) => c.path === toPosix(path.join(outside, "Later.luau"))
				)
			);
			await new Promise((resolve) => setTimeout(resolve, 600));
			expect(has(FileChangeType.DELETED, linkPath("Broken"))).toBe(false);
		});

		it("should not follow a link that points at its own parent", async () => {
			await fs.symlink(root, path.join(root, "Loop"), "junction");
			await watcher.watch([root]);

			await fs.writeFile(path.join(root, "a.luau"), "");

			await waitFor(() => has(FileChangeType.ADDED, linkPath("a.luau")));
			await settled();
			expect(
				changes.filter((c) => c.path.startsWith(linkPath("Loop/")))
			).toEqual([]);
		});
	});
});
