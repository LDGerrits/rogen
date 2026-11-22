import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { toPosix } from "../../../base/path.js";
import { FileChange, FileChangeType } from "../../fs/file-changes.js";
import { FileType } from "../../fs/file-system-service.js";
import { LogLevel } from "../../log/log-service.js";
import { MockLogService } from "../../log/__tests__/mock-log-service.js";

class FakeChokidar extends EventEmitter {
	watched: Record<string, string[]> = {};
	readonly add = jest.fn();
	readonly close = jest.fn(async () => {});
	readonly getWatched = jest.fn(() => this.watched);
}

let chokidar: FakeChokidar;

jest.unstable_mockModule("chokidar", () => ({
	default: {
		watch: () => {
			chokidar = new FakeChokidar();
			queueMicrotask(() => chokidar.emit("ready"));
			return chokidar;
		},
	},
}));

const { diskWatcherOf } = await import("./disk-watcher-of.js");

const failure = (code: string, failedPath?: string) =>
	Object.assign(new Error(`${code}: failed`), { code, path: failedPath });

describe("DiskWatcher, with chokidar's events made up", () => {
	let dir: string;
	let logService: MockLogService;
	let changes: FileChange[];
	let watcher: ReturnType<typeof diskWatcherOf>;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-session-"));
		logService = new MockLogService();
		logService.setLevel(LogLevel.Debug);
		changes = [];
		watcher = diskWatcherOf(logService);
		watcher.onDidChangeFile((each) => changes.push(...each));
	});

	afterEach(async () => {
		await watcher.stop();
		jest.useRealTimers();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should log a failure to watch that isn't about permissions as an error", async () => {
		await watcher.watch([dir]);

		chokidar.emit("error", failure("ENOSPC", dir));
		chokidar.emit("error", failure("EACCES"));

		expect(logService.texts("error")).toEqual([
			"Can't watch part of the project: ENOSPC: failed",
		]);
		expect(logService.texts("warn")).toEqual([
			"Can't watch part of the project: EACCES: failed",
		]);
	});

	it("should report nothing once closed", async () => {
		await watcher.watch([dir]);
		const closed = chokidar;
		await watcher.stop();

		closed.emit("add", path.join(dir, "a.luau"));

		expect(changes).toEqual([]);
	});

	it("should report a root that comes back as a file", async () => {
		jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
		const root = path.join(dir, "root");
		fs.mkdirSync(root);
		await watcher.watch([root]);

		fs.rmdirSync(root);
		await jest.advanceTimersByTimeAsync(500);
		fs.writeFileSync(root, "");
		await jest.advanceTimersByTimeAsync(500);
		expect(chokidar.add).toHaveBeenCalledWith(root);
		await jest.advanceTimersByTimeAsync(500);
		expect(changes).toEqual([]);
		chokidar.watched = { [dir]: ["root"] };
		await jest.advanceTimersByTimeAsync(500);

		expect(changes).toEqual([
			{
				type: FileChangeType.ADDED,
				path: toPosix(root),
				fileType: FileType.File,
			},
		]);
	});

	it("should stop waiting for a refused folder that is gone, and keep waiting for one still refused", async () => {
		if (process.platform === "win32" || process.getuid?.() === 0) return;
		jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
		await watcher.watch([dir]);
		const gone = path.join(dir, "gone");
		const locked = path.join(dir, "locked");
		fs.mkdirSync(locked);
		fs.mkdirSync(gone);
		fs.chmodSync(locked, 0);

		try {
			chokidar.emit("error", failure("EACCES", gone));
			chokidar.emit("error", failure("EPERM", locked));
			fs.rmdirSync(gone);
			await jest.advanceTimersByTimeAsync(500);
			fs.mkdirSync(gone);
			await jest.advanceTimersByTimeAsync(500);
			expect(chokidar.add).not.toHaveBeenCalled();
		} finally {
			fs.chmodSync(locked, 0o755);
		}
		await jest.advanceTimersByTimeAsync(500);

		expect(chokidar.add.mock.calls).toEqual([[locked]]);
	});
});
