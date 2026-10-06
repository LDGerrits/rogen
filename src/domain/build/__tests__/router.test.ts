import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { abs, builderOf, configOf, indexOf, writeFiles } from "./fixtures.js";

describe("Router", () => {
	const ROUTES = {
		ReplicatedFirst: "ReplicatedFirst",
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage/shared",
	};

	describe("route", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs: readonly string[] = [abs("src")]
		) => {
			const config = configOf({
				routes: ROUTES,
				rootDirs: [...rootDirs],
				...overrides,
			});
			const index = await indexOf(store, fs, rootDirs);
			const builder = builderOf(fs, index);
			const built = await builder.build(config);
			return built.map(({ findings: { warnings }, tree }) => {
				const placement = builder.place(config).unwrap();
				return {
					routed: placement.routed,
					leftOut: placement.leftOut,
					globIgnorePaths: tree.globIgnorePaths,
					unrouted: placement.leftOut
						.withStatus("unrouted")
						.map(([source]) => source),
					warnings,
				};
			});
		};

		const paths = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs?: readonly string[]
		) =>
			(await route(overrides, rootDirs))
				.unwrap()
				.routed.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("folder nodes", () => {
			it("should pair each node a folder names with that folder, skipping routing, variant and invisible folders", async () => {
				await write("src/Combat/(group)/server/dev/Moves/Punch.luau");

				const [file] = (
					await route({ variants: { dev: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ServerScriptService",
					"Combat",
					"Moves",
					"Punch",
				]);
				expect(file.folderNodes).toEqual([
					{
						instancePath: ["ServerScriptService", "Combat"],
						dir: "Combat",
					},
					{
						instancePath: [
							"ServerScriptService",
							"Combat",
							"Moves",
						],
						dir: "Combat/(group)/server/dev/Moves",
					},
				]);
			});

			it("should place folder nodes below the route target's own folders", async () => {
				await write("src/Inventory/Types.luau");

				const [file] = (await route()).unwrap().routed;

				expect(file.folderNodes).toEqual([
					{
						instancePath: [
							"ReplicatedStorage",
							"shared",
							"Inventory",
						],
						dir: "Inventory",
					},
				]);
			});
		});

		describe("governing route", () => {
			it("should let a route folder outside a suffix govern, and ignore the suffix", async () => {
				await write("src/ReplicatedFirst/main.client.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/main"]);
			});

			it("should route by suffix when nothing above the file routes", async () => {
				await write("src/Inventory/Hud.client.luau");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Inventory/Hud",
				]);
			});

			it("should strip an @key suffix, and leave a ModuleScript a ModuleScript", async () => {
				await write(
					"src/Inventory/Save@server.luau",
					"src/Inventory/Load@client.luau"
				);

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Inventory/Load",
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should not route by -, _, + or a capital letter", async () => {
				await write(
					"src/Inventory/Combat-server.luau",
					"src/Inventory/Load_server.luau",
					"src/Inventory/Save+server.luau",
					"src/Inventory/PlayerServer.luau",
					"src/Net/HttpClient.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Combat-server",
					"ReplicatedStorage/shared/Inventory/Load_server",
					"ReplicatedStorage/shared/Inventory/PlayerServer",
					"ReplicatedStorage/shared/Inventory/Save+server",
					"ReplicatedStorage/shared/Net/HttpClient",
				]);
			});

			it("should not route .shared, which belongs to Rojo", async () => {
				await write("src/Types.shared.luau");

				expect(
					await paths({
						routes: {
							shared: "ReplicatedStorage",
							"*": "Workspace",
						},
					})
				).toEqual(["Workspace/Types.shared"]);
			});

			it("should not strip a suffix whose letter case differs beyond the first letter", async () => {
				await write(
					"src/Inventory/Load@SERVER.luau",
					"src/Inventory/Saveserver.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Load@SERVER",
					"ReplicatedStorage/shared/Inventory/Saveserver",
				]);
			});

			it("should match a suffix with the first letter of the key in either case", async () => {
				await write(
					"src/Inventory/Load@Server.luau",
					"src/Inventory/Save@Client.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Load",
					"StarterPlayer/StarterPlayerScripts/Inventory/Save",
				]);
			});

			it("should match a lower-case folder and marker against a key declared with a capital", async () => {
				await write(
					"src/server/A.luau",
					"src/Inventory/.server",
					"src/Inventory/B.luau"
				);

				expect(
					await paths({
						routes: {
							Server: "ServerScriptService",
							"*": "Workspace",
						},
					})
				).toEqual([
					"ServerScriptService/Inventory/B",
					"ServerScriptService/A",
				]);
			});

			it("should remove a routing folder and route below it", async () => {
				await write("src/Inventory/server/Save.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should keep a nested route folder as an ordinary folder", async () => {
				await write("src/ReplicatedFirst/client/main.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/client/main"]);
			});

			it("should keep a nested Name@key folder under its written name", async () => {
				await write("src/ReplicatedFirst/Queue@client/main.luau");

				expect(await paths()).toEqual([
					"ReplicatedFirst/Queue@client/main",
				]);
			});

			it("should still hide a nested invisible routing folder", async () => {
				await write("src/ReplicatedFirst/(server)/main.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/main"]);
			});

			it("should let only the governing marker act", async () => {
				await write(
					"src/ReplicatedFirst/Net/.server",
					"src/ReplicatedFirst/Net/main.luau"
				);

				expect(await paths()).toEqual(["ReplicatedFirst/Net/main"]);
			});

			it("should ignore a suffix under an outer routing folder", async () => {
				await write("src/server/Inventory/Hud.client.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Hud",
				]);
			});

			it("should ignore a suffix Rojo doesn't understand but leave it in the name", async () => {
				await write("src/server/Hud-client.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Hud-client",
				]);
			});

			it("should match routing folders and markers with the first letter in either case", async () => {
				await write("src/Server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should treat routing folders that differ beyond the first letter as ordinary", async () => {
				await write("src/SERVER/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/SERVER/Save",
				]);
			});

			it("should only walk from each file's own root dir", async () => {
				await write("places/server/lobby/Hud.luau");

				expect(await paths({}, [abs("places/server/lobby")])).toEqual([
					"ReplicatedStorage/shared/Hud",
				]);
			});

			it("should not treat the root dir's own name as a routing folder", async () => {
				await write("server/Save.luau");

				expect(await paths({}, [abs("server")])).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("marker files", () => {
			it("should route a folder and everything below it, keeping the folder name", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Inventory/deep/Load.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
					"ServerScriptService/Inventory/deep/Load",
				]);
			});

			it("should route everything under a marker in the root dir", async () => {
				await write("src/.server", "src/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should let an outer marker beat a nested marker", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/inner/.client",
					"src/Inventory/inner/Hud.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/inner/Hud",
				]);
			});

			it("should let a folder's name beat its own marker", async () => {
				await write("src/server/.client", "src/server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should ignore dot-files that aren't declared routes", async () => {
				await write("src/.gitkeep", "src/.mock", "src/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("invisible folders", () => {
			it("should treat an invisible folder named after a route as a routing folder", async () => {
				await write("src/Inventory/(server)/Save.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should treat an invisible folder named after a variant as a variant folder", async () => {
				await write("src/Analytics/(mock)/Service.luau");

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Analytics",
					"Service",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "folder" },
				]);
			});

			it("should drop an invisible folder from the path", async () => {
				await write("src/Inventory/(internal)/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Save",
				]);
			});
		});

		describe("paths the template mounts", () => {
			const mounting = (...mounts: [string, string][]) => ({
				template: {
					file: abs("template.project.json"),
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: Object.fromEntries(
								mounts.map(([name, target]) => [
									name,
									{ $path: target },
								])
							),
						},
					},
				},
			});

			it("should leave a mounted folder out of the scan, saying which node mounts it", async () => {
				await write(
					"src/Vendor/Lib/Server/Thing.luau",
					"src/Vendor/Lib@sever.luau",
					"src/Inventory/Save.luau"
				);

				const result = (
					await route(mounting(["Vendor", "src/Vendor"]))
				).unwrap();

				expect(
					result.routed.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/shared/Inventory/Save"]);
				expect(result.leftOut.get(abs("src/Vendor"))).toEqual({
					status: "mounted",
					node: ["ReplicatedStorage", "Vendor"],
				});
				expect(result.warnings).toEqual([]);
			});

			it("should leave out a single mounted file", async () => {
				await write("src/Config.json", "src/Save.luau");

				const result = (
					await route(mounting(["Config", "src/Config.json"]))
				).unwrap();

				expect(
					result.routed.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/shared/Save"]);
			});

			it("should take a mounted path relative to the template's directory", async () => {
				await write("src/Vendor/Lib.luau", "src/Save.luau");
				const config = mounting(["Vendor", "../src/Vendor"]);

				const result = (
					await route({
						template: {
							...config.template,
							file: abs("templates/template.project.json"),
						},
					})
				).unwrap();

				expect(result.leftOut.get(abs("src/Vendor"))).toMatchObject({
					status: "mounted",
				});
			});

			it("should leave a mount outside every root dir alone", async () => {
				await write("src/Save.luau");

				const result = (
					await route(mounting(["Packages", "Packages"]))
				).unwrap();

				expect(result.routed).toHaveLength(1);
			});

			it("should fail when the template mounts a folder inside an init folder, which Rojo reads whole", async () => {
				await write("src/Net/init.luau", "src/Net/Vendor/Lib.luau");

				const result = await route(
					mounting(["Vendor", "src/Net/Vendor"])
				);

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code }) => code)
				).toEqual(["template.mountsInsideInitFolder"]);
			});

			it("should report a mount inside an excluded folder as mounted, and keep the folder out of globIgnorePaths", async () => {
				await write("src/Third/Vendor/Lib.luau", "src/Save.luau");

				const result = (
					await route({
						...mounting(["Vendor", "src/Third/Vendor"]),
						exclude: [abs("src/Third")],
					})
				).unwrap();

				expect(
					result.leftOut.get(abs("src/Third/Vendor"))
				).toMatchObject({
					status: "mounted",
				});
				expect(result.globIgnorePaths ?? []).toEqual([]);
			});

			it("should fail when the template mounts a root dir or a folder above one", async () => {
				await write("src/Save.luau");

				for (const target of ["src", "."]) {
					const result = await route(mounting(["All", target]));

					expect(result.isErr()).toBe(true);
					expect(
						result.isErr() &&
							result.error.diagnostics.map(({ code }) => code)
					).toEqual(["template.mountsRootDir"]);
				}
			});
		});

		describe("targets", () => {
			it("should create every folder of a nested target", async () => {
				await write("src/Hud.client.luau");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Hud",
				]);
			});

			it("should place files at the service root for a bare service target", async () => {
				await write("src/server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should apply the * route when nothing else does", async () => {
				await write("src/Inventory/Types.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Types",
				]);
			});
		});

		describe("suffixes and stacked keys", () => {
			it("should route a script whose route suffix is followed by a variant", async () => {
				await write("src/Foo.server.mock.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ServerScriptService", "Foo"]]);
			});

			it("should strip a variant suffix from the name", async () => {
				await write("src/Foo.mock.server.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ServerScriptService", "Foo"]]);
			});

			it("should route models and data files by suffix and strip it", async () => {
				await write("src/Gun.server.rbxm", "src/Data.client.json");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Data",
					"ServerScriptService/Gun",
				]);
			});

			it("should route a .model.json file by a suffix before .model", async () => {
				await write("src/Gun.server.model.json");

				expect(await paths()).toEqual(["ServerScriptService/Gun"]);
			});

			it("should strip a variant suffix before .model from the name", async () => {
				await write("src/Gun.mock.model.json");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ReplicatedStorage", "shared", "Gun"]]);
				expect(result.unwrap().routed[0].variants).toMatchObject([
					{ variant: "mock" },
				]);
			});

			it("should name a nested project file after the part before .project", async () => {
				await write("src/Outer.project.json");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Outer",
				]);
			});

			it("should leave an ignored suffix on a model in its Rojo name", async () => {
				await write("src/server/Gun.client.rbxm");

				expect(await paths()).toEqual([
					"ServerScriptService/Gun.client",
				]);
			});

			it("should not route on a variant alone", async () => {
				await write("src/Foo.mock.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Foo",
				]);
			});

			it("should leave an undeclared suffix in the name", async () => {
				await write("src/Foo.beta.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Foo.beta",
				]);
			});
		});

		describe("variants", () => {
			const variantsOf = async (
				overrides: ResolvedConfigSpec = { variants: { mock: true } }
			) =>
				(await route(overrides))
					.unwrap()
					.routed.map((file) => file.variants);

			it("should remove a variant folder from the path", async () => {
				await write("src/Analytics/mock/Service.luau");

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Analytics",
					"Service",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "folder" },
				]);
			});

			it("should keep a folder that a variant marker applies to", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau"
				);

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Experimental",
					"Save",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "marker" },
				]);
			});

			it("should apply a marker in the root dir to every file", async () => {
				await write("src/.mock", "src/A/B.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "marker" }],
				]);
			});

			it("should record how a suffix matched", async () => {
				await write("src/Analytics.mock.luau", "src/HttpMock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
					[],
				]);
			});

			it("should record a variant on a script's init file", async () => {
				await write("src/Combat/init.mock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
				]);
			});

			it("should record every variant a file carries", async () => {
				await write("src/dev/Save.mock.luau");

				expect(
					await variantsOf({ variants: { mock: true, dev: true } })
				).toEqual([
					[
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
					],
				]);
			});

			it("should not record a dot-file or folder that is not a declared variant", async () => {
				await write("src/.beta", "src/beta/Save.luau");

				expect(await variantsOf()).toEqual([[]]);
			});

			it("should report a .server that a variant suffix follows", async () => {
				await write(
					"src/Foo.server.mock.luau",
					"src/Bar.mock.server.luau"
				);

				const files = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(files.map((file) => file.buriedScriptSuffix)).toEqual([
					undefined,
					"server",
				]);
			});
		});

		describe("init folders", () => {
			it("should route the folder as one unit named after the folder", async () => {
				await write(
					"src/Inventory/Combat/init.luau",
					"src/Inventory/Combat/Helper.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Combat",
				]);
			});

			it("should route an init folder through its routing ancestors", async () => {
				await write("src/server/Combat/init.luau");

				expect(await paths()).toEqual(["ServerScriptService/Combat"]);
			});

			it("should route an init folder by the suffix on its init script", async () => {
				await write("src/Combat/init.server.luau");

				expect(await paths()).toEqual(["ServerScriptService/Combat"]);
			});
		});

		describe("roots", () => {
			it("should route each root's files from its own root and keep root order", async () => {
				await write("core/server/A.luau", "lobby/server/B.luau");

				expect(await paths({}, [abs("core"), abs("lobby")])).toEqual([
					"ServerScriptService/A",
					"ServerScriptService/B",
				]);
			});

			it("should keep the scanned entry with its routed path", async () => {
				await write("src/server/A.luau");

				const [file] = (await route()).unwrap().routed;

				expect(file.entry).toEqual({
					kind: "script",
					rootDir: abs("src"),
					relativePath: "server/A.luau",
					source: abs("src/server/A.luau"),
				});
			});
		});

		describe("unrouted files", () => {
			const noStar = { routes: { server: "ServerScriptService" } };

			it("should leave files out when there is no * route", async () => {
				await write("src/server/A.luau", "src/B.luau");

				const result = (await route(noStar)).unwrap();

				expect(result.routed.map((file) => file.instancePath)).toEqual([
					["ServerScriptService", "A"],
				]);
			});

			it("should return the unrouted files' source paths", async () => {
				await write("src/server/A.luau", "src/B.luau");

				const result = (await route(noStar)).unwrap();

				expect(result.unrouted).toEqual([abs("src/B.luau")]);
			});

			it("should warn about each file no route governs, at that file", async () => {
				await write("src/A.luau", "src/Inventory/B.luau");

				const warnings = (await route(noStar))
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/A.luau"),
					abs("src/Inventory/B.luau"),
				]);
				expect(warnings[0].message).toContain('"*"');
			});

			it("should list at most ten unrouted files, the last noting how many more weren't", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, n) => `src/F${n + 10}.luau`
					)
				);

				const warnings = (await route(noStar))
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings).toHaveLength(10);
				expect(warnings[9].resource).toBe(abs("src/F19.luau"));
				expect(warnings[9].message).toContain(
					"2 more like it aren't listed"
				);
				expect(warnings[8].message).not.toContain("more like it");
			});

			it("should not warn when every file is routed", async () => {
				await write("src/server/A.luau");

				expect((await route(noStar)).unwrap().warnings).toEqual([]);
			});
		});
	});
});
