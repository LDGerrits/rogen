import { toPosix } from "../../../base/path.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { Listing } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import {
	ROUTER_ROUTES as ROUTES,
	abs,
	absPosix,
	configOf,
	indexOf,
	pipelineOf,
	placedLines,
	routeFiles,
	writeFiles,
} from "./fixtures.js";

describe("Router", () => {
	describe("route", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = (
			overrides: ResolvedConfigSpec = {},
			sourcePaths: readonly string[] = [abs("src")]
		) => routeFiles(fs, overrides, sourcePaths);

		const paths = async (
			overrides: ResolvedConfigSpec = {},
			sourcePaths?: readonly string[]
		) =>
			(await route(overrides, sourcePaths))
				.unwrap()
				.routed.map((file) => file.instancePath.join("/"));

		const placedPaths = async () =>
			(
				await pipelineOf(fs, await indexOf(fs, [abs("src")])).place(
					configOf({ routes: ROUTES })
				)
			)
				.unwrap()
				.routed.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("patterns", () => {
			const PATTERNS = {
				...ROUTES,
				"*.tsx": "StarterPlayer/StarterPlayerScripts",
				"*Service.*": "ServerScriptService",
			};

			const routed = async () =>
				(await route({ routes: PATTERNS, compiledPath: abs("out") }))
					.unwrap()
					.routed.map(
						({ instancePath, route, routeMatch }) =>
							`${instancePath.join("/")} · ${route} (${routeMatch})`
					)
					.sort();

			it("should route a file nothing written routes by the pattern its name matches, keeping its name", async () => {
				await write("src/Shop/Hud.tsx", "src/Shop/ShopService.luau");

				expect(await routed()).toEqual([
					"ServerScriptService/Shop/ShopService · *Service.* (pattern)",
					"StarterPlayer/StarterPlayerScripts/Shop/Hud · *.tsx (pattern)",
				]);
			});

			it("should leave a file a folder, @ name or Rojo suffix routes to that route", async () => {
				await write(
					"src/Shop/server/Hud.tsx",
					"src/Shop/Card@server.tsx",
					"src/Shop/Boot.server.tsx"
				);

				expect(await routed()).toEqual([
					"ServerScriptService/Shop/Boot · server (suffix)",
					"ServerScriptService/Shop/Card · server (suffix)",
					"ServerScriptService/Shop/Hud · server (folder)",
				]);
			});

			it("should match the instance a file makes as well as its file name, so a pattern needs no extension", async () => {
				await write(
					"src/Shop/ShopController.luau",
					"src/Shop/Card.story.tsx"
				);

				expect(
					(
						await route({
							compiledPath: abs("out"),
							routes: {
								...ROUTES,
								"*Controller":
									"StarterPlayer/StarterPlayerScripts",
								"*.story": "ReplicatedStorage/Stories",
							},
						})
					)
						.unwrap()
						.routed.map(
							({ instancePath, route }) =>
								`${instancePath.join("/")} · ${route}`
						)
						.sort()
				).toEqual([
					"ReplicatedStorage/Stories/Shop/Card.story · *.story",
					"StarterPlayer/StarterPlayerScripts/Shop/ShopController · *Controller",
				]);
			});

			it("should send a file no pattern matches to *", async () => {
				await write("src/Shop/Types.luau");

				expect(await routed()).toEqual([
					"ReplicatedStorage/shared/Shop/Types · * (fallback)",
				]);
			});

			it("should not match an init script, which is its folder, so the folder's files stay with it", async () => {
				await write(
					"src/Hud/index.tsx",
					"src/Hud/Types.luau",
					"src/Input/InputService/init.luau",
					"src/Input/InputService/Keys.luau",
					"src/Input/InputService/server/Remote.luau"
				);

				expect(await routed()).toEqual([
					"ReplicatedStorage/shared/Hud · * (fallback)",
					"ReplicatedStorage/shared/Hud/Types · * (fallback)",
					"ReplicatedStorage/shared/Input/InputService · * (fallback)",
					"ReplicatedStorage/shared/Input/InputService/Keys · * (fallback)",
					"ServerScriptService/Input/InputService/Remote · server (folder)",
				]);
			});

			it("should not match a nested project by its folder's name", async () => {
				await write("src/ShopService/default.project.json");
				await fs.writeFile(
					abs("src/ShopService/default.project.json"),
					JSON.stringify({
						name: "ShopService",
						tree: { $className: "Folder" },
					})
				);

				expect(await routed()).toEqual([
					"ReplicatedStorage/shared/ShopService · * (fallback)",
				]);
			});

			it("should leave a folder to its init files when one routes itself", async () => {
				await write(
					"src/ShopService/init@server.luau",
					"src/ShopService/init@client.luau",
					"src/ShopService/Types.luau"
				);

				expect(await routed()).toEqual([
					"ReplicatedStorage/shared/ShopService/Types · * (fallback)",
					"ServerScriptService/ShopService · server (suffix)",
					"StarterPlayer/StarterPlayerScripts/ShopService · client (suffix)",
				]);
			});

			it("should match a hoisted file by its name without the ^", async () => {
				await write("src/Shop/^MainHud.luau");

				const [file] = (
					await route({
						routes: { ...ROUTES, "Main*": "ServerScriptService" },
					})
				).unwrap().routed;

				expect(file).toMatchObject({
					instancePath: ["ServerScriptService", "MainHud"],
					route: "Main*",
				});
			});

			it("should not route a folder by a pattern", async () => {
				await write("src/Store.tsx/Cart.luau");

				expect(await routed()).toEqual([
					"ReplicatedStorage/shared/Store.tsx/Cart · * (fallback)",
				]);
			});

			it("should stop on a file that patterns of equal weight send to different places", async () => {
				await write("src/Shop/MainUi.ts");

				const result = await route({
					compiledPath: abs("out"),
					routes: {
						...ROUTES,
						"*Ui.*": "StarterPlayer/StarterPlayerScripts",
						"*.ts": "ServerScriptService",
					},
				});

				expect(
					result.isErr() && result.error.diagnostics
				).toMatchObject([
					{
						code: "route.patternClash",
						resource: abs("src/Shop/MainUi.ts"),
						message:
							'"*.ts" and "*Ui.*" both match this name, are as long as each other, and send it to different places. Lengthen the pattern that should win, or route the file with a folder or an @ name.',
					},
				]);
			});

			it("should stop on each clashing file in order of its path, saying all when more than two patterns clash", async () => {
				await write("src/Z/MainUi.ts", "src/A/MainUi.ts");

				const result = await route({
					compiledPath: abs("out"),
					routes: {
						...ROUTES,
						"*Ui.*": "StarterPlayer/StarterPlayerScripts",
						"*.ts": "ServerScriptService",
						"Mai*": "ReplicatedFirst",
					},
				});

				const clashes = result.isErr() ? result.error.diagnostics : [];
				expect(clashes.map(({ resource }) => resource)).toEqual([
					abs("src/A/MainUi.ts"),
					abs("src/Z/MainUi.ts"),
				]);
				expect(clashes[0].message).toContain(
					"all match this name, are as long as each other"
				);
			});
		});

		describe("hoisted names", () => {
			const CHARACTER = {
				...ROUTES,
				character: "StarterPlayer/StarterCharacterScripts",
			};

			it("should mark an empty folder below a ^ name as hoisted", async () => {
				await write("src/Ui/^Hud/Health.luau");
				await fs.createDirectory(abs("src/Ui/^Hud/Empty"));

				const placement = (
					await pipelineOf(fs, await indexOf(fs, [abs("src")])).place(
						configOf({ routes: CHARACTER })
					)
				).unwrap();

				expect(placement.emptyFolders).toMatchObject([
					{ folder: absPosix("src/Ui/^Hud/Empty"), hoisted: true },
				]);
			});

			it("should land a ^ name at its route's target, dropping every folder between", async () => {
				await write(
					"src/Character/@character",
					"src/Character/^Animate.client.luau",
					"src/Util/^Signal.luau",
					"src/Ui/^Hud/Health.luau",
					"src/Ui/Bar.luau"
				);

				expect((await paths({ routes: CHARACTER })).sort()).toEqual([
					"ReplicatedStorage/shared/Hud/Health",
					"ReplicatedStorage/shared/Signal",
					"ReplicatedStorage/shared/Ui/Bar",
					"StarterPlayer/StarterCharacterScripts/Animate",
				]);
			});

			it("should hoist under a routing folder, a suffix and *, dropping folders above the route too", async () => {
				await write(
					"src/A/server/B/^C.luau",
					"src/A/B/^D@server.luau",
					"src/A@server/B/^E.luau"
				);

				expect((await paths()).sort()).toEqual([
					"ServerScriptService/C",
					"ServerScriptService/D",
					"ServerScriptService/E",
				]);
			});

			it("should leave an unrouted ^ name unrouted", async () => {
				await write("src/A/^B.luau");

				expect(
					(
						await route({
							routes: { server: "ServerScriptService" },
						})
					).unwrap().unrouted
				).toEqual([abs("src/A/^B.luau")]);
			});

			it("should land a ^ name inside a ^ folder at the target, and an invisible ^ folder's contents there", async () => {
				await write(
					"src/A/^B/C/^D.luau",
					"src/A/(^E)/F.luau",
					"src/A/^(G)/H.luau"
				);

				expect((await paths()).sort()).toEqual([
					"ReplicatedStorage/shared/D",
					"ReplicatedStorage/shared/F",
					"ReplicatedStorage/shared/H",
				]);
			});

			it("should say a file was hoisted", async () => {
				await write("src/A/^B.luau", "src/A/C.luau");

				const routed = (await route()).unwrap().routed;

				expect(
					routed.find(
						({ entry }) =>
							entry.source === absPosix("src/A/^B.luau")
					)?.hoisted
				).toBe(true);
				expect(
					routed.find(
						({ entry }) => entry.source === absPosix("src/A/C.luau")
					)?.hoisted
				).toBeUndefined();
			});

			it("should refuse a ^ on an init script, pointing at its folder", async () => {
				await write("src/Net/^init.luau", "src/Net/A.luau");

				const result = await route();

				expect(
					result.isErr() && result.error.diagnostics
				).toMatchObject([
					{ code: "tree.hoistedInit", resource: abs("src/Net") },
				]);
			});

			it("should refuse a ^ init script in a folder that makes no instance as an init with no folder to be, not point at that folder", async () => {
				await write("src/Ui/client/^init.luau", "src/Ui/client/A.luau");

				const result = await route();

				expect(
					result.isErr() && result.error.diagnostics
				).toMatchObject([
					{
						code: "tree.initWithoutFolder",
						resource: abs("src/Ui/client/^init.luau"),
					},
				]);
			});

			it("should say an init script of a ^ folder was hoisted", async () => {
				await write(
					"src/K/^Net/init.luau",
					"src/K/^Net/server/A.luau",
					"src/K/^Net/client/B.luau"
				);

				const init = (await route())
					.unwrap()
					.files.find(
						({ entry }) =>
							entry.source === absPosix("src/K/^Net/init.luau")
					);

				expect(init?.hoisted).toBe(true);
			});

			it("should stop when two ^ names land on one instance, as the build would lose one", async () => {
				await write("src/A/^C.luau", "src/B/^C.luau");

				const result = await route();

				expect(
					result.isErr() && result.error.diagnostics
				).toContainEqual(
					expect.objectContaining({ code: "tree.instanceClash" })
				);
			});
		});

		describe("folder nodes", () => {
			it("should pair each node a folder names with that folder, skipping routing and invisible folders", async () => {
				await write("src/Combat/(group)/server/Moves/Punch.luau");

				const [file] = (await route()).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ServerScriptService",
					"Combat",
					"Moves",
					"Punch",
				]);
				expect(file.folderNodes).toEqual([
					{
						instancePath: ["ServerScriptService", "Combat"],
						folder: `${abs("src")}/Combat`,
					},
					{
						instancePath: [
							"ServerScriptService",
							"Combat",
							"Moves",
						],
						folder: `${abs("src")}/Combat/(group)/server/Moves`,
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
						folder: `${abs("src")}/Inventory`,
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

			it("should strip an @key suffix that Rojo's own suffix of the same route follows", async () => {
				await write(
					"src/Inventory/Save@server.server.luau",
					"src/Inventory/Load@client.client.luau"
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

			it("should not strip a key that ends a name without an @", async () => {
				await write("src/Inventory/Saveserver.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Saveserver",
				]);
			});

			it("should read a folder named for a route in another letter case as a name under a route, or one its own marker routes", async () => {
				await write(
					"src/client/Server/A.luau",
					"src/Client/@server",
					"src/Client/B.luau"
				);

				expect((await paths()).sort()).toEqual([
					"ServerScriptService/Client/B",
					"StarterPlayer/StarterPlayerScripts/Server/A",
				]);
			});

			it("should route Rojo's .server to a key declared with a capital", async () => {
				await write("src/Inventory/Main.server.luau");

				expect(
					await paths({
						routes: {
							Server: "ServerScriptService",
							"*": "Workspace",
						},
					})
				).toEqual(["ServerScriptService/Inventory/Main"]);
			});

			it("should ignore a suffix Rojo doesn't understand but leave it in the name", async () => {
				await write("src/server/Hud-client.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Hud-client",
				]);
			});

			it("should only walk from each file's own source path", async () => {
				await write("places/server/lobby/Hud.luau");

				expect(await paths({}, [abs("places/server/lobby")])).toEqual([
					"ReplicatedStorage/shared/Hud",
				]);
			});

			it("should not treat the source path's own name as a routing folder", async () => {
				await write("server/Save.luau");

				expect(await paths({}, [abs("server")])).toEqual([
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

			it("should drop an invisible folder from the path", async () => {
				await write("src/Inventory/(internal)/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Save",
				]);
			});
		});

		describe("paths the tree mounts", () => {
			const mounting = (...mounts: [string, string][]) => ({
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
				expect(result.leftOut.get(absPosix("src/Vendor"))).toEqual({
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

			it("should take a mounted path relative to the config's folder", async () => {
				await write("place/src/Vendor/Lib.luau", "place/src/Save.luau");

				const result = (
					await route(
						{
							file: abs("place/default.rogen.json"),
							...mounting(["Vendor", "src/Vendor"]),
						},
						[abs("place/src")]
					)
				).unwrap();

				expect(
					result.leftOut.get(absPosix("place/src/Vendor"))
				).toMatchObject({ status: "mounted" });
			});

			it("should leave a mount outside every source path alone", async () => {
				await write("src/Save.luau");

				const result = (
					await route(mounting(["Packages", "Packages"]))
				).unwrap();

				expect(result.routed).toHaveLength(1);
			});

			it("should keep a mount inside a folder with an init script out of what Rojo reads there", async () => {
				await write("src/Net/init.luau", "src/Net/Vendor/Lib.luau");

				const result = (
					await route(mounting(["Vendor", "src/Net/Vendor"]))
				).unwrap();

				expect(
					result.routed.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/shared/Net"]);
				expect(result.globIgnorePaths).toEqual(["src/Net/Vendor"]);
			});

			it("should report a mount inside an ignored folder as mounted, and keep the folder out of globIgnorePaths", async () => {
				await write("src/Third/Vendor/Lib.luau", "src/Save.luau");

				const result = (
					await route({
						...mounting(["Vendor", "src/Third/Vendor"]),
						ignored: [abs("src/Third")],
					})
				).unwrap();

				expect(
					result.leftOut.get(absPosix("src/Third/Vendor"))
				).toMatchObject({
					status: "mounted",
				});
				expect(result.globIgnorePaths ?? []).toEqual([]);
			});

			it("should fail when the tree mounts a source path or a folder above one", async () => {
				await write("src/Save.luau");

				for (const target of ["src", "."]) {
					const result = await route(mounting(["All", target]));

					expect(result.isErr()).toBe(true);
					expect(
						result.isErr() &&
							result.error.diagnostics.map(({ code }) => code)
					).toEqual(["tree.mountsSourcePath"]);
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
			it("should route models and data files by an @ suffix and strip it", async () => {
				await write("src/Gun@server.rbxm", "src/Data@client.json");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Data",
					"ServerScriptService/Gun",
				]);
			});

			it("should leave Rojo's .server and .client in a model's or data file's name, since only a script has a class", async () => {
				await write("src/Gun.server.rbxm", "src/Data.client.json");

				expect(await placedPaths()).toEqual([
					"ReplicatedStorage/shared/Data.client",
					"ReplicatedStorage/shared/Gun.server",
				]);
			});

			it("should route a .model.json file by a suffix before .model", async () => {
				await write("src/Gun@server.model.json");

				expect(await paths()).toEqual(["ServerScriptService/Gun"]);
			});

			it("should name a nested project file after the part before .project", async () => {
				await write("src/Outer.project.json");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Outer",
				]);
			});

			it("should name a nested project file it can't read after the part before .project", async () => {
				const listing = new Listing(
					new Map([
						[
							toPosix(abs("src")),
							new Map([["Gone.project.json", FileType.File]]),
						],
					])
				);

				const placement = (
					await pipelineOf(fs, listing).place(
						configOf({ routes: ROUTES })
					)
				).unwrap();

				expect(
					placement.routed.map(({ instancePath }) =>
						instancePath.join("/")
					)
				).toEqual(["ReplicatedStorage/shared/Gone"]);
			});

			it("should leave an ignored suffix on a model in its Rojo name", async () => {
				await write("src/server/Gun.client.rbxm");

				expect(await placedPaths()).toEqual([
					"ServerScriptService/Gun.client",
				]);
			});

			it("should leave a dot part that is no route in the name", async () => {
				await write("src/Foo.beta.luau", "src/Bar.mock.server.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Bar.mock",
					"ReplicatedStorage/shared/Foo.beta",
				]);
			});
		});

		describe("init folders", () => {
			const placed = async (overrides: ResolvedConfigSpec = {}) =>
				placedLines((await route(overrides)).unwrap().files);

			it("should make an init script its folder and route what sits beside it on its own", async () => {
				await write(
					"src/Inventory/Combat/init.luau",
					"src/Inventory/Combat/Helper.luau"
				);

				expect(await placed()).toEqual([
					"Inventory/Combat/Helper.luau -> ReplicatedStorage/shared/Inventory/Combat/Helper",
					"Inventory/Combat/init.luau -> ReplicatedStorage/shared/Inventory/Combat",
				]);
			});

			it("should route an init folder through its routing ancestors", async () => {
				await write("src/server/Combat/init.luau");

				expect(await paths()).toEqual(["ServerScriptService/Combat"]);
			});

			it("should route only the init script by its route suffix, and what sits beside it on its own", async () => {
				await write(
					"src/Combat/init.server.luau",
					"src/Combat/Moves/Punch.luau",
					"src/Store/init@server.luau",
					"src/Store/Row.luau"
				);

				expect(await placed()).toEqual([
					"Combat/Moves/Punch.luau -> ReplicatedStorage/shared/Combat/Moves/Punch",
					"Combat/init.server.luau -> ServerScriptService/Combat",
					"Store/Row.luau -> ReplicatedStorage/shared/Store/Row",
					"Store/init@server.luau -> ServerScriptService/Store",
				]);
			});

			it("should make each side's init script the folder on that side", async () => {
				await write(
					"src/Feat/init@server.luau",
					"src/Feat/init@client.luau",
					"src/Feat/Save@server.luau",
					"src/Feat/Ui@client.luau"
				);

				expect(await placed()).toEqual([
					"Feat/Save@server.luau -> ServerScriptService/Feat/Save",
					"Feat/Ui@client.luau -> StarterPlayer/StarterPlayerScripts/Feat/Ui",
					"Feat/init@client.luau -> StarterPlayer/StarterPlayerScripts/Feat",
					"Feat/init@server.luau -> ServerScriptService/Feat",
				]);
			});

			it("should warn about an init file of a folder that Rojo doesn't read, wherever their routes send them, as Rojo reads one", async () => {
				await write(
					"src/Feat/init.server.luau",
					"src/Feat/init.client.luau"
				);

				const result = (await route()).unwrap();

				expect(placedLines(result.files)).toEqual([
					"Feat/init.server.luau -> ServerScriptService/Feat",
				]);
				expect(result.warnings).toMatchObject([
					{
						code: "tree.instanceClash",
						resource: abs("src/Feat/init.client.luau"),
						message: expect.stringContaining(
							"name them with @, as init@client.client.luau"
						),
					},
				]);
			});

			it("should make an init script in an invisible or bare @key folder the folder above it", async () => {
				await write(
					"src/Net/@server/init.luau",
					"src/Bots/(impl)/init.luau"
				);

				expect(await placed()).toEqual([
					"Bots/(impl)/init.luau -> ReplicatedStorage/shared/Bots",
					"Net/@server/init.luau -> ServerScriptService/Net",
				]);
			});

			it("should fail for an init script with no folder of its own to be", async () => {
				await write("src/init.luau", "src/server/init.server.luau");

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ code, resource }) => `${code} ${resource}`
						)
				).toEqual([
					`tree.initWithoutFolder ${abs("src/init.luau")}`,
					`tree.initWithoutFolder ${abs("src/server/init.server.luau")}`,
				]);
			});

			it("should read roblox-ts's index as init", async () => {
				await write("src/Lib/index.ts", "src/Lib/Util.ts");

				expect(await placed({ compiledPath: abs("out") })).toEqual([
					"Lib/Util.ts -> ReplicatedStorage/shared/Lib/Util",
					"Lib/index.ts -> ReplicatedStorage/shared/Lib",
				]);
			});

			it("should not read a data file named init, or a name that starts with init, as an init script", async () => {
				await write(
					"src/Config/init.json",
					"src/Config/initialise.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Config/init",
					"ReplicatedStorage/shared/Config/initialise",
				]);
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

				expect(file.entry).toMatchObject({
					kind: "script",
					sourcePath: abs("src"),
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

			it("should leave an init script no route governs unrouted, rather than failing for its missing folder", async () => {
				await write("src/init.luau", "src/server/A.luau");

				const result = (await route(noStar)).unwrap();

				expect(result.unrouted).toEqual([abs("src/init.luau")]);
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
			});

			it("should name the routing folders of the file's feature to move it into", async () => {
				await write(
					"src/A.luau",
					"src/Shop/Secrets.luau",
					"src/Shop/Data/Prices.luau"
				);

				const warnings = (
					await route({
						routes: {
							Server: "ServerScriptService",
							Client: "StarterPlayer/StarterPlayerScripts",
							Shared: "ReplicatedStorage/Shared",
						},
					})
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings.map(({ message }) => message)).toEqual([
					`matched no route, so it is left out. Move it into a routing folder, as ${abs("src/Server")}, end its name with a route's @ suffix (@Server, @Client or @Shared), or declare a "*" route.`,
					`matched no route, so it is left out. Move it into a routing folder, as ${abs("src/Shop/Server")}, end its name with a route's @ suffix (@Server, @Client or @Shared), or declare a "*" route.`,
					`matched no route, so it is left out. Move it into a routing folder, as ${abs("src/Shop/Server")}, end its name with a route's @ suffix (@Server, @Client or @Shared), or declare a "*" route.`,
				]);
			});

			it("should warn about every unrouted file", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, n) => `src/F${n + 10}.luau`
					)
				);

				const warnings = (await route(noStar))
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings).toHaveLength(12);
				expect(warnings[11].resource).toEqual(abs("src/F21.luau"));
				expect(
					warnings.some(({ message }) =>
						message.includes("more like it")
					)
				).toBe(false);
			});

			it("should not warn when every file is routed", async () => {
				await write("src/server/A.luau");

				expect((await route(noStar)).unwrap().warnings).toEqual([]);
			});
		});
	});
});
