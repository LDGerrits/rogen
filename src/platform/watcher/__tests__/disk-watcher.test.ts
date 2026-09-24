import fs from "fs/promises";
import os from "os";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { FileChange, FileChangeType } from "../../fs/file-events.js";
import { NullLogService } from "../../log/log-service.js";
import { DiskWatcher } from "../disk-watcher.js";

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

			await watcher.watch([{ path: dir, recursive: true }]);
			await fs.writeFile(path.join(dir, "a.luau"), "");

			const added = (c: FileChange) =>
				c.type === FileChangeType.ADDED &&
				c.path === toPosix(path.join(dir, "a.luau"));
			await waitFor(() => changes.some(added));

			expect(changes.some(added)).toBe(true);
		});

		it("should skip a file and a directory it was told to ignore", async () => {
			const changes: FileChange[] = [];
			store.add(watcher.onDidChangeFile((c) => changes.push(...c)));
			const skippedDir = path.join(dir, "out");
			const skippedFile = path.join(dir, "a.project.json");
			await fs.mkdir(skippedDir);

			await watcher.watch([{ path: dir, recursive: true }], {
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
			await watcher.watch([{ path: root, recursive: true }]);

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
			await watcher.watch([{ path: root, recursive: true }]);

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
			await watcher.watch([{ path: root, recursive: true }]);

			await fs.rm(path.join(root, "Shared"), { recursive: true });

			await waitFor(() =>
				has(FileChangeType.DELETED, linkPath("Shared"))
			);
			expect(
				await fs.readFile(path.join(outside, "Util.luau"), "utf-8")
			).toBe("");
		});

		it("should not follow a link that points at its own parent", async () => {
			await fs.symlink(root, path.join(root, "Loop"), "junction");
			await watcher.watch([{ path: root, recursive: true }]);

			await fs.writeFile(path.join(root, "a.luau"), "");

			await waitFor(() => has(FileChangeType.ADDED, linkPath("a.luau")));
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(
				changes.filter((c) => c.path.startsWith(linkPath("Loop/")))
			).toEqual([]);
		});
	});
});
