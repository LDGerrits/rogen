import { useConfigFixture, fs, service, write } from "./config-fixture.js";

describe("CoreConfigService.resolveNames", () => {
	useConfigFixture();

	const resolve = async (...args: string[]) =>
		(await service.resolveNames(args)).unwrap();

	it("should keep an argument that is a file on disk", async () => {
		await write("/repo/game.rogen.json", {});
		await fs.writeFile("/repo/src/A.luau", "");

		expect(await resolve("game.rogen.json", "src/A.luau")).toEqual([
			"game.rogen.json",
			"src/A.luau",
		]);
	});

	it("should keep a folder that holds a default config", async () => {
		await write("/repo/dist.rogen.json", {});
		await write("/repo/dist/default.rogen.json", {});

		expect(await resolve("dist")).toEqual(["dist"]);
	});

	it("should read a folder that holds no default as the name of a config", async () => {
		await write("/repo/dist.rogen.json", {});
		await fs.createDirectory("/repo/dist");

		expect(await resolve("dist")).toEqual(["/repo/dist.rogen.json"]);
	});

	it("should keep a folder that holds no default and is no config's name", async () => {
		await fs.createDirectory("/repo/src");

		expect(await resolve("src")).toEqual(["src"]);
	});

	it("should read a name that is not on disk as a config or a project file", async () => {
		await write("/repo/game.rogen.json", {});
		await write("/repo/lobby.project.json", {});

		expect(await resolve("game", "lobby", "New.luau")).toEqual([
			"/repo/game.rogen.json",
			"/repo/lobby.project.json",
			"New.luau",
		]);
	});
});
