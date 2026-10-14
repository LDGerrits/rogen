import {
	errors,
	fs,
	plain,
	selection,
	start,
	useConfigFixture,
	write,
} from "./config-fixture.js";
import { buildableProjects } from "../config-service.js";
import { ProjectChoice } from "../project-choice.js";

const ROOT = {
	name: "Game",
	placePaths: ["places/*"],
	tree: {
		$className: "DataModel",
		ReplicatedStorage: { Vendor: { $path: "vendor" } },
	},
	routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
	globIgnorePaths: ["**/*.spec.luau"],
};

describe("CoreConfigService places", () => {
	useConfigFixture();

	const resolve = async (
		root: Record<string, unknown> = ROOT,
		places: Record<string, Record<string, unknown> | null> = {
			lobby: null,
			arena: null,
		}
	) => {
		await write("/repo/rogen.json", root);
		for (const [name, config] of Object.entries(places)) {
			await fs.createDirectory(`/repo/places/${name}`);
			if (config) await write(`/repo/places/${name}/rogen.json`, config);
		}
		await start();
		return buildableProjects(selection.entries[0]);
	};

	const placeNamed = async (
		name: string,
		...args: Parameters<typeof resolve>
	) =>
		(await resolve(...args)).find(
			(config) => config.isPlace && config.projectName === name
		);

	it("should resolve the root and then each place, sorted by path", async () => {
		const found = await resolve();

		expect(found.map(({ projectFile }) => projectFile)).toEqual([
			"/repo/default.project.json",
			"/repo/places/arena/default.project.json",
			"/repo/places/lobby/default.project.json",
		]);
	});

	it("should mark the root as one that has places and the places as places", async () => {
		const found = await resolve();

		expect(found.map(({ hasPlaces }) => hasPlaces)).toEqual([
			true,
			false,
			false,
		]);
		expect(found.map(({ isPlace }) => isPlace)).toEqual([
			false,
			true,
			true,
		]);
		expect(
			found.every(({ rootFile }) => rootFile === "/repo/rogen.json")
		).toBe(true);
	});

	it("should make a folder with no rogen.json a place named after the folder", async () => {
		const lobby = await placeNamed("lobby");

		expect(lobby?.file).toBe("/repo/places/lobby/rogen.json");
		expect(lobby?.projectName).toBe("lobby");
		expect(lobby?.project.getFile()).not.toHaveProperty("name", "Game");
	});

	it("should not hand the root's name to a place, and let a place set its own", async () => {
		const arena = await placeNamed("Arena Royale", ROOT, {
			arena: { name: "Arena Royale" },
		});

		expect(arena?.project.name).toBe("Arena Royale");
	});

	it("should keep a place that sets no name unnamed in its written file", async () => {
		const lobby = await placeNamed("lobby");

		expect(lobby?.project.name).toBeUndefined();
	});

	it("should add a place's own source paths after the root's", async () => {
		const lobby = await placeNamed("lobby");

		expect(lobby?.sourcePaths).toEqual([
			"/repo/src",
			"/repo/places/lobby/src",
		]);
	});

	it("should read a place's sourcePaths as its own folders", async () => {
		const lobby = await placeNamed("lobby", ROOT, {
			lobby: { sourcePaths: ["code", "dev"] },
		});

		expect(lobby?.sourcePaths).toEqual([
			"/repo/src",
			"/repo/places/lobby/code",
			"/repo/places/lobby/dev",
		]);
	});

	it("should keep the root's source paths in a place when the root names them", async () => {
		const lobby = await placeNamed(
			"lobby",
			{ ...ROOT, sourcePaths: ["shared", "common"] },
			{ lobby: null }
		);

		expect(lobby?.sourcePaths).toEqual([
			"/repo/shared",
			"/repo/common",
			"/repo/places/lobby/src",
		]);
	});

	it("should keep the root's source paths in a place's project that replaces them", async () => {
		const found = await resolve(
			{
				...ROOT,
				projects: { release: { sourcePaths: ["dist-shared"] } },
			},
			{ lobby: { projects: { release: { sourcePaths: ["lib"] } } } }
		);
		const release = found.find(
			({ isPlace, stem }) => isPlace && stem === "release"
		);

		expect(release?.sourcePaths).toEqual([
			"/repo/dist-shared",
			"/repo/places/lobby/lib",
		]);
	});

	it("should rebase a $path and a glob of the root to the place's folder", async () => {
		const lobby = await placeNamed("lobby");

		expect(lobby?.project.getFile()).toMatchObject({
			tree: {
				ReplicatedStorage: { Vendor: { $path: "../../vendor" } },
			},
			globIgnorePaths: ["../../**/*.spec.luau"],
		});
		expect(lobby?.ignored).toEqual(["/repo/**/*.spec.luau"]);
	});

	it("should rebase an optional $path", async () => {
		const lobby = await placeNamed("lobby", {
			...ROOT,
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					Vendor: { $path: { optional: "vendor" } },
				},
			},
		});

		expect(lobby?.project.getFile().tree).toMatchObject({
			ReplicatedStorage: {
				Vendor: { $path: { optional: "../../vendor" } },
			},
		});
	});

	it("should leave an absolute $path alone", async () => {
		const lobby = await placeNamed("lobby", {
			...ROOT,
			tree: {
				$className: "DataModel",
				ReplicatedStorage: { Vendor: { $path: "/opt/vendor" } },
			},
		});

		expect(lobby?.project.getFile().tree).toMatchObject({
			ReplicatedStorage: { Vendor: { $path: "/opt/vendor" } },
		});
	});

	it("should rebase the root's syncPath, and let a place set its own", async () => {
		const found = await resolve(
			{ ...ROOT, syncPath: "dist" },
			{ lobby: null, arena: { syncPath: "out" } }
		);
		const syncPaths = found.map(({ syncPath }) => syncPath);

		expect(syncPaths).toEqual([
			"/repo/dist",
			"/repo/places/arena/out",
			"/repo/dist",
		]);
	});

	it("should inherit the root's projects into every place", async () => {
		const found = await resolve(
			{ ...ROOT, projects: { release: { globIgnorePaths: [] } } },
			{ lobby: null }
		);

		expect(found.map(({ projectFile }) => projectFile)).toEqual([
			"/repo/default.project.json",
			"/repo/release.project.json",
			"/repo/places/lobby/default.project.json",
			"/repo/places/lobby/release.project.json",
		]);
	});

	it("should give a place the projects it declares itself", async () => {
		const found = await resolve(ROOT, {
			lobby: { projects: { test: { servePort: 34900 } } },
			arena: null,
		});

		expect(found.map(({ projectFile }) => projectFile)).toEqual([
			"/repo/default.project.json",
			"/repo/places/arena/default.project.json",
			"/repo/places/lobby/default.project.json",
			"/repo/places/lobby/test.project.json",
		]);
	});

	it("should merge a place's routes with the root's by key", async () => {
		const lobby = await placeNamed("lobby", ROOT, {
			lobby: { routes: { client: "StarterPlayer/StarterPlayerScripts" } },
		});

		expect([...(lobby?.routes.keys() ?? [])]).toEqual([
			"server",
			"*",
			"client",
		]);
	});

	it("should let a place null a node of the root's tree", async () => {
		const lobby = await placeNamed("lobby", ROOT, {
			lobby: { tree: { ReplicatedStorage: { Vendor: null } } },
		});

		expect(lobby?.project.getFile().tree).toEqual({
			$className: "DataModel",
			ReplicatedStorage: {},
		});
	});

	it("should write a root with places its own project file", async () => {
		const [root] = await resolve();

		expect(root.projectFile).toBe("/repo/default.project.json");
		expect(root.sourcePaths).toEqual(["/repo/src"]);
	});

	it("should find an exact folder as a place", async () => {
		const found = await resolve(
			{ ...ROOT, placePaths: ["places/lobby"] },
			{ lobby: null, arena: null }
		);

		expect(found.map(({ projectFile }) => projectFile)).toEqual([
			"/repo/default.project.json",
			"/repo/places/lobby/default.project.json",
		]);
	});

	it("should find the places of several globs once each", async () => {
		const found = await resolve(
			{ ...ROOT, placePaths: ["places/*", "places/lobby"] },
			{ lobby: null }
		);

		expect(found.filter(({ isPlace }) => isPlace)).toHaveLength(1);
	});

	it("should find no place in a glob that matches no folder", async () => {
		const found = await resolve({ ...ROOT, placePaths: ["games/*"] }, {});

		expect(found.map(({ isPlace }) => isPlace)).toEqual([false]);
	});

	describe("what a selection reads", () => {
		const files = (configs: readonly { projectFile: string }[]) =>
			configs.map(({ projectFile }) => projectFile);

		it("should read the root and every place from the root", async () => {
			await resolve();
			await start();

			expect(files(selection.configs)).toEqual([
				"/repo/default.project.json",
				"/repo/places/arena/default.project.json",
				"/repo/places/lobby/default.project.json",
			]);
		});

		it("should read only the place from inside it", async () => {
			await resolve();
			await start({}, "/repo/places/lobby");

			expect(files(selection.configs)).toEqual([
				"/repo/places/lobby/default.project.json",
			]);
		});

		it("should read only the places named", async () => {
			await resolve();
			await start({ names: ["places/lobby", "places/arena"] });

			expect(files(selection.configs)).toEqual([
				"/repo/places/arena/default.project.json",
				"/repo/places/lobby/default.project.json",
			]);
		});

		it("should read the project a bare name gives in every place", async () => {
			await resolve(
				{ ...ROOT, projects: { release: {} } },
				{ lobby: null, arena: null }
			);
			await start({ names: ["release"] });

			expect(
				files(ProjectChoice.read(selection.configs, selection.named))
			).toEqual([
				"/repo/release.project.json",
				"/repo/places/arena/release.project.json",
				"/repo/places/lobby/release.project.json",
			]);
		});

		it("should refuse a project that no place and not the root has", async () => {
			await resolve();
			const result = await start({ names: ["nope"] });

			expect(result.isErr()).toBe(true);
		});

		it("should serve the places and never the root", async () => {
			await resolve();
			await start();

			expect(
				files(ProjectChoice.served(selection.configs, selection.named))
			).toEqual([
				"/repo/places/arena/default.project.json",
				"/repo/places/lobby/default.project.json",
			]);
		});

		it("should serve each place's own serveProject", async () => {
			await resolve(
				{ ...ROOT, projects: { dist: {} } },
				{ lobby: { serveProject: "dist" }, arena: null }
			);
			await start();

			expect(
				files(ProjectChoice.served(selection.configs, selection.named))
			).toEqual([
				"/repo/places/arena/default.project.json",
				"/repo/places/lobby/dist.project.json",
			]);
		});
	});

	describe("ports", () => {
		const portsOf = (found: Awaited<ReturnType<typeof resolve>>) =>
			found
				.filter(({ isPlace }) => isPlace)
				.map(({ projectName, placePort }) => [projectName, placePort]);

		it("should number the places by path from 34872", async () => {
			const found = await resolve(ROOT, {
				lobby: null,
				arena: null,
				hub: null,
			});

			expect(portsOf(found)).toEqual([
				["arena", 34872],
				["hub", 34873],
				["lobby", 34874],
			]);
		});

		it("should count only the places that pin no port, and skip a pinned one", async () => {
			const found = await resolve(ROOT, {
				arena: { servePort: 34872 },
				hub: null,
				lobby: null,
			});

			expect(portsOf(found)).toEqual([
				["arena", undefined],
				["hub", 34873],
				["lobby", 34874],
			]);
		});

		it("should skip a port another place pins", async () => {
			const found = await resolve(ROOT, {
				arena: null,
				hub: { servePort: 34873 },
				lobby: null,
			});

			expect(portsOf(found)).toEqual([
				["arena", 34872],
				["hub", undefined],
				["lobby", 34874],
			]);
		});

		it("should skip a port that a project of another place pins", async () => {
			const found = await resolve(ROOT, {
				arena: { projects: { test: { servePort: 34872 } } },
				lobby: null,
			});

			expect(portsOf(found).filter(([, port]) => port)).toEqual([
				["arena", 34873],
				["arena", 34873],
				["lobby", 34874],
			]);
		});

		it("should give the root none", async () => {
			const [root] = await resolve();

			expect(root.placePort).toBeUndefined();
		});
	});

	describe("what is wrong", () => {
		it("should refuse a place that lists places", async () => {
			await resolve(ROOT, { lobby: { placePaths: ["x/*"] } });

			expect(errors()).toEqual([
				expect.objectContaining({
					code: "config.placeListsPlaces",
					resource: "/repo/places/lobby/rogen.json",
				}),
			]);
		});

		it("should refuse a place with an unknown serveProject", async () => {
			await resolve(ROOT, { lobby: { serveProject: "nope" } });

			expect(errors().map(({ code }) => code)).toEqual([
				"config.unknownServeProject",
			]);
		});

		it("should report a broken place's config as the root's error", async () => {
			await resolve(ROOT, { lobby: { sourcePaths: "src" } });

			expect(errors()[0].resource).toBe("/repo/places/lobby/rogen.json");
		});

		it("should refuse a place inside a source path of the root", async () => {
			await resolve({ ...ROOT, placePaths: ["src/places/*"] }, {});
			await fs.createDirectory("/repo/src/places/lobby");
			await start();

			expect(errors().map(({ code }) => code)).toEqual([
				"config.placeInSourcePath",
			]);
		});

		it("should refuse a source path inside a place", async () => {
			await resolve(
				{ ...ROOT, placePaths: ["*"], sourcePaths: ["app/src"] },
				{}
			);
			await fs.createDirectory("/repo/app/src");
			await start();

			expect(errors().map(({ code }) => code)).toEqual([
				"config.placeInSourcePath",
			]);
		});

		it("should plain-read the first place", async () => {
			const found = await resolve();

			expect(plain(found[1])?.file).toBe("/repo/places/arena/rogen.json");
		});
	});
});
