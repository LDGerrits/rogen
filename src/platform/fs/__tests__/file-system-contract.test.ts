import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DiskFileSystemService } from "../disk-file-system-service.js";
import { FileChange, FileChangeType } from "../file-changes.js";
import { FileSystemService, FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";

interface Fixture {
	readonly fileSystem: FileSystemService;
	readonly root: string;
	dispose(): void;
}

const fixtures: [string, () => Fixture][] = [
	[
		"DiskFileSystemService",
		() => {
			const root = fs.realpathSync(
				fs.mkdtempSync(path.join(os.tmpdir(), "rogen-contract-"))
			);
			return {
				fileSystem: new DiskFileSystemService(),
				root,
				dispose: () =>
					fs.rmSync(root, { recursive: true, force: true }),
			};
		},
	],
	[
		"MemoryFileSystemService",
		() => ({
			fileSystem: new MemoryFileSystemService(),
			root: path.resolve("/repo"),
			dispose: () => undefined,
		}),
	],
];

describe.each(fixtures)("%s: contract", (_name, create) => {
	let fixture: Fixture;
	let at: (...segments: string[]) => string;

	beforeEach(() => {
		fixture = create();
		at = (...segments) => path.join(fixture.root, ...segments);
	});

	afterEach(() => fixture.dispose());

	describe("createDirectory", () => {
		it("should leave an existing directory as it is", async () => {
			await fixture.fileSystem.writeFile(at("src/a.luau"), "");

			await fixture.fileSystem.createDirectory(at("src"));

			expect(await fixture.fileSystem.exists(at("src/a.luau"))).toBe(
				true
			);
		});

		it("should reject with EEXIST when a file is in the way", async () => {
			await fixture.fileSystem.writeFile(at("src"), "");

			await expect(
				fixture.fileSystem.createDirectory(at("src"))
			).rejects.toMatchObject({ code: "EEXIST" });
		});
	});

	describe("delete", () => {
		it("should do nothing for a path whose parent is missing", async () => {
			await expect(
				fixture.fileSystem.delete(at("missing/a.luau"))
			).resolves.toBeUndefined();
			expect(await fixture.fileSystem.exists(at("missing"))).toBe(false);
		});

		it("should reject with EISDIR for a directory unless recursive", async () => {
			await fixture.fileSystem.writeFile(at("src/a.luau"), "");

			await expect(
				fixture.fileSystem.delete(at("src"))
			).rejects.toMatchObject({ code: "EISDIR" });
			expect(await fixture.fileSystem.exists(at("src/a.luau"))).toBe(
				true
			);
			await fixture.fileSystem.delete(at("src"), true);
			expect(await fixture.fileSystem.exists(at("src"))).toBe(false);
		});
	});

	describe("readDirectory", () => {
		it("should reject with ENOENT for a directory that doesn't exist", async () => {
			await expect(
				fixture.fileSystem.readDirectory(at("missing"))
			).rejects.toMatchObject({ code: "ENOENT" });
		});

		it("should reject with ENOTDIR for a file", async () => {
			await fixture.fileSystem.writeFile(at("a.luau"), "");

			await expect(
				fixture.fileSystem.readDirectory(at("a.luau"))
			).rejects.toMatchObject({ code: "ENOTDIR" });
		});
	});

	describe("rename", () => {
		it("should move a file, creating the destination's parents", async () => {
			await fixture.fileSystem.writeFile(at("a.json"), "x");

			await fixture.fileSystem.rename(at("a.json"), at("out/b.json"));

			expect(await fixture.fileSystem.readFile(at("out/b.json"))).toBe(
				"x"
			);
			expect(await fixture.fileSystem.exists(at("a.json"))).toBe(false);
		});

		it("should refuse to replace a file unless told to overwrite", async () => {
			await fixture.fileSystem.writeFile(at("a.json"), "new");
			await fixture.fileSystem.writeFile(at("b.json"), "old");

			await expect(
				fixture.fileSystem.rename(at("a.json"), at("b.json"))
			).rejects.toMatchObject({ code: "EEXIST" });
			await fixture.fileSystem.rename(at("a.json"), at("b.json"), true);

			expect(await fixture.fileSystem.readFile(at("b.json"))).toBe("new");
		});

		it("should leave a directory renamed onto itself as it is", async () => {
			await fixture.fileSystem.writeFile(at("src/a.luau"), "");

			await fixture.fileSystem.rename(at("src"), at("src"), true);

			expect(await fixture.fileSystem.exists(at("src/a.luau"))).toBe(
				true
			);
		});

		it("should reject with EISDIR to replace a directory, even when told to overwrite", async () => {
			await fixture.fileSystem.writeFile(at("a.json"), "x");
			await fixture.fileSystem.writeFile(at("src/a.luau"), "");
			await fixture.fileSystem.createDirectory(at("empty"));
			await fixture.fileSystem.createDirectory(at("full/inner"));

			for (const [source, destination] of [
				["a.json", "empty"],
				["src", "empty"],
				["src", "full"],
			]) {
				await expect(
					fixture.fileSystem.rename(at(source), at(destination), true)
				).rejects.toMatchObject({ code: "EISDIR" });
			}

			expect(await fixture.fileSystem.exists(at("src/a.luau"))).toBe(
				true
			);
			expect(await fixture.fileSystem.exists(at("full/inner"))).toBe(
				true
			);
		});
	});
});

describe("MemoryFileSystemService: events", () => {
	const record = (memory: MemoryFileSystemService) => {
		const changes: FileChange[] = [];
		memory.onDidMutateFile((change) => changes.push(change));
		return changes;
	};

	it("should report the directories a write creates, outermost first, as a watcher on disk would", async () => {
		const memory = new MemoryFileSystemService();
		const changes = record(memory);

		await memory.writeFile("/repo/a/b/c.luau", "");

		expect(changes).toEqual([
			{
				type: FileChangeType.ADDED,
				path: "/repo",
				fileType: FileType.Directory,
			},
			{
				type: FileChangeType.ADDED,
				path: "/repo/a",
				fileType: FileType.Directory,
			},
			{
				type: FileChangeType.ADDED,
				path: "/repo/a/b",
				fileType: FileType.Directory,
			},
			{
				type: FileChangeType.ADDED,
				path: "/repo/a/b/c.luau",
				fileType: FileType.File,
			},
		]);
	});

	it("should keep the leading slash of a directory it creates", async () => {
		const memory = new MemoryFileSystemService();
		const changes = record(memory);

		await memory.createDirectory("/repo/src");

		expect(changes.map(({ path }) => path)).toEqual(["/repo", "/repo/src"]);
	});
});
