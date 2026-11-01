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
		draft: Partial<ConstructorParameters<typeof DraftFileReader>[1]>
	) =>
		new DraftFileReader(base, {
			files: new Map(),
			directories: [],
			moves: [],
			...draft,
		});

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
});
