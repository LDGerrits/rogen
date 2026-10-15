import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { UnmountedFiles } from "../unmounted-files.js";

describe("UnmountedFiles", () => {
	let fs: MemoryFileSystemService;

	const find = (
		mounted: string[],
		ignored: string[] = [],
		sourcePaths = ["src"]
	) => new UnmountedFiles(fs, "/repo").find(sourcePaths, mounted, ignored);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
	});

	it("should list the files below a source path that nothing mounts", async () => {
		await fs.writeFile("/repo/src/server/Main.luau", "");
		await fs.writeFile("/repo/src/Loose.luau", "");
		await fs.writeFile("/repo/src/scratch/x.server.luau", "");

		expect(await find(["src/server"])).toEqual([
			"src/Loose.luau",
			"src/scratch/x.server.luau",
		]);
	});

	it("should skip what a mounted file or folder holds", async () => {
		await fs.writeFile("/repo/src/a/b/C.luau", "");
		await fs.writeFile("/repo/src/D.luau", "");

		expect(await find(["src/a", "src/D.luau"])).toEqual([]);
	});

	it("should list nothing when the project mounts the source path itself", async () => {
		await fs.writeFile("/repo/src/A.luau", "");

		expect(await find(["src"])).toEqual([]);
	});

	it("should skip the files that globIgnorePaths ignores", async () => {
		await fs.writeFile("/repo/src/A.spec.luau", "");
		await fs.writeFile("/repo/src/B.luau", "");

		expect(await find([], ["**/*.spec.luau"])).toEqual(["src/B.luau"]);
	});

	it("should skip files Rojo makes no instance of", async () => {
		await fs.writeFile("/repo/src/README.md", "");
		await fs.writeFile("/repo/src/init.meta.json", "{}");

		expect(await find([])).toEqual([]);
	});

	it("should read every source path, and survive one that is missing", async () => {
		await fs.writeFile("/repo/lib/L.luau", "");

		expect(await find([], [], ["src", "lib"])).toEqual(["lib/L.luau"]);
	});
});
