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
