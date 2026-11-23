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
	absPosix,
	prepareAndPlace,
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
		isUnreadable: () => false,
	};

	describe("preparing", () => {
		const prepare = (
			overrides: Parameters<typeof configOf>[0] = {},
			index: IndexReader = emptyIndex
		) => placeFiles(index, configOf(overrides), syncTools);

		it("should root the layout at the config's folder", () => {
			const { layout } = prepare({
				file: abs("out/default.rogen.json"),
			}).unwrap();

			expect(layout.projectDir).toEqual(abs("out"));
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
				await prepareAndPlace(
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

		it("should stop the write at the file left out, naming the one used, as the build would lose it", async () => {
			await write("src/Types.luau", "src/Types.lua");

			const result = await apply();

			expect(result.isErr() && result.error.diagnostics).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "tree.instanceClash",
					resource: abs("src/Types.lua"),
					message: `becomes "ReplicatedStorage/Types", like ${abs("src/Types.luau")}, which takes its place. Rename one of them to keep both.`,
					related: [
						{
							resource: abs("src/Types.luau"),
							message:
								'takes its place as "ReplicatedStorage/Types"',
						},
					],
				},
			]);
		});

		it("should name the clash's winner in its own source path when a later source path wins", async () => {
			await write(
				"core/Types.luau",
				"core/Types.lua",
				"lobby/Types.luau"
			);

			const result = await apply([abs("core"), abs("lobby")]);

			expect(result.isErr() && result.error.diagnostics).toMatchObject([
				{
					resource: absPosix("core/Types.lua"),
					message: expect.stringContaining(
						`like ${absPosix("core/Types.luau")},`
					),
				},
			]);
		});

		it("should stop at every file left out of a clash", async () => {
			await write("src/Types.luau", "src/Types.lua", "src/Types.json");

			const result = await apply();

			expect(
				result.isErr() &&
					result.error.diagnostics.map(({ resource }) => resource)
			).toEqual([abs("src/Types.json"), abs("src/Types.lua")]);
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

	describe("plain init scripts", () => {
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
				await prepareAndPlace(
					fs,
					configOf({ routes: ROUTES, ...overrides })
				)
			).unwrap();
			return {
				routed: placement.routed,
				nodes: placement.files,
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

		it("should place an init script no route sends anywhere only where its own route puts it", async () => {
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
			]);
		});

		it("should keep an init script at the fallback when all its folder's other files route elsewhere", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/Inner/init.luau",
				"src/Net/Inner/server/A.luau"
			);

			const result = await route();

			expect(await placed()).toEqual([
				"Net/Inner/init.luau -> ReplicatedStorage/shared/Net/Inner",
				"Net/Inner/server/A.luau -> ServerScriptService/Net/Inner/A",
				"Net/init.luau -> ReplicatedStorage/shared/Net",
			]);
			expect(result.leftOut.count("unrouted")).toBe(0);
		});

		it("should leave an init script unrouted with no fallback route, wherever its folder's other files go", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			const result = await route({
				routes: { server: "ServerScriptService" },
			});

			expect(
				result.routed.map((file) => file.instancePath.join("/"))
			).toEqual(["ServerScriptService/Net/Remote"]);
			expect(result.unrouted).toEqual([abs("src/Net/init.luau")]);
		});

		it("should give each side the init script routed there", async () => {
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

		it("should place an init script a route of its own sends somewhere only there", async () => {
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
				"Net/server/Remote.luau -> ServerScriptService/Net/Remote",
			]);
		});
	});

	describe("files read by the sync rules of the project", () => {
		let fs: MemoryFileSystemService;

		const placed = async (
			files: readonly string[],
			syncRules: readonly object[]
		) => {
			await writeFiles(fs, ...files);
			return (
				await prepareAndPlace(
					fs,
					configOf({
						routes: SHARED_ROUTES,
						project: { tree: {}, syncRules },
					})
				)
			).unwrap();
		};

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		it("should name a file by its rule, and route it by the key in the name that is left", async () => {
			const { placement } = await placed(
				["src/Hud@client.hud", "src/Combat.module"],
				[
					{ pattern: "*.hud", use: "clientScript", suffix: ".hud" },
					{
						pattern: "*.module",
						use: "moduleScript",
						suffix: ".module",
					},
				]
			);

			expect(placedLines(placement.files)).toEqual([
				"Combat.module -> ReplicatedStorage/Combat",
				"Hud@client.hud -> StarterPlayer/StarterPlayerScripts/Hud",
			]);
		});

		it("should route a script by the class its rule's suffix spells, whatever the extension", async () => {
			const { placement } = await placed(
				["src/Main.server.lang", "src/Hud.client.lang"],
				[
					{
						pattern: "*.server.lang",
						use: "serverScript",
						suffix: ".server.lang",
					},
					{
						pattern: "*.client.lang",
						use: "clientScript",
						suffix: ".client.lang",
					},
				]
			);

			expect(placedLines(placement.files)).toEqual([
				"Hud.client.lang -> StarterPlayer/StarterPlayerScripts/Hud",
				"Main.server.lang -> ServerScriptService/Main",
			]);
		});

		it("should leave out a file a rule ignores, and say which rule", async () => {
			const { placement } = await placed(
				["src/Draft.skip", "src/Real.luau"],
				[{ pattern: "*.skip", use: "ignore" }]
			);

			expect(placedLines(placement.files)).toEqual([
				"Real.luau -> ReplicatedStorage/Real",
			]);
			expect(placement.leftOut.get(absPosix("src/Draft.skip"))).toEqual({
				status: "ignored",
				pattern: "*.skip",
			});
		});

		it("should read a file as Rojo does when no rule of the project takes it", async () => {
			const { placement } = await placed(
				["src/Save.server.luau"],
				[{ pattern: "*.module", use: "moduleScript" }]
			);

			expect(placedLines(placement.files)).toEqual([
				"Save.server.luau -> ServerScriptService/Save",
			]);
		});
	});
});
