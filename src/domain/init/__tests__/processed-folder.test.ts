import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ProcessedFolder } from "../processed-folder.js";

describe("ProcessedFolder", () => {
	let fs: MemoryFileSystemService;

	const find = (
		mounted: string[],
		sourcePaths = ["src"],
		taken: string[] = []
	) => new ProcessedFolder(fs, "/repo").find(sourcePaths, mounted, taken);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.writeFile("/repo/src/server/Main.server.luau", "");
		await fs.writeFile("/repo/src/shared/Util.luau", "");
	});

	it("should find the folder whose mounts repeat the source path, before it is written", async () => {
		expect(await find(["build/server", "build/shared"])).toBe("build");
	});

	it("should find a folder mounted whole that holds what the source path holds", async () => {
		await fs.writeFile("/repo/dist/server/Main.server.luau", "");

		expect(await find(["dist"])).toBe("dist");
	});

	it("should not take a folder mounted whole that it cannot compare", async () => {
		expect(await find(["dist"])).toBeUndefined();
	});

	it("should not take a folder when one of its mounts has no counterpart", async () => {
		expect(await find(["build/server", "build/assets"])).toBeUndefined();
	});

	it("should not take a source path or a folder another tool writes", async () => {
		expect(await find(["src/server", "out/server"], ["src"], ["out"])).toBe(
			undefined
		);
	});

	it("should repeat several source paths under their common folder", async () => {
		await fs.writeFile("/repo/src/common/A.luau", "");
		await fs.writeFile("/repo/src/game/B.luau", "");

		expect(
			await find(["dist/common", "dist/game"], ["src/common", "src/game"])
		).toBe("dist");
	});

	it("should take none when two folders repeat the source path", async () => {
		expect(await find(["build/server", "dist/shared"])).toBeUndefined();
	});
});
