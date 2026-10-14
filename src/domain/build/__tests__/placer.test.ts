import { DisposableStore } from "../../../base/disposable.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { Placement } from "../placement.js";
import {
	abs,
	buildAndPlace,
	configOf,
	placeFiles,
	placedLines,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("Placer", () => {
	const emptyIndex: IndexReader = {
		getEntries: () => undefined,
		hasEntry: () => false,
		getEntryType: () => undefined,
	};

	describe("preparing", () => {
		const prepare = (
			overrides: Parameters<typeof configOf>[0] = {},
			index: IndexReader = emptyIndex
		) => placeFiles(index, configOf(overrides), syncTools);

		it("should root the layout at the config's folder", () => {
			const { layout } = prepare({
				file: abs("out/rogen.json"),
			}).unwrap();

			expect(layout.projectDir).toBe(abs("out"));
		});

		it("should hold the config's tree, and nothing else of its project", () => {
			const { tree } = prepare({
				project: {
					name: "game",
					tree: {
						$className: "DataModel",
						Workspace: { $className: "Workspace" },
					},
				},
			}).unwrap();

			expect(tree.edit().getFile()).toEqual({
				tree: {
					$className: "DataModel",
					Workspace: { $className: "Workspace" },
				},
			});
		});
	});

	type PlaceResult = Pick<Placement, "files" | "leftOut"> & {
		readonly warnings: readonly Diagnostic[];
	};

	const SHARED_ROUTES = {
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage",
	};

	describe("files that share an instance", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const apply = async (sourcePaths: readonly string[] = [abs("src")]) =>
			(
				await buildAndPlace(
					fs,
					configOf({
						routes: SHARED_ROUTES,
						sourcePaths: [...sourcePaths],
					})
				)
			).map(
				({
					placement: { files, leftOut },
					findings: { warnings },
				}): PlaceResult => ({ files, leftOut, warnings })
			);

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		it("should name the file from the last source path that replaced another", async () => {
			await write("core/Types.luau", "lobby/Types.luau");

			const result = (await apply([abs("core"), abs("lobby")])).unwrap();

			expect(new Map(result.leftOut)).toEqual(
				new Map([
					[
						abs("core/Types.luau"),
						{ status: "replaced", by: abs("lobby/Types.luau") },
					],
				])
			);
		});

		it("should warn at the file left out, naming the one used", async () => {
			await write("src/Types.luau", "src/Types.lua");

			const result = (await apply()).unwrap();

			expect(result.files.map((file) => file.entry.relativePath)).toEqual(
				["Types.luau"]
			);
			expect(result.warnings).toEqual([
				{
					severity: DiagnosticSeverity.Warning,
					code: "tree.instanceClash",
					resource: abs("src/Types.lua"),
					message: `becomes "ReplicatedStorage/Types", as ${abs("src/Types.luau")} does, which takes its place. Rename one of them to keep both.`,
				},
			]);
		});

		it("should name the clash's winner in its own source path when a later source path wins", async () => {
			await write(
				"core/Types.luau",
				"core/Types.lua",
				"lobby/Types.luau"
			);

			const result = (await apply([abs("core"), abs("lobby")])).unwrap();

			expect(result.warnings).toMatchObject([
				{
					resource: abs("core/Types.lua"),
					message: expect.stringContaining(
						`as ${abs("core/Types.luau")} does`
					),
				},
			]);
		});

		it("should warn at every file left out of a clash", async () => {
			await write("src/Types.luau", "src/Types.lua", "src/Types.json");

			const result = (await apply()).unwrap();

			expect(result.warnings.map(({ resource }) => resource)).toEqual([
				abs("src/Types.json"),
				abs("src/Types.lua"),
			]);
		});

		it("should let the last source path win a clash without a warning", async () => {
			await write("core/Save.luau", "lobby/Save.luau");

			const result = (await apply([abs("core"), abs("lobby")])).unwrap();

			expect(result.files.map((file) => file.entry.sourcePath)).toEqual([
				abs("lobby"),
			]);
			expect(result.warnings).toEqual([]);
		});

		it("should keep a capital letter in the name and warn of nothing", async () => {
			await write("src/HttpMock.luau", "src/DataMock.luau");

			const result = (await apply()).unwrap();

			expect(result.files.map((file) => file.instancePath)).toEqual([
				["ReplicatedStorage", "DataMock"],
				["ReplicatedStorage", "HttpMock"],
			]);
			expect(result.warnings).toEqual([]);
		});

		it("should not warn when the script suffix comes last", async () => {
			await write("src/Foo.mock.server.luau", "src/Bar.mock.client.luau");

			expect((await apply()).unwrap().warnings).toEqual([]);
		});

		it("should keep a dot part in the name, without a warning", async () => {
			await write("src/Foo.beta.luau");

			const result = (await apply()).unwrap();

			expect(
				result.files.map((file) => file.instancePath.join("/"))
			).toEqual(["ReplicatedStorage/Foo.beta"]);
			expect(result.warnings).toEqual([]);
		});
	});

	describe("copied init scripts", () => {
		const ROUTES = {
			server: "ServerScriptService",
			client: "StarterPlayer/StarterPlayerScripts",
			"*": "ReplicatedStorage/shared",
		};
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = async (overrides: ResolvedConfigSpec = {}) => {
			const { placement } = (
				await buildAndPlace(
					fs,
					configOf({ routes: ROUTES, ...overrides })
				)
			).unwrap();
			return {
				routed: placement.routed,
				nodes: placement.nodes,
				leftOut: placement.leftOut,
				unrouted: placement.leftOut
					.withStatus("unrouted")
					.map(([source]) => source),
			};
		};

		const placed = async (overrides: ResolvedConfigSpec = {}) =>
			placedLines((await route(overrides)).nodes);

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		it("should copy an init script no route sends anywhere to every node its folder becomes", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/Types.luau",
				"src/Net/server/Remote.luau",
				"src/Net/client/Listener.luau"
			);

			expect(await placed()).toEqual([
				"Net/Types.luau -> ReplicatedStorage/shared/Net/Types",
				"Net/client/Listener.luau -> StarterPlayer/StarterPlayerScripts/Net/Listener",
				"Net/init.luau -> ReplicatedStorage/shared/Net",
				"Net/server/Remote.luau -> ServerScriptService/Net/Remote",
				"Net/init.luau -> StarterPlayer/StarterPlayerScripts/Net (copy)",
				"Net/init.luau -> ServerScriptService/Net (copy)",
			]);
		});

		it("should leave out the fallback's own placement of a copied init script that nothing else is left beside", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/server/Remote.luau",
				"src/Net/client/Listener.luau"
			);

			const result = await route();

			expect(await placed()).toEqual([
				"Net/client/Listener.luau -> StarterPlayer/StarterPlayerScripts/Net/Listener",
				"Net/server/Remote.luau -> ServerScriptService/Net/Remote",
				"Net/init.luau -> StarterPlayer/StarterPlayerScripts/Net (copy)",
				"Net/init.luau -> ServerScriptService/Net (copy)",
			]);
			expect(result.leftOut.count("unrouted")).toBe(0);
		});

		it("should leave out the fallback's own placements of nested copied init scripts that nothing else is left beside", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/Inner/init.luau",
				"src/Net/Inner/server/A.luau"
			);

			expect(await placed()).toEqual([
				"Net/Inner/server/A.luau -> ServerScriptService/Net/Inner/A",
				"Net/Inner/init.luau -> ServerScriptService/Net/Inner (copy)",
				"Net/init.luau -> ServerScriptService/Net (copy)",
			]);
		});

		it("should keep the fallback's own placement of an init script whose copies the tree displaces", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			expect(
				await placed({
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ServerScriptService: {
								Net: { $className: "Folder" },
							},
						},
					},
				})
			).toEqual([
				"Net/init.luau -> ReplicatedStorage/shared/Net",
				"Net/server/Remote.luau -> ServerScriptService/Net/Remote",
			]);
		});

		it("should not copy an init script to a node another init script it can be placed with already is", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/server/init.luau",
				"src/Net/client/init.luau",
				"src/Net/client/Hud.luau"
			);

			const result = await route();

			expect(await placed()).toEqual([
				"Net/client/Hud.luau -> StarterPlayer/StarterPlayerScripts/Net/Hud",
				"Net/client/init.luau -> StarterPlayer/StarterPlayerScripts/Net",
				"Net/init.luau -> ReplicatedStorage/shared/Net",
				"Net/server/init.luau -> ServerScriptService/Net",
			]);
			expect(result.leftOut.withStatus("replaced")).toEqual([]);
		});

		it("should say a copy is one", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			const [, copy] = (await route()).nodes;

			expect([copy.route, copy.routeMatch]).toEqual(["server", "copy"]);
		});

		it("should give a copy the folder nodes down to the node it is, and none outranked", async () => {
			await write(
				"src/Net/Inner/init.luau",
				"src/Net/Inner/server/Remote.luau"
			);

			const [, copy] = (await route()).nodes;

			expect(copy.folderNodes.map(({ folder }) => folder)).toEqual([
				`${abs("src")}/Net`,
				`${abs("src")}/Net/Inner`,
			]);
			expect(copy.outrankedFolderRoutes).toEqual([]);
		});

		it("should copy only an init script that is a ModuleScript, since a copied Script runs once per copy", async () => {
			await write("src/Net/init.client.luau", "src/Net/game/Remote.luau");

			expect(
				await placed({
					routes: {
						game: "ServerScriptService",
						"*": "ReplicatedStorage/shared",
					},
				})
			).toEqual([
				"Net/game/Remote.luau -> ServerScriptService/Net/Remote",
				"Net/init.client.luau -> ReplicatedStorage/shared/Net",
			]);
		});

		it("should copy an init script to its folder's nodes even with no fallback route to place it", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			const result = await route({
				routes: { server: "ServerScriptService" },
			});

			expect(
				result.routed.map((file) => file.instancePath.join("/"))
			).toEqual([
				"ServerScriptService/Net/Remote",
				"ServerScriptService/Net",
			]);
			expect(result.unrouted).toEqual([]);
		});

		it("should not copy an init script that a route of its own sends somewhere", async () => {
			await write(
				"src/Net/init@shared.luau",
				"src/Net/server/Remote.luau"
			);

			expect(
				await placed({
					routes: { ...ROUTES, shared: "ReplicatedStorage" },
				})
			).toEqual([
				"Net/init@shared.luau -> ReplicatedStorage/Net",
				"Net/server/Remote.luau -> ReplicatedStorage/Net/server/Remote",
			]);
		});

		it("should copy only to nodes something placed is left at", async () => {
			await write("src/Net/init.luau", "src/Net/client/Debug.luau");

			expect(
				await placed({ ignored: [abs("src/Net/client/Debug.luau")] })
			).toEqual(["Net/init.luau -> ReplicatedStorage/shared/Net"]);
		});
	});
});
