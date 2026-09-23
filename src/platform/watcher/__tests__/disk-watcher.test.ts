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
	});
});
