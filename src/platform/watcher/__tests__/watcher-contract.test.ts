import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { FileChange } from "../../fs/file-changes.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { NullLogService } from "../../log/null-log-service.js";
import { DiskWatcher } from "../disk-watcher.js";
import { MemoryWatcher } from "../memory-watcher.js";
import { Watcher } from "../watcher.js";

interface Fixture {
	readonly watcher: Watcher & Disposable;
	readonly root: string;
	write(file: string): Promise<void>;
	dispose(): void;
}

const fixtures: [string, () => Fixture][] = [
	[
		"DiskWatcher",
		() => {
			const root = fs.realpathSync(
				fs.mkdtempSync(path.join(os.tmpdir(), "rogen-watch-contract-"))
			);
			return {
				watcher: new DiskWatcher(new NullLogService()),
				root,
				write: async (file) => {
					await fs.promises.mkdir(path.dirname(file), {
						recursive: true,
					});
					await fs.promises.writeFile(file, String(Date.now()));
				},
				dispose: () =>
					fs.rmSync(root, { recursive: true, force: true }),
			};
		},
	],
	[
		"MemoryWatcher",
		() => {
			const fileSystem = new MemoryFileSystemService();
			return {
				watcher: new MemoryWatcher(fileSystem, new NullLogService()),
				root: path.resolve("/repo"),
				write: (file) => fileSystem.writeFile(file, String(Date.now())),
				dispose: () => undefined,
			};
		},
	],
];

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

describe.each(fixtures)("%s: contract", (_name, create) => {
	let fixture: Fixture;
	let store: DisposableStore;
	let changed: string[];
	let at: (...segments: string[]) => string;

	beforeEach(() => {
		fixture = create();
		store = new DisposableStore();
		changed = [];
		store.add(
			fixture.watcher.onDidChangeFile((changes: FileChange[]) =>
				changed.push(...changes.map((change) => change.path))
			)
		);
		at = (...segments) => path.join(fixture.root, ...segments);
	});

	afterEach(async () => {
		store[Symbol.dispose]();
		await fixture.watcher.stop();
		fixture.watcher[Symbol.dispose]();
		fixture.dispose();
	});

	it("should report a change anywhere under a watched directory", async () => {
		await fixture.write(at("src/a.luau"));
		await fixture.watcher.watch([at("src")]);

		await fixture.write(at("src/deep/b.luau"));

		await waitFor(() => changed.includes(toPosix(at("src/deep/b.luau"))));
		expect(changed).toContain(toPosix(at("src/deep/b.luau")));
	});

	it("should report only a watched file's own changes", async () => {
		await fixture.write(at("default.rogen.json"));
		await fixture.watcher.watch([at("default.rogen.json")]);

		await fixture.write(at("other.rogen.json"));
		await fixture.write(at("default.rogen.json"));

		await waitFor(() =>
			changed.includes(toPosix(at("default.rogen.json")))
		);
		expect(changed).not.toContain(toPosix(at("other.rogen.json")));
	});

	it("should report nothing it was told to ignore", async () => {
		await fixture.write(at("src/a.luau"));
		await fixture.watcher.watch([at("src")], { ignored: [at("src/out")] });

		await fixture.write(at("src/out/b.luau"));
		await fixture.write(at("src/c.luau"));

		await waitFor(() => changed.includes(toPosix(at("src/c.luau"))));
		expect(changed).not.toContain(toPosix(at("src/out/b.luau")));
	});
});
