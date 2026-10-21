import {
	errors,
	fs,
	plain,
	resolved,
	selection,
	service,
	start,
	useConfigFixture,
	write,
} from "./config-fixture.js";

const ROUTES = { server: "ServerScriptService", "*": "ReplicatedStorage" };

describe("CoreConfigService places", () => {
	useConfigFixture();

	beforeEach(async () => {
		await fs.createDirectory("/repo/places/shared/src");
		await fs.createDirectory("/repo/places/lobby/src");
		await write("/repo/places/lobby/default.rogen.json", {
			name: "Lobby",
			sourcePaths: ["../shared/src", "src"],
			routes: ROUTES,
		});
	});

	const lobby = (cwd = "/repo/places/lobby") => start({}, cwd);

	it("should read a place as a project of its own folder", async () => {
		await lobby();

		expect(plain(resolved())).toMatchObject({
			file: "/repo/places/lobby/default.rogen.json",
			name: "Lobby",
			projectFile: "/repo/places/lobby/default.project.json",
		});
	});

	it("should list the shared code and then the place's own as source paths", async () => {
		await lobby();

		expect(resolved()?.sourcePaths).toEqual([
			"/repo/places/shared/src",
			"/repo/places/lobby/src",
		]);
	});

	it("should read only what the place's file says", async () => {
		await write("/repo/default.rogen.json", {
			name: "Root",
			routes: { "*": "Workspace" },
			globIgnorePaths: ["**/*.spec.luau"],
		});
		await lobby();

		expect(plain(resolved())).toMatchObject({
			routes: ROUTES,
			ignored: [],
		});
	});

	it("should take servePort, servePlaceIds, placeId and gameId as ordinary keys", async () => {
		await write("/repo/places/lobby/default.rogen.json", {
			name: "Lobby",
			servePort: 34873,
			servePlaceIds: [1],
			placeId: 2,
			gameId: 3,
			routes: ROUTES,
		});
		await lobby();

		expect(errors()).toEqual([]);
		expect(resolved()?.project).toMatchObject({
			servePort: 34873,
			servePlaceIds: [1],
		});
	});

	it("should not number the places: no port is computed", async () => {
		await lobby();

		expect(resolved()?.project.servePort).toBeUndefined();
	});

	it("should say a config at the root no longer lists places", async () => {
		await write("/repo/default.rogen.json", {
			name: "Game",
			placePaths: ["places/*"],
		});
		await start();

		expect(errors()).toMatchObject([
			{
				code: "config.removedField",
				message: expect.stringContaining(
					"A place is a folder with its own complete default.rogen.json. Name the place: rogen serve places/lobby"
				),
			},
		]);
	});

	it("should not read a config in the folders below the one it selected", async () => {
		await write("/repo/default.rogen.json", { name: "Root" });
		await start();

		expect(selection.files).toEqual(new Set(["/repo/default.rogen.json"]));
	});

	it("should fail for the folder of the shared code, which has no config", async () => {
		const result = await start({ names: ["places/shared"] });

		expect(result.isErr()).toBe(true);
		expect((result as { error: Error }).error.message).toContain(
			'No default.rogen.json or default.project.json in "places/shared"'
		);
	});

	it("should fail for a path that does not exist", async () => {
		const result = await start({ names: ["places/lobbby"] });

		expect(result.isErr()).toBe(true);
		expect((result as { error: Error }).error.message).toContain(
			'"places/lobbby" not found'
		);
	});
});

describe("CoreConfigService selectCovering", () => {
	useConfigFixture();

	beforeEach(async () => {
		await fs.createDirectory("/repo/places/shared/src");
		await fs.createDirectory("/repo/places/lobby/src");
		await fs.createDirectory("/repo/places/arena/src");
		for (const name of ["lobby", "arena"])
			await write(`/repo/places/${name}/default.rogen.json`, {
				name,
				sourcePaths: ["../shared/src", "src"],
				routes: ROUTES,
			});
		await start();
	});

	it("should group the paths by the config that covers them, in the order given", async () => {
		const covered = (
			await service.selectCovering([
				"/repo/places/arena/src/A.luau",
				"/repo/places/lobby/src/B.luau",
				"/repo/places/arena/src/C.luau",
			])
		).unwrap();

		expect(
			covered.groups.map(({ selection, indexes, whole }) => ({
				file: selection.entries[0].file,
				indexes,
				whole,
			}))
		).toEqual([
			{
				file: "/repo/places/arena/default.rogen.json",
				indexes: [0, 2],
				whole: false,
			},
			{
				file: "/repo/places/lobby/default.rogen.json",
				indexes: [1],
				whole: false,
			},
		]);
	});

	it("should leave out a path that no config covers, by its position", async () => {
		const covered = (
			await service.selectCovering([
				"/repo/places/shared/src/A.luau",
				"/repo/places/lobby/src/B.luau",
			])
		).unwrap();

		expect(covered.uncovered).toEqual([0]);
		expect(covered.groups).toHaveLength(1);
	});

	it("should mark a config named by its own file as read whole", async () => {
		const covered = (
			await service.selectCovering([
				"/repo/places/lobby/default.rogen.json",
			])
		).unwrap();

		expect(covered.groups[0]).toMatchObject({ whole: true });
	});

	it("should stand the default of the working directory for an undefined target", async () => {
		await start({}, "/repo/places/arena");

		const covered = (await service.selectCovering([undefined])).unwrap();

		expect(covered.groups[0].selection.entries[0].file).toBe(
			"/repo/places/arena/default.rogen.json"
		);
	});

	it("should read the working directory's config once for a path in it and an undefined target", async () => {
		await start({}, "/repo/places/arena");

		const covered = (
			await service.selectCovering([
				undefined,
				"/repo/places/arena/src/A.luau",
			])
		).unwrap();

		expect(covered.groups).toHaveLength(1);
		expect(covered.groups[0].indexes).toEqual([0, 1]);
	});

	it("should fail when the default of the working directory is missing and a target needs it", async () => {
		const result = await service.selectCovering([undefined]);

		expect(result.isErr()).toBe(true);
	});
});
