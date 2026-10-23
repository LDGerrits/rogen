import {
	useConfigFixture,
	errors,
	selection,
	start,
	write,
} from "./config-fixture.js";

const ROUTES = { server: "ServerScriptService", "*": "ReplicatedStorage" };

const config = (
	name: string,
	rogen: Record<string, unknown>,
	more: Record<string, unknown> = {}
) => ({
	name,
	tree: { $className: "DataModel" },
	...more,
	rogen: { routes: ROUTES, ...rogen },
});

const codes = (index: number) => errors(index).map(({ code }) => code);

describe("configs of one folder", () => {
	useConfigFixture();

	it("should refuse a config copied and not edited, on both files", async () => {
		const game = config("Game", { sourcePaths: ["src/game"] });
		await write("/repo/game.rogen.json", game);
		await write("/repo/lobby.rogen.json", game);

		await start({ names: ["game", "lobby"] });

		expect(codes(0)).toEqual(["config.identicalConfig"]);
		expect(codes(1)).toEqual(["config.identicalConfig"]);
		expect(errors(1)[0].message).toContain("game.rogen.json");
		expect(errors(1)[0].message).toContain("lobby.rogen.json");
		expect(selection.requireValid().isErr()).toBe(true);
	});

	it("should refuse a config copied with only its sources changed", async () => {
		await write(
			"/repo/game.rogen.json",
			config("Game", { sourcePaths: ["src/game"] })
		);
		await write(
			"/repo/lobby.rogen.json",
			config("Game", { sourcePaths: ["src/lobby"] })
		);

		await start({ names: ["lobby"] });

		expect(codes(0)).toEqual(["config.duplicateName"]);
		expect(errors(0)[0].message).toContain("game.rogen.json");
		expect(errors(0)[0].message).toContain("lobby.rogen.json");
	});

	it("should refuse a config copied with its sources and tree changed but not its name", async () => {
		await write(
			"/repo/game.rogen.json",
			config(
				"Game",
				{ sourcePaths: ["src/common", "src/game"] },
				{
					tree: {
						$className: "DataModel",
						Place: { $path: "place/game" },
					},
				}
			)
		);
		await write(
			"/repo/lobby.rogen.json",
			config(
				"Game",
				{ sourcePaths: ["src/lobby", "src/other"] },
				{
					tree: {
						$className: "DataModel",
						Place: { $path: "place/lobby" },
					},
				}
			)
		);

		await start({ names: ["lobby"] });

		expect(codes(0)).toEqual(["config.duplicateName"]);
	});

	it("should pass a copy that shares one source path with the config it repeats", async () => {
		await write(
			"/repo/game.rogen.json",
			config("Game", { sourcePaths: ["src/common", "src/game"] })
		);
		await write(
			"/repo/lobby.rogen.json",
			config("Game", { sourcePaths: ["./src/common", "src/lobby"] })
		);

		await start({ names: ["lobby"] });

		expect(selection.requireValid().isOk()).toBe(true);
	});

	it("should pass the dist, release and test outputs of one game", async () => {
		const tree = {
			$className: "DataModel",
			ReplicatedStorage: { DevPackages: { $path: "DevPackages" } },
		};
		await write(
			"/repo/default.rogen.json",
			config("Game", { sourcePaths: ["src", "dev"] }, { tree })
		);
		await write(
			"/repo/dist.rogen.json",
			config(
				"Game",
				{ sourcePaths: ["src", "dev"], compiledPath: "dist" },
				{ tree }
			)
		);
		await write(
			"/repo/release.rogen.json",
			config(
				"Game",
				{ sourcePaths: ["src"] },
				{ tree, globIgnorePaths: ["DevPackages/**"] }
			)
		);
		await write(
			"/repo/test.rogen.json",
			config(
				"Game",
				{ sourcePaths: ["src", "tests"] },
				{
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							TestEZ: { $path: "Packages/TestEZ" },
						},
					},
				}
			)
		);

		await start({ names: ["default", "dist", "release", "test"] });

		expect(selection.entries.map((entry) => entry.status)).toEqual([
			"valid",
			"valid",
			"valid",
			"valid",
		]);
	});

	it("should pass two configs that read the same sources under other names", async () => {
		await write(
			"/repo/game.rogen.json",
			config("Game", { sourcePaths: ["src"] })
		);
		await write(
			"/repo/lobby.rogen.json",
			config("Lobby", { sourcePaths: ["src"] })
		);

		await start({ names: ["game", "lobby"] });

		expect(selection.requireValid().isOk()).toBe(true);
	});

	it("should leave a broken sibling to report itself", async () => {
		await write(
			"/repo/game.rogen.json",
			config("Game", { sourcePaths: ["src"] })
		);
		await write("/repo/lobby.rogen.json", "{ nope");

		await start({ names: ["game"] });

		expect(selection.entries[0].status).toBe("valid");
	});

	it("should not compare a Rojo project file", async () => {
		await write("/repo/game.project.json", {
			name: "Game",
			tree: { $className: "DataModel" },
		});
		await write("/repo/lobby.project.json", {
			name: "Game",
			tree: { $className: "DataModel" },
		});

		await start({ names: ["game.project.json", "lobby.project.json"] });

		expect(selection.requireValid().isOk()).toBe(true);
	});

	it("should clear the error when the copy is edited", async () => {
		const game = config("Game", { sourcePaths: ["src/game"] });
		await write("/repo/game.rogen.json", game);
		await write("/repo/lobby.rogen.json", game);
		await start({ names: ["lobby"] });
		await write(
			"/repo/lobby.rogen.json",
			config("Lobby", { sourcePaths: ["src/game"] })
		);

		const reload = await selection.reload(["/repo/lobby.rogen.json"]);

		expect(reload.notices).toEqual([
			{ kind: "recovered", file: "/repo/lobby.rogen.json" },
		]);
	});
});
