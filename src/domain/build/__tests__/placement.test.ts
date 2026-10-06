import { DisposableStore } from "../../../base/disposable.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { Placement } from "../placement.js";
import {
	abs,
	builderOf,
	configOf,
	indexOf,
	placeFiles,
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

		it("should root the layout at the output's directory", () => {
			const { layout } = prepare({
				outFile: abs("out/game.project.json"),
			}).unwrap();

			expect(layout.projectDir).toBe(abs("out"));
		});

		it("should hold the template rebased to the output's directory", () => {
			const { template } = prepare({ name: "game" }).unwrap();

			expect(template.edit().getTree()).toEqual({
				name: "game",
				tree: { $className: "DataModel" },
			});
		});
	});

	type VariantResult = Pick<Placement, "files" | "leftOut"> & {
		readonly warnings: readonly Diagnostic[];
	};

	const VARIANT_ROUTES = {
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage",
	};

	describe("variants", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const apply = async (
			variants: Record<string, boolean>,
			rootDirs: readonly string[] = [abs("src")]
		) => {
			const config: ResolvedConfig = configOf({
				routes: VARIANT_ROUTES,
				variants,
				rootDirs: [...rootDirs],
			});
			const index = await indexOf(store, fs, rootDirs);
			const builder = builderOf(fs, index);
			const built = await builder.build(config);
			return built.map(({ findings: { warnings } }): VariantResult => {
				const { files, leftOut } = builder.place(config).unwrap();
				return { files, leftOut, warnings };
			});
		};

		const prunedPaths = (result: VariantResult) =>
			[...result.leftOut]
				.filter(([, why]) => why.status === "pruned")
				.map(([source]) => source);

		const instances = async (
			variants: Record<string, boolean>,
			rootDirs?: readonly string[]
		) =>
			(await apply(variants, rootDirs))
				.unwrap()
				.files.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("variant folder", () => {
			it("should move an active variant folder's contents up into the parent", async () => {
				await write("src/Analytics/mock/Service.luau");

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Analytics/Service",
				]);
			});

			it("should prune a dormant variant folder whole", async () => {
				await write(
					"src/Analytics/mock/Service.luau",
					"src/Analytics/mock/deep/Data.luau"
				);

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files).toEqual([]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics/mock/Service.luau"),
					abs("src/Analytics/mock/deep/Data.luau"),
				]);
			});
		});

		describe("marker file", () => {
			it("should apply an active marker below and keep the folder's name", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau"
				);

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Experimental/Save",
				]);
			});

			it("should prune everything below a dormant marker", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau",
					"src/Experimental/deep/Load.luau",
					"src/Other.luau"
				);

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files.map((file) => file.instancePath)).toEqual([
					["ReplicatedStorage", "Other"],
				]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Experimental/Save.luau"),
					abs("src/Experimental/deep/Load.luau"),
				]);
			});
		});

		describe("suffix", () => {
			it("should strip an active suffix from the name", async () => {
				await write("src/Analytics.mock.luau");

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Analytics",
				]);
			});

			it("should prune a file with a dormant suffix silently when it uses a separator", async () => {
				await write("src/Analytics.mock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files).toEqual([]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics.mock.luau"),
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should name the dormant variant that pruned each file, and how it matched", async () => {
				await write("src/Analytics.mock.luau", "src/dev/Save.luau");

				const result = (
					await apply({ mock: false, dev: false })
				).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("src/Analytics.mock.luau"),
							{
								status: "pruned",
								variants: [{ variant: "mock", form: "suffix" }],
							},
						],
						[
							abs("src/dev/Save.luau"),
							{
								status: "pruned",
								variants: [{ variant: "dev", form: "folder" }],
							},
						],
					])
				);
			});

			it("should list every dormant variant a pruned file carries, the first first", async () => {
				await write("src/dev/Analytics.mock.luau");

				const result = (
					await apply({ mock: false, dev: false })
				).unwrap();

				expect(
					result.leftOut.get(abs("src/dev/Analytics.mock.luau"))
				).toEqual({
					status: "pruned",
					variants: [
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
					],
				});
			});

			it("should report the file an active variant replaced", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("src/Analytics.luau"),
							{
								status: "replaced",
								by: abs("src/Analytics.mock.luau"),
							},
						],
					])
				);
			});

			it("should name the file from the last root dir that replaced another", async () => {
				await write("core/Types.luau", "lobby/Types.luau");

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("core/Types.luau"),
							{ status: "replaced", by: abs("lobby/Types.luau") },
						],
					])
				);
			});

			it("should prune models by a dormant suffix too", async () => {
				await write("src/Gun.mock.rbxm");

				expect(
					prunedPaths((await apply({ mock: false })).unwrap())
				).toEqual([abs("src/Gun.mock.rbxm")]);
			});

			it("should prune a file carrying one dormant variant among active ones", async () => {
				await write("src/dev/Save.mock.luau");

				expect(await instances({ dev: true, mock: false })).toEqual([]);
			});
		});

		describe("capital suffix on a dormant variant", () => {
			it("should neither prune nor warn: a capital letter no longer carries a variant", async () => {
				await write("src/HttpMock.luau", "src/DataMock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files.map((file) => file.instancePath)).toEqual([
					["ReplicatedStorage", "DataMock"],
					["ReplicatedStorage", "HttpMock"],
				]);
				expect(prunedPaths(result)).toEqual([]);
				expect(result.warnings).toEqual([]);
			});
		});

		describe("precedence within a root dir", () => {
			it("should let dev/Service.luau beat prod/Service.luau when dev is active", async () => {
				await write("src/Analytics/dev/Service.luau");
				await write("src/Analytics/prod/Service.luau");

				const result = (
					await apply({ dev: true, prod: false })
				).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics/dev/Service.luau"]);
				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/Analytics/Service"]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics/prod/Service.luau"),
				]);
			});

			it("should let a variant file beat a plain one silently", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics.mock.luau"]);
				expect(result.warnings).toEqual([]);
			});

			it("should keep the plain file when the variant is dormant", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics.luau"]);
				expect(result.warnings).toEqual([]);
			});

			it("should fail at each file when two active variants claim one name", async () => {
				await write(
					"src/Analytics.mock.luau",
					"src/Analytics.dev.luau"
				);

				const result = await apply({ mock: true, dev: true });

				expect(
					result.isErr() ? result.error.diagnostics : []
				).toMatchObject([
					{
						severity: DiagnosticSeverity.Error,
						code: "variant.activeClash",
						resource: abs("src/Analytics.dev.luau"),
						message: `becomes "ReplicatedStorage/Analytics" with an active variant, and so does ${abs("src/Analytics.mock.luau")}. Only one can apply: turn a variant off or rename a file.`,
					},
					{
						code: "variant.activeClash",
						resource: abs("src/Analytics.mock.luau"),
					},
				]);
			});

			it("should fail when two files carry the same active variant", async () => {
				await write("src/mock/Service.luau", "src/Service.mock.luau");

				const result = await apply({ mock: true });

				expect(
					result.isErr() ? result.error.diagnostics[0].code : ""
				).toBe("variant.activeClash");
			});

			it("should warn at the plain file left out, naming the one used", async () => {
				await write("src/Types.luau", "src/Types.lua");

				const result = (await apply({})).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Types.luau"]);
				expect(result.warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "tree.instanceClash",
						resource: abs("src/Types.lua"),
						message: `becomes "ReplicatedStorage/Types", as ${abs("src/Types.luau")} does, which takes its place. Rename one of them to keep both.`,
					},
				]);
			});

			it("should name the clash's winner in its own root dir when a later root dir wins", async () => {
				await write(
					"core/Types.luau",
					"core/Types.lua",
					"lobby/Types.luau"
				);

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.warnings).toMatchObject([
					{
						resource: abs("core/Types.lua"),
						message: expect.stringContaining(
							`as ${abs("core/Types.luau")} does`
						),
					},
				]);
			});

			it("should warn at every plain file left out of a clash", async () => {
				await write(
					"src/Types.luau",
					"src/Types.lua",
					"src/Types.json"
				);

				const result = (await apply({})).unwrap();

				expect(result.warnings.map(({ resource }) => resource)).toEqual(
					[abs("src/Types.json"), abs("src/Types.lua")]
				);
			});

			it("should not warn about plain files that lose to a variant one", async () => {
				await write(
					"src/Types.luau",
					"src/Types.lua",
					"src/Types.mock.luau"
				);

				expect((await apply({ mock: true })).unwrap().warnings).toEqual(
					[]
				);
			});
		});

		describe("root dirs", () => {
			it("should let the last root dir win a clash without a warning", async () => {
				await write("core/Save.luau", "lobby/Save.luau");

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.files.map((file) => file.entry.rootDir)).toEqual([
					abs("lobby"),
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should apply the last-root rule after variant precedence", async () => {
				await write("core/Save.mock.luau", "lobby/Save.luau");

				const result = (
					await apply({ mock: true }, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.files.map((file) => file.entry.rootDir)).toEqual([
					abs("lobby"),
				]);
			});

			it("should not treat files in different root dirs as a variant clash", async () => {
				await write("core/Save.mock.luau", "lobby/Save.dev.luau");

				const result = await apply({ mock: true, dev: true }, [
					abs("core"),
					abs("lobby"),
				]);

				expect(result.isOk()).toBe(true);
			});
		});

		describe("warnings", () => {
			it("should warn that a script with a variant after .server becomes a ModuleScript", async () => {
				await write("src/Foo.server.mock.luau");

				const { warnings } = (await apply({ mock: true })).unwrap();

				expect(warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						code: "variant.buriedScriptSuffix",
						resource: abs("src/Foo.server.mock.luau"),
					},
				]);
				expect(warnings[0].message).toContain(".server");
			});

			it("should warn once for an init script copied to several nodes", async () => {
				await write(
					"src/Net/init.plugin.mock.luau",
					"src/Net/Util.luau",
					"src/Net/server/Remote.luau",
					"src/Net/client/Hud.luau"
				);

				const { warnings } = (await apply({ mock: true })).unwrap();

				expect(
					warnings.filter(
						({ code }) => code === "variant.buriedScriptSuffix"
					)
				).toMatchObject([
					{ resource: abs("src/Net/init.plugin.mock.luau") },
				]);
			});

			it("should not warn when the script suffix comes last", async () => {
				await write(
					"src/Foo.mock.server.luau",
					"src/Bar.mock.client.luau"
				);

				expect((await apply({ mock: true })).unwrap().warnings).toEqual(
					[]
				);
			});

			it("should not warn about a dormant file that is pruned anyway", async () => {
				await write("src/Foo.server.mock.luau");

				expect(
					(await apply({ mock: false })).unwrap().warnings
				).toEqual([]);
			});

			it("should keep a suffix that isn't a declared variant in the name, without a warning", async () => {
				await write("src/Foo.beta.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/Foo.beta"]);
				expect(result.warnings).toEqual([]);
			});
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
			const config = configOf({
				routes: ROUTES,
				rootDirs: [abs("src")],
				...overrides,
			});
			const index = await indexOf(store, fs, [abs("src")]);
			const builder = builderOf(fs, index);
			(await builder.build(config)).unwrap();
			const placement = builder.place(config).unwrap();
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
			(await route(overrides)).nodes.map(
				(file) =>
					`${file.entry.source.slice(abs("src").length + 1)} -> ${file.instancePath.join("/")}${file.routeMatch === "copy" ? " (copy)" : ""}`
			);

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

		it("should keep the fallback's own placement of an init script whose copies the template displaces", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			expect(
				await placed({
					template: {
						file: abs("template.project.json"),
						project: {
							name: "game",
							tree: {
								$className: "DataModel",
								ServerScriptService: {
									Net: { $className: "Folder" },
								},
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
				"src/Net/client/init.dev.luau",
				"src/Net/client/Hud.luau"
			);

			const result = await route({ variants: { dev: false } });

			expect(await placed({ variants: { dev: false } })).toEqual([
				"Net/client/Hud.luau -> StarterPlayer/StarterPlayerScripts/Net/Hud",
				"Net/server/init.luau -> ServerScriptService/Net",
				"Net/init.luau -> StarterPlayer/StarterPlayerScripts/Net (copy)",
			]);
			expect(result.leftOut.withStatus("replaced")).toEqual([]);
		});

		it("should say a copy is one", async () => {
			await write("src/Net/init.luau", "src/Net/server/Remote.luau");

			const [, copy] = (await route()).nodes;

			expect([copy.route, copy.routeMatch]).toEqual(["server", "copy"]);
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
			await write("src/Net/init.luau", "src/Net/client/Debug.dev.luau");

			expect(await placed({ variants: { dev: false } })).toEqual([
				"Net/init.luau -> ReplicatedStorage/shared/Net",
			]);
		});

		it("should make an init script with a variant its folder, and let it replace the plain one at every node it is copied to", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/init.mock.luau",
				"src/Net/server/Remote.luau"
			);

			expect(await placed({ variants: { mock: true } })).toEqual([
				"Net/server/Remote.luau -> ServerScriptService/Net/Remote",
				"Net/init.mock.luau -> ServerScriptService/Net (copy)",
			]);
		});
	});
});
