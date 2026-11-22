import { FileSystemService } from "../file-system-service.js";
import { instantiationOf } from "../../instantiation/__tests__/instantiation-of.js";
import path from "path";
import { DraftFileReader } from "../draft-file-reader.js";
import { FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";

describe("DraftFileReader", () => {
	const root = path.resolve("/project");
	const at = (...parts: string[]) => path.join(root, ...parts);
	let base: MemoryFileSystemService;

	beforeEach(async () => {
		base = new MemoryFileSystemService();
		await base.writeFile(at("src", "Old.luau"), "old");
		await base.writeFile(at("src", "Kept.luau"), "kept");
	});

	const draftOf = (
		draft: Partial<ConstructorParameters<typeof DraftFileReader>[0]>
	) =>
		instantiationOf([FileSystemService, base]).createInstance(
			DraftFileReader,
			{
				files: new Map(),
				directories: [],
				moves: [],
				...draft,
			}
		);

	it("should read a drafted file over the disk, and the folders above it", async () => {
		const reader = draftOf({
			files: new Map([
				[at("place", "Workspace", "init.meta.json"), "{}"],
			]),
		});

		expect(
			await reader.readFile(at("place", "Workspace", "init.meta.json"))
		).toBe("{}");
		expect(await reader.isDirectory(at("place"))).toBe(true);
		expect(await reader.readDirectory(root)).toEqual([
			["place", FileType.Directory],
			["src", FileType.Directory],
		]);
		expect(await base.exists(at("place"))).toBe(false);
	});

	it("should list a drafted folder that the disk doesn't have as empty", async () => {
		const reader = draftOf({ directories: [at("lib")] });

		expect(await reader.readDirectory(at("lib"))).toEqual([]);
		await expect(reader.readDirectory(at("missing"))).rejects.toThrow(
			"ENOENT"
		);
	});

	it("should read a moved file at its new path only", async () => {
		const reader = draftOf({
			moves: [{ from: at("src", "Old.luau"), to: at("src", "New.luau") }],
		});

		expect(await reader.readFile(at("src", "New.luau"))).toBe("old");
		expect(await reader.exists(at("src", "Old.luau"))).toBe(false);
		expect(await reader.readDirectory(at("src"))).toEqual([
			["Kept.luau", FileType.File],
			["New.luau", FileType.File],
		]);
	});

	it("should make its moves in order, so a file renamed inside a folder moves with the folder renamed after it", async () => {
		const reader = draftOf({
			moves: [
				{ from: at("src", "Old.luau"), to: at("src", "New.luau") },
				{ from: at("src"), to: at("lib") },
			],
		});

		expect(await reader.readFile(at("lib", "New.luau"))).toBe("old");
		expect(await reader.readDirectory(at("lib"))).toEqual([
			["Kept.luau", FileType.File],
			["New.luau", FileType.File],
		]);
		expect(await reader.exists(at("src"))).toBe(false);
	});

	it("should leave out what it removes", async () => {
		const reader = draftOf({ removed: [at("src", "Old.luau")] });

		expect(await reader.exists(at("src", "Old.luau"))).toBe(false);
		expect(await reader.readDirectory(at("src"))).toEqual([
			["Kept.luau", FileType.File],
		]);
	});

	it("should read the bytes of a drafted file, of a file on disk and of a moved file", async () => {
		const reader = draftOf({
			files: new Map([[at("place", "a.txt"), "drafted"]]),
			moves: [{ from: at("src", "Old.luau"), to: at("src", "New.luau") }],
		});
		const text = async (file: string) =>
			new TextDecoder().decode(await reader.readFileBytes(file));

		expect(await text(at("place", "a.txt"))).toBe("drafted");
		expect(await text(at("src", "Kept.luau"))).toBe("kept");
		expect(await text(at("src", "New.luau"))).toBe("old");
		await expect(
			reader.readFileBytes(at("src", "Old.luau"))
		).rejects.toThrow("ENOENT");
	});

	it("should date what it drafts now, and what it doesn't as the disk does", async () => {
		const before = Date.now();
		const reader = draftOf({
			files: new Map([[at("place", "a.txt"), "drafted"]]),
			moves: [{ from: at("src", "Old.luau"), to: at("src", "New.luau") }],
		});

		expect(
			await reader.lastModified(at("place", "a.txt"))
		).toBeGreaterThanOrEqual(before);
		expect(await reader.lastModified(at("place"))).toBeGreaterThanOrEqual(
			before
		);
		expect(await reader.lastModified(at("src", "New.luau"))).toBe(
			await base.lastModified(at("src", "Old.luau"))
		);
		await expect(
			reader.lastModified(at("src", "Old.luau"))
		).rejects.toThrow("ENOENT");
	});

	it("should not read a file it moved away", async () => {
		const reader = draftOf({
			moves: [{ from: at("src", "Old.luau"), to: at("src", "New.luau") }],
		});

		await expect(reader.readFile(at("src", "Old.luau"))).rejects.toThrow(
			"ENOENT"
		);
	});

	it("should refuse every write", async () => {
		const reader = draftOf({});
		const file = at("src", "Kept.luau");

		for (const write of [
			() => reader.createDirectory(),
			() => reader.writeFileBytes(),
			() => reader.copyFile(),
			() => reader.writeFile(),
			() => reader.createFile(),
			() => reader.delete(),
			() => reader.rename(),
		])
			await expect(write()).rejects.toThrow(
				"A draft of files is read-only."
			);
		expect(await base.readFile(file)).toBe("kept");
	});

	it("should list a drafted folder inside one it removes", async () => {
		const reader = draftOf({
			removed: [at("src")],
			directories: [at("src", "lib")],
		});

		expect(await reader.readDirectory(at("src"))).toEqual([
			["lib", FileType.Directory],
		]);
	});

	it("should leave out a moved file that a later change removes or that is not on disk", async () => {
		const reader = draftOf({
			moves: [
				{ from: at("src", "Old.luau"), to: at("lib", "Old.luau") },
				{ from: at("src", "Ghost.luau"), to: at("lib", "Ghost.luau") },
			],
			removed: [at("lib", "Old.luau")],
			directories: [at("lib")],
		});

		expect(await reader.readDirectory(at("lib"))).toEqual([]);
	});

	it("should pass on a failure to list the disk other than a missing folder", async () => {
		const reader = draftOf({});

		await expect(
			reader.readDirectory(at("src", "Kept.luau"))
		).rejects.toThrow("ENOTDIR");
	});
});
