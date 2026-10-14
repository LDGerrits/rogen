import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { PlaceFolders } from "../place-folders.js";

describe("PlaceFolders", () => {
	let fs: MemoryFileSystemService;

	const find = (...globs: string[]) => PlaceFolders.find(fs, "/repo", globs);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		for (const dir of [
			"places/lobby/src",
			"places/arena",
			"places/.hidden",
			"places/node_modules",
			"games/a/b",
			"games/c",
		])
			await fs.createDirectory(`/repo/${dir}`);
		await fs.writeFile("/repo/places/readme.md", "");
	});

	it("should find the folders a glob matches, sorted", async () => {
		expect(await find("places/*")).toEqual([
			"/repo/places/arena",
			"/repo/places/lobby",
		]);
	});

	it("should find an exact folder", async () => {
		expect(await find("places/lobby")).toEqual(["/repo/places/lobby"]);
	});

	it("should find nothing for a folder that is not there", async () => {
		expect(await find("places/nope", "nope/*")).toEqual([]);
	});

	it("should find the folders at any depth for **", async () => {
		expect(await find("games/**")).toEqual([
			"/repo/games",
			"/repo/games/a",
			"/repo/games/a/b",
			"/repo/games/c",
		]);
	});

	it("should find a folder once however many globs name it", async () => {
		expect(
			await find("places/*", "places/lobby", "./places/lobby/")
		).toEqual(["/repo/places/arena", "/repo/places/lobby"]);
	});

	it("should not match a file", async () => {
		expect(await find("places/readme.md")).toEqual([]);
	});

	it("should enter no folder that starts with a dot or is node_modules", async () => {
		expect(await find("places/*", "**")).not.toContain(
			"/repo/places/.hidden"
		);
		expect(await find("places/*")).not.toContain(
			"/repo/places/node_modules"
		);
	});
});
