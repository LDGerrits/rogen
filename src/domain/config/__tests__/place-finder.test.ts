import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { PlaceFinder } from "../place-finder.js";

describe("PlaceFinder folders", () => {
	let fs: MemoryFileSystemService;

	const find = (...globs: string[]) =>
		new PlaceFinder(fs).folders("/repo", globs);

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

describe("PlaceFinder shared code", () => {
	let fs: MemoryFileSystemService;
	const sourcePaths = ["places/shared/src"];

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		for (const dir of ["places/shared/src", "places/game/src"])
			await fs.createDirectory(`/repo/${dir}`);
	});

	it("should leave out a folder a glob matches that holds a source path", async () => {
		const finder = new PlaceFinder(fs);
		expect(
			await finder.folders("/repo", ["places/*"], sourcePaths)
		).toEqual(["/repo/places/game"]);
		expect(
			await finder.sharedFolders("/repo", ["places/*"], sourcePaths)
		).toEqual(["/repo/places/shared"]);
	});

	it("should keep a folder that is named, even when it holds a source path", async () => {
		const finder = new PlaceFinder(fs);
		expect(
			await finder.folders(
				"/repo",
				["places/*", "places/shared"],
				sourcePaths
			)
		).toEqual(["/repo/places/game", "/repo/places/shared"]);
		expect(
			await finder.sharedFolders(
				"/repo",
				["places/*", "places/shared"],
				sourcePaths
			)
		).toEqual([]);
	});

	it("should find every folder when no source path is given", async () => {
		expect(
			await new PlaceFinder(fs).folders("/repo", ["places/*"])
		).toEqual(["/repo/places/game", "/repo/places/shared"]);
	});

	it("should not list the shared folder's root as the config that lists it", async () => {
		await fs.writeFile(
			"/repo/rogen.json",
			JSON.stringify({
				sourcePaths,
				routes: { Server: "ServerScriptService" },
				placePaths: ["places/*"],
			})
		);
		const finder = new PlaceFinder(fs);
		expect(await finder.rootOf("/repo/places/game")).toBe(
			"/repo/rogen.json"
		);
		expect(await finder.rootOf("/repo/places/shared")).toBeUndefined();
	});

	it("should list a named folder with a source path as a place of its root", async () => {
		await fs.writeFile(
			"/repo/rogen.json",
			JSON.stringify({
				sourcePaths,
				placePaths: ["places/shared"],
			})
		);
		expect(await new PlaceFinder(fs).rootOf("/repo/places/shared")).toBe(
			"/repo/rogen.json"
		);
	});
});
