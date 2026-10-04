import { jest } from "@jest/globals";
import { FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import { CoreIndexService } from "../core-index-service.js";
import { FileChangeType } from "../file-changes.js";
import { Listing } from "../index-service.js";

describe("CoreIndexService", () => {
	let memoryFs: MemoryFileSystemService;
	let indexService: CoreIndexService;
	let listing: Listing;

	beforeEach(() => {
		memoryFs = new MemoryFileSystemService();
		indexService = new CoreIndexService(memoryFs);
	});

	describe("list", () => {
		it("should recursively map the directory structure into memory", async () => {
			await memoryFs.writeFile("src/main.ts", "");
			await memoryFs.writeFile("src/systems/combat/.server", "");
			await memoryFs.createDirectory("src/empty_folder");

			listing = await indexService.list(["src"]);

			expect(listing.hasEntry("src", "main.ts")).toBe(true);
			expect(listing.hasEntry("src", "systems")).toBe(true);
			expect(listing.hasEntry("src/systems", "combat")).toBe(true);
			expect(listing.hasEntry("src/systems/combat", ".server")).toBe(
				true
			);
			expect(listing.hasEntry("src", "empty_folder")).toBe(true);

			expect(listing.hasEntry("src", "missing.ts")).toBe(false);
		});

		it("should leave a listing as it was while another is listed", async () => {
			await memoryFs.writeFile("old/a.ts", "");
			await memoryFs.writeFile("new/b.ts", "");
			const old = await indexService.list(["old"]);
			await memoryFs.delete("old/a.ts");

			listing = await indexService.list(["new"]);

			expect(old.hasEntry("old", "a.ts")).toBe(true);
			expect(listing.hasEntry("old", "a.ts")).toBe(false);
			expect(listing.hasEntry("new", "b.ts")).toBe(true);
		});

		it("should list a directory inside another only once", async () => {
			await memoryFs.writeFile("src/shared/a.ts", "");
			const readDirectory = jest.spyOn(memoryFs, "readDirectory");

			listing = await indexService.list(["src", "src/shared"]);

			expect(
				readDirectory.mock.calls.filter(([dir]) => dir === "src/shared")
			).toHaveLength(1);
			expect(listing.hasEntry("src/shared", "a.ts")).toBe(true);
		});

		it("should silently ignore directories that throw ENOENT during traversal", async () => {
			listing = await indexService.list(["missing-root"]);

			expect(listing.hasEntry("missing-root", "anything")).toBe(false);
		});

		it("should not index a directory that does not exist", async () => {
			listing = await indexService.list(["missing-root"]);

			expect(listing.getEntries("missing-root")).toBeUndefined();
		});

		it("should list a directory's entries with their types", async () => {
			await memoryFs.writeFile("src/app.ts", "");
			await memoryFs.createDirectory("src/components");
			await memoryFs.createDirectory("src/empty");

			listing = await indexService.list(["src"]);

			expect(listing.getEntries("src")).toEqual(
				new Map([
					["app.ts", FileType.File],
					["components", FileType.Directory],
					["empty", FileType.Directory],
				])
			);
			expect(listing.getEntries("src/empty")).toEqual(new Map());
		});

		it("should reflect applied changes in a directory's entries", async () => {
			await memoryFs.createDirectory("src");
			listing = await indexService.list(["src"]);
			await memoryFs.writeFile("src/new.luau", "");

			listing = await indexService.update(listing, [
				{
					type: FileChangeType.ADDED,
					path: "src/new.luau",
					fileType: FileType.File,
				},
			]);

			expect(listing.getEntries("src")?.get("new.luau")).toBe(
				FileType.File
			);
		});

		it("should accurately track FileType for entries", async () => {
			await memoryFs.writeFile("src/app.ts", "");
			await memoryFs.createDirectory("src/components");

			listing = await indexService.list(["src"]);

			expect(listing.getEntryType("src", "app.ts")).toBe(FileType.File);
			expect(listing.getEntryType("src", "components")).toBe(
				FileType.Directory
			);
			expect(listing.getEntryType("src", "missing.ts")).toBeUndefined();
		});
	});

	describe("Symbolic links", () => {
		it("should index a linked directory's entries under the link path", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");

			listing = await indexService.list(["src"]);

			expect(listing.getEntryType("src", "Shared")).toBe(
				FileType.Directory | FileType.SymbolicLink
			);
			expect(listing.getEntries("src/Shared")).toEqual(
				new Map([["a.luau", FileType.File]])
			);
			expect(listing.getEntries("shared")).toBeUndefined();
		});

		it("should index each of two links to one target separately", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/One");
			await memoryFs.createSymbolicLink("shared", "src/Two");

			listing = await indexService.list(["src"]);

			expect(listing.hasEntry("src/One", "a.luau")).toBe(true);
			expect(listing.hasEntry("src/Two", "a.luau")).toBe(true);
		});

		it("should record a linked file as a file that is a link", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared/a.luau", "src/A.luau");

			listing = await indexService.list(["src"]);

			expect(listing.getEntryType("src", "A.luau")).toBe(
				FileType.File | FileType.SymbolicLink
			);
		});

		it("should record a link to nothing as only a link", async () => {
			await memoryFs.createSymbolicLink("missing", "src/Broken");

			listing = await indexService.list(["src"]);

			expect(listing.getEntryType("src", "Broken")).toBe(
				FileType.SymbolicLink
			);
		});

		it("should not descend into a link that points at its own parent", async () => {
			await memoryFs.writeFile("src/a.luau", "");
			await memoryFs.createSymbolicLink("src", "src/Loop");

			listing = await indexService.list(["src"]);

			expect(listing.getEntryType("src", "Loop")).toBe(
				FileType.SymbolicLink
			);
			expect(listing.getEntries("src/Loop")).toBeUndefined();
		});

		it("should not descend into a link that points above the root", async () => {
			await memoryFs.writeFile("repo/src/a.luau", "");
			await memoryFs.createSymbolicLink("repo", "repo/src/Up");

			listing = await indexService.list(["repo/src"]);

			expect(listing.getEntryType("repo/src", "Up")).toBe(
				FileType.SymbolicLink
			);
			expect(listing.getEntries("repo/src/Up")).toBeUndefined();
		});

		it("should not descend into a link that loops back through another link", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");
			await memoryFs.createSymbolicLink("src", "shared/Back");

			listing = await indexService.list(["src"]);

			expect(listing.hasEntry("src/Shared", "a.luau")).toBe(true);
			expect(listing.getEntryType("src/Shared", "Back")).toBe(
				FileType.SymbolicLink
			);
			expect(listing.getEntries("src/Shared/Back")).toBeUndefined();
		});

		it("should drop a removed link and everything indexed under it", async () => {
			await memoryFs.writeFile("shared/a.luau", "");
			await memoryFs.createSymbolicLink("shared", "src/Shared");
			listing = await indexService.list(["src"]);

			listing = await indexService.update(listing, [
				{
					type: FileChangeType.DELETED,
					path: "src/Shared",
					fileType: FileType.Directory,
				},
			]);

			expect(listing.hasEntry("src", "Shared")).toBe(false);
			expect(listing.getEntries("src/Shared")).toBeUndefined();
		});
	});

	describe("update", () => {
		const rescanOf = async (dirs: string[]) => {
			const fresh = await new CoreIndexService(memoryFs).list(["src"]);
			return dirs.map((dir) => fresh.getEntries(dir));
		};
		const listingOf = (dirs: string[]) =>
			dirs.map((dir) => listing.getEntries(dir));
		const added = (path: string, fileType: FileType) => ({
			type: FileChangeType.ADDED,
			path,
			fileType,
		});

		beforeEach(async () => {
			await memoryFs.writeFile("src/a.luau", "");
			await memoryFs.writeFile("shared/b.luau", "");
			listing = await indexService.list(["src"]);
		});

		it("should record an added link to its own parent as only a link, as a rescan does", async () => {
			await memoryFs.createSymbolicLink("src", "src/Loop");

			listing = await indexService.update(listing, [
				added("src/Loop", FileType.Directory),
				added("src/Loop/a.luau", FileType.File),
			]);

			expect(listingOf(["src", "src/Loop"])).toEqual(
				await rescanOf(["src", "src/Loop"])
			);
			expect(listing.getEntryType("src", "Loop")).toBe(
				FileType.SymbolicLink
			);
		});

		it("should record an added link to nothing as only a link, as a rescan does", async () => {
			await memoryFs.createSymbolicLink("missing", "src/Broken");

			listing = await indexService.update(listing, [
				added("src/Broken", FileType.File),
			]);

			expect(listing.getEntryType("src", "Broken")).toBe(
				FileType.SymbolicLink
			);
		});

		it("should index an added linked directory whole, as a rescan does", async () => {
			await memoryFs.createSymbolicLink("shared", "src/Shared");

			listing = await indexService.update(listing, [
				added("src/Shared", FileType.Directory),
			]);

			expect(listingOf(["src", "src/Shared"])).toEqual(
				await rescanOf(["src", "src/Shared"])
			);
		});

		it("should record an added linked file as a file that is a link", async () => {
			await memoryFs.createSymbolicLink("shared/b.luau", "src/B.luau");

			listing = await indexService.update(listing, [
				added("src/B.luau", FileType.File),
			]);

			expect(listing.getEntryType("src", "B.luau")).toBe(
				FileType.File | FileType.SymbolicLink
			);
		});

		it("should skip an added entry that is gone by the time it applies", async () => {
			listing = await indexService.update(listing, [
				added("src/gone.luau", FileType.File),
			]);

			expect(listing.hasEntry("src", "gone.luau")).toBe(false);
		});

		it("should leave the listing it updates as it was", async () => {
			await memoryFs.writeFile("src/new.luau", "");
			const before = listing;

			listing = await indexService.update(listing, [
				added("src/new.luau", FileType.File),
				{
					type: FileChangeType.DELETED,
					path: "src/a.luau",
					fileType: FileType.File,
				},
			]);

			expect(before.hasEntry("src", "new.luau")).toBe(false);
			expect(before.hasEntry("src", "a.luau")).toBe(true);
			expect(listing.hasEntry("src", "new.luau")).toBe(true);
			expect(listing.hasEntry("src", "a.luau")).toBe(false);
		});
	});

	describe("File Changes & State Mutations", () => {
		beforeEach(async () => {
			await memoryFs.writeFile("src/core/math.ts", "");
			listing = await indexService.list(["src"]);
		});

		it("should insert added files into the topology", async () => {
			await memoryFs.writeFile("src/core/physics.ts", "");
			await memoryFs.writeFile("src/core/.server", "");

			listing = await indexService.update(listing, [
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

			expect(listing.hasEntry("src/core", "physics.ts")).toBe(true);
			expect(listing.hasEntry("src/core", ".server")).toBe(true);
			expect(listing.getEntryType("src/core", ".server")).toBe(
				FileType.File
			);
		});

		it("should implicitly create parent folders if an added file introduces a new path", async () => {
			await memoryFs.writeFile("src/new_feature/data.ts", "");

			listing = await indexService.update(listing, [
				{
					type: FileChangeType.ADDED,
					path: "src/new_feature/data.ts",
					fileType: FileType.File,
				},
			]);

			expect(listing.hasEntry("src/new_feature", "data.ts")).toBe(true);
		});

		it("should remove deleted files from the topology", async () => {
			expect(listing.hasEntry("src/core", "math.ts")).toBe(true);

			listing = await indexService.update(listing, [
				{
					type: FileChangeType.DELETED,
					path: "src/core/math.ts",
					fileType: FileType.File,
				},
			]);

			expect(listing.hasEntry("src/core", "math.ts")).toBe(false);
		});

		it("should cascade delete all nested children when a directory is removed to prevent memory leaks", async () => {
			await memoryFs.writeFile("src/features/inventory/client/ui.ts", "");
			listing = await indexService.list(["src"]);

			expect(
				listing.hasEntry("src/features/inventory/client", "ui.ts")
			).toBe(true);

			listing = await indexService.update(listing, [
				{
					type: FileChangeType.DELETED,
					path: "src/features",
					fileType: FileType.Directory,
				},
			]);

			expect(listing.hasEntry("src", "features")).toBe(false);

			expect(
				listing.getEntryType("src/features", "inventory")
			).toBeUndefined();
			expect(
				listing.getEntryType("src/features/inventory", "client")
			).toBeUndefined();
			expect(
				listing.getEntryType("src/features/inventory/client", "ui.ts")
			).toBeUndefined();
		});
	});
});
