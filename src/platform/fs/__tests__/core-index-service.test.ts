import { jest } from "@jest/globals";
import { FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import { CoreIndexService } from "../core-index-service.js";
import { FileChangeType } from "../file-events.js";

describe("CoreIndexService", () => {
	let memoryFs: MemoryFileSystemService;
	let indexService: CoreIndexService;

	afterEach(() => {
		indexService[Symbol.dispose]();
	});

	beforeEach(() => {
		memoryFs = new MemoryFileSystemService();
		indexService = new CoreIndexService(memoryFs);
	});

	describe("Initialization", () => {
		it("should recursively map the directory structure into memory", async () => {
			await memoryFs.writeFile("src/main.ts", "");
			await memoryFs.writeFile("src/systems/combat/.server", "");
			await memoryFs.createDirectory("src/empty_folder");

			await indexService.initialize(["src"]);

			expect(indexService.hasEntry("src", "main.ts")).toBe(true);
			expect(indexService.hasEntry("src", "systems")).toBe(true);
			expect(indexService.hasEntry("src/systems", "combat")).toBe(true);
			expect(indexService.hasEntry("src/systems/combat", ".server")).toBe(
				true
			);
			expect(indexService.hasEntry("src", "empty_folder")).toBe(true);

			expect(indexService.hasEntry("src", "missing.ts")).toBe(false);
		});

		it("should keep serving the old listing until the new one is complete", async () => {
			await memoryFs.writeFile("old/a.ts", "");
			await memoryFs.writeFile("new/b.ts", "");
			await indexService.initialize(["old"]);
			const readDirectory = memoryFs.readDirectory.bind(memoryFs);
			const seen: boolean[] = [];
			jest.spyOn(memoryFs, "readDirectory").mockImplementation(
				async (dir) => {
					seen.push(indexService.hasEntry("old", "a.ts"));
					return readDirectory(dir);
				}
			);

			await indexService.initialize(["new"]);

			expect(seen.length).toBeGreaterThan(0);
			expect(seen.every(Boolean)).toBe(true);
			expect(indexService.hasEntry("old", "a.ts")).toBe(false);
			expect(indexService.hasEntry("new", "b.ts")).toBe(true);
		});

		it("should silently ignore directories that throw ENOENT during traversal", async () => {
			await expect(
				indexService.initialize(["missing-root"])
			).resolves.not.toThrow();

			expect(indexService.hasEntry("missing-root", "anything")).toBe(
				false
			);
		});

		it("should not index a directory that does not exist", async () => {
			await indexService.initialize(["missing-root"]);

			expect(indexService.getEntries("missing-root")).toBeUndefined();
		});

		it("should list a directory's entries with their types", async () => {
			await memoryFs.writeFile("src/app.ts", "");
			await memoryFs.createDirectory("src/components");
			await memoryFs.createDirectory("src/empty");

			await indexService.initialize(["src"]);

			expect(indexService.getEntries("src")).toEqual(
				new Map([
					["app.ts", FileType.File],
					["components", FileType.Directory],
					["empty", FileType.Directory],
				])
			);
			expect(indexService.getEntries("src/empty")).toEqual(new Map());
		});

		it("should reflect applied changes in a directory's entries", async () => {
			await memoryFs.createDirectory("src");
			await indexService.initialize(["src"]);

			indexService.applyChanges([
				{
					type: FileChangeType.ADDED,
					path: "src/new.luau",
					fileType: FileType.File,
				},
			]);

			expect(indexService.getEntries("src")?.get("new.luau")).toBe(
				FileType.File
			);
		});

		it("should accurately track FileType for entries", async () => {
			await memoryFs.writeFile("src/app.ts", "");
			await memoryFs.createDirectory("src/components");

			await indexService.initialize(["src"]);

			expect(indexService.getEntryType("src", "app.ts")).toBe(
				FileType.File
			);
			expect(indexService.getEntryType("src", "components")).toBe(
				FileType.Directory
			);
			expect(
				indexService.getEntryType("src", "missing.ts")
			).toBeUndefined();
		});
	});

	describe("Symbolic links", () => {
		it("should index a linked directory's entries under the link path", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");

			await indexService.initialize(["src"]);

			expect(indexService.getEntryType("src", "Shared")).toBe(
				FileType.Directory | FileType.SymbolicLink
			);
			expect(indexService.getEntries("src/Shared")).toEqual(
				new Map([["a.luau", FileType.File]])
			);
			expect(indexService.getEntries("shared")).toBeUndefined();
		});

		it("should index each of two links to one target separately", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/One");
			await memoryFs.createSymbolicLink("shared", "src/Two");

			await indexService.initialize(["src"]);

			expect(indexService.hasEntry("src/One", "a.luau")).toBe(true);
			expect(indexService.hasEntry("src/Two", "a.luau")).toBe(true);
		});

		it("should record a linked file as a file that is a link", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared/a.luau", "src/A.luau");

			await indexService.initialize(["src"]);

			expect(indexService.getEntryType("src", "A.luau")).toBe(
				FileType.File | FileType.SymbolicLink
			);
		});

		it("should record a link to nothing as only a link", async () => {
			await memoryFs.createSymbolicLink("missing", "src/Broken");

			await indexService.initialize(["src"]);

			expect(indexService.getEntryType("src", "Broken")).toBe(
				FileType.SymbolicLink
			);
		});

		it("should not descend into a link that points at its own parent", async () => {
			await memoryFs.writeFile("src/a.luau", "");
			await memoryFs.createSymbolicLink("src", "src/Loop");

			await indexService.initialize(["src"]);

			expect(indexService.getEntryType("src", "Loop")).toBe(
				FileType.SymbolicLink
			);
			expect(indexService.getEntries("src/Loop")).toBeUndefined();
		});

		it("should not descend into a link that points above the root", async () => {
			await memoryFs.writeFile("repo/src/a.luau", "");
			await memoryFs.createSymbolicLink("repo", "repo/src/Up");

			await indexService.initialize(["repo/src"]);

			expect(indexService.getEntryType("repo/src", "Up")).toBe(
				FileType.SymbolicLink
			);
			expect(indexService.getEntries("repo/src/Up")).toBeUndefined();
		});

		it("should not descend into a link that loops back through another link", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");
			await memoryFs.createSymbolicLink("src", "shared/Back");

			await indexService.initialize(["src"]);

			expect(indexService.hasEntry("src/Shared", "a.luau")).toBe(true);
			expect(indexService.getEntryType("src/Shared", "Back")).toBe(
				FileType.SymbolicLink
			);
			expect(indexService.getEntries("src/Shared/Back")).toBeUndefined();
		});

		it("should drop a removed link and everything indexed under it", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");
			await indexService.initialize(["src"]);

			indexService.applyChanges([
				{
					type: FileChangeType.DELETED,
					path: "src/Shared",
					fileType: FileType.Directory,
				},
			]);

			expect(indexService.hasEntry("src", "Shared")).toBe(false);
			expect(indexService.getEntries("src/Shared")).toBeUndefined();
		});
	});

	describe("File Changes & State Mutations", () => {
		beforeEach(async () => {
			await memoryFs.writeFile("src/core/math.ts", "");
			await indexService.initialize(["src"]);
		});

		it("should insert added files into the topology", () => {
			indexService.applyChanges([
				{
					type: FileChangeType.ADDED,
					path: "src/core/physics.ts",
					fileType: FileType.File,
				},
				{
					type: FileChangeType.ADDED,
					path: "src/core/.server",
					fileType: FileType.File,
				},
			]);

			expect(indexService.hasEntry("src/core", "physics.ts")).toBe(true);
			expect(indexService.hasEntry("src/core", ".server")).toBe(true);
			expect(indexService.getEntryType("src/core", ".server")).toBe(
				FileType.File
			);
		});

		it("should implicitly create parent folders if an added file introduces a new path", () => {
			indexService.applyChanges([
				{
					type: FileChangeType.ADDED,
					path: "src/new_feature/data.ts",
					fileType: FileType.File,
				},
			]);

			expect(indexService.hasEntry("src/new_feature", "data.ts")).toBe(
				true
			);
		});

		it("should remove deleted files from the topology", () => {
			expect(indexService.hasEntry("src/core", "math.ts")).toBe(true);

			indexService.applyChanges([
				{
					type: FileChangeType.DELETED,
					path: "src/core/math.ts",
					fileType: FileType.File,
				},
			]);

			expect(indexService.hasEntry("src/core", "math.ts")).toBe(false);
		});

		it("should cascade delete all nested children when a directory is removed to prevent memory leaks", async () => {
			await memoryFs.writeFile("src/features/inventory/client/ui.ts", "");
			await indexService.initialize(["src"]);

			expect(
				indexService.hasEntry("src/features/inventory/client", "ui.ts")
			).toBe(true);

			indexService.applyChanges([
				{
					type: FileChangeType.DELETED,
					path: "src/features",
					fileType: FileType.Directory,
				},
			]);

			expect(indexService.hasEntry("src", "features")).toBe(false);

			expect(
				indexService.getEntryType("src/features", "inventory")
			).toBeUndefined();
			expect(
				indexService.getEntryType("src/features/inventory", "client")
			).toBeUndefined();
			expect(
				indexService.getEntryType(
					"src/features/inventory/client",
					"ui.ts"
				)
			).toBeUndefined();
		});

		it("should emit an onDidUpdate event when changes are applied", () => {
			const listener = jest.fn();
			indexService.onDidUpdate(listener);

			const changes = [
				{
					type: FileChangeType.ADDED,
					path: "src/temp.ts",
					fileType: FileType.File,
				},
			];
			indexService.applyChanges(changes);

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(changes);
		});
	});
});
