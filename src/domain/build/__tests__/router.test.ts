import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import {
	abs,
	buildAndPlace,
	configOf,
	placedLines,
	writeFiles,
} from "./fixtures.js";

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
		) =>
			(
				await buildAndPlace(
					store,
					fs,
					configOf({
						routes: ROUTES,
						rootDirs: [...rootDirs],
						...overrides,
					})
				)
			).map(({ placement, tree, findings: { warnings } }) => ({
				routed: placement.routed,
				files: placement.files,
				leftOut: placement.leftOut,
				globIgnorePaths: tree.globIgnorePaths,
				unrouted: placement.leftOut
					.withStatus("unrouted")
					.map(([source]) => source),
				warnings,
			}));

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

		describe("hoisted names", () => {
			const CHARACTER = {
				...ROUTES,
				character: "StarterPlayer/StarterCharacterScripts",
			};

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
				await write("src/A/^B/C/^D.luau", "src/A/(^E)/F.luau");

				expect((await paths()).sort()).toEqual([
					"ReplicatedStorage/shared/D",
					"ReplicatedStorage/shared/F",
				]);
			});

			it("should say a file was hoisted", async () => {
				await write("src/A/^B.luau", "src/A/C.luau");

				const routed = (await route()).unwrap().routed;

				expect(
					routed.find(
						({ entry }) => entry.source === abs("src/A/^B.luau")
					)?.hoisted
				).toBe(true);
				expect(
					routed.find(
						({ entry }) => entry.source === abs("src/A/C.luau")
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

			it("should prune a ^ init script whose variant is off, rather than refuse it", async () => {
				await write("src/Net/^init.mock.luau", "src/Net/A.luau");

				const { leftOut } = (
					await route({ variants: { mock: false } })
				).unwrap();

				expect(
					leftOut.get(abs("src/Net/^init.mock.luau"))?.status
				).toBe("pruned");
			});

			it("should say a copied init script of a ^ folder was hoisted", async () => {
				await write(
					"src/K/^Net/init.luau",
					"src/K/^Net/server/A.luau",
					"src/K/^Net/client/B.luau"
				);

				const copies = (await route())
					.unwrap()
					.files.filter(({ routeMatch }) => routeMatch === "copy");

				expect(copies.length).toBeGreaterThan(0);
				expect(copies.every(({ hoisted }) => hoisted)).toBe(true);
			});

			it("should warn when two ^ names land on one instance", async () => {
				await write("src/A/^C.luau", "src/B/^C.luau");

				const { warnings } = (await route()).unwrap();

				expect(warnings).toContainEqual(
					expect.objectContaining({ code: "tree.instanceClash" })
				);
			});
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
						folder: `${abs("src")}/Combat`,
					},
					{
						instancePath: [
							"ServerScriptService",
							"Combat",
							"Moves",
						],
						folder: `${abs("src")}/Combat/(group)/server/dev/Moves`,
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
					"src/Inventory/@server",
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

			it("should still hide a nested invisible routing folder", async () => {
				await write("src/ReplicatedFirst/(server)/main.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/main"]);
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
					"src/Inventory/@server",
					"src/Inventory/Save.luau",
					"src/Inventory/deep/Load.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
					"ServerScriptService/Inventory/deep/Load",
				]);
			});

			it("should route everything under a marker in the root dir", async () => {
				await write("src/@server", "src/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should let an outer marker beat a nested marker that restates it", async () => {
				await write(
					"src/Inventory/@server",
					"src/Inventory/inner/@server",
					"src/Inventory/inner/Hud.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/inner/Hud",
				]);
			});

			it("should refuse two markers that route one folder differently, an init script's suffix among them", async () => {
				await write(
					"src/C/@server",
					"src/C/@client",
					"src/C/X.luau",
					"src/D/@server",
					"src/D/init@client.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ code, resource, message }) => [
								code,
								resource,
								message,
							]
						)
				).toEqual([
					[
						"route.markerClash",
						abs("src/C"),
						'"@client" and "@server" route this folder to different places, and nothing decides between them. Keep one.',
					],
					[
						"route.markerClash",
						abs("src/D"),
						'"@server" and "init@client.luau" route this folder to different places, and nothing decides between them. Keep one.',
					],
				]);
			});

			it("should let markers that agree and variant markers stand together", async () => {
				await write(
					"src/C/@server",
					"src/C/init@server.luau",
					"src/C/.mock",
					"src/C/.dev",
					"src/C/X.luau",
					"src/E/@server",
					"src/E/@Server",
					"src/E/Z.luau"
				);

				const result = (
					await route({
						variants: { mock: true, dev: true },
					})
				).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/C/X",
					"ServerScriptService/C",
					"ServerScriptService/E/Z",
				]);
				expect(result.warnings).toEqual([]);
			});

			it.each([true, false])(
				"should refuse init scripts whose variants route their folder differently, with the variant on or off (mock: %s)",
				async (mock) => {
					await write(
						"src/C/init@server.luau",
						"src/C/init.mock@client.luau",
						"src/C/X.luau"
					);

					const result = await route({ variants: { mock } });

					expect(
						result.isErr() &&
							result.error.diagnostics.map(
								({ code, resource }) => [code, resource]
							)
					).toEqual([["route.markerClash", abs("src/C")]]);
				}
			);

			it("should route an init script's folder by its last @key alone, so two in its name aren't a clash", async () => {
				await write("src/I/init@client@server.luau", "src/I/X.luau");

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
				).toEqual([
					["route.ignoredAt", abs("src/I/init@client@server.luau")],
				]);
			});

			it("should ignore dot-files that aren't declared routes", async () => {
				await write("src/.gitkeep", "src/.mock", "src/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("an @ an outer route outranks", () => {
			const errors = async (overrides: ResolvedConfigSpec = {}) => {
				const result = await route(overrides);
				return result.isErr()
					? result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
					: [];
			};

			it("should refuse it once per file or folder that spells it, on a suffix, a folder, a marker and an init script", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/server/Ui@client/Hud.luau",
					"src/server/Ui@client/Bar.luau",
					"src/server/@client/Probe.luau",
					"src/server/Net/@client",
					"src/server/Net/Remote.luau",
					"src/server/Store/init@client.luau",
					"src/ReplicatedFirst/Queue@client/main.luau"
				);

				expect(await errors()).toEqual([
					[
						"route.ignoredAt",
						abs("src/ReplicatedFirst/Queue@client"),
					],
					["route.ignoredAt", abs("src/server/@client")],
					["route.ignoredAt", abs("src/server/Net/@client")],
					[
						"route.ignoredAt",
						abs("src/server/Store/init@client.luau"),
					],
					["route.ignoredAt", abs("src/server/Ui@client")],
					["route.ignoredAt", abs("src/server/Util@client.luau")],
				]);
			});

			it("should refuse a route before another in one name, on a folder as on a file, bare or not", async () => {
				await write(
					"src/Net@client@server/A.luau",
					"src/@client@server/B.luau",
					"src/Foo@client@server.luau",
					"src/@client@server.luau"
				);

				expect(await errors()).toEqual([
					["route.ignoredAt", abs("src/@client@server")],
					["route.ignoredAt", abs("src/@client@server.luau")],
					["route.ignoredAt", abs("src/Foo@client@server.luau")],
					["route.ignoredAt", abs("src/Net@client@server")],
				]);
			});

			it("should name the route that governs and both fixes", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/server/Ui@client/Hud.luau",
					"src/server/Net/@client",
					"src/server/Net/Remote.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ message }) => message)
				).toEqual([
					'"@client" does nothing here, because the "server" route already governs this folder. Remove it, or move the folder out of the "server" route\'s files.',
					'"@client" does nothing here, because the "server" route already governs this folder. Remove it, or move the folder out of the "server" route\'s files.',
					'"@client" does nothing here, because the "server" route already governs this file. Remove it, or move the file out of the "server" route\'s files.',
				]);
			});

			it("should name every outranked key a name spells in one error", async () => {
				await write(
					"src/server/Util@client@ReplicatedFirst.luau",
					"src/server/Net@client@ReplicatedFirst/A.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ resource, message }) => [resource, message]
						)
				).toEqual([
					[
						abs("src/server/Net@client@ReplicatedFirst"),
						'"@ReplicatedFirst" and "@client" do nothing here, because the "server" route already governs this folder. Remove them, or move the folder out of the "server" route\'s files.',
					],
					[
						abs("src/server/Util@client@ReplicatedFirst.luau"),
						'"@ReplicatedFirst" and "@client" do nothing here, because the "server" route already governs this file. Remove them, or move the file out of the "server" route\'s files.',
					],
				]);
			});

			it("should report it beside a marker clash, leaving the clashing markers to that error", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/C/@server",
					"src/C/@client",
					"src/C/X.luau"
				);

				expect(await errors()).toEqual([
					["route.markerClash", abs("src/C")],
					["route.ignoredAt", abs("src/server/Util@client.luau")],
				]);
			});

			it("should not report a file the template displaces", async () => {
				await write(
					"src/server/Net/@client",
					"src/server/Net/Remote.luau"
				);

				expect(
					await errors({
						template: {
							file: abs("template.project.json"),
							project: {
								name: "game",
								tree: {
									$className: "DataModel",
									ServerScriptService: {
										Net: { $path: "vendor/Net" },
									},
								},
							},
						},
					})
				).toEqual([]);
			});

			it("should not report a file a dormant variant prunes", async () => {
				await write("src/server/Util.mock@client.luau");

				expect(await errors({ variants: { mock: false } })).toEqual([]);
				expect(await errors({ variants: { mock: true } })).toEqual([
					[
						"route.ignoredAt",
						abs("src/server/Util.mock@client.luau"),
					],
				]);
			});

			it("should take an @ that restates the governing route at any depth as that route, silently", async () => {
				await write(
					"src/client/Net/Remote@client.luau",
					"src/client/Ui@client/Hud.luau",
					"src/client/Bar/@client",
					"src/client/Bar/Health.luau",
					"src/client/Store/init@client.luau",
					"src/client/Store/Cart.luau",
					"src/client/@client/Probe.luau",
					"src/Net@server/@server",
					"src/Net@server/Remote.luau"
				);

				const result = (await route()).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Probe",
					"StarterPlayer/StarterPlayerScripts/Bar/Health",
					"StarterPlayer/StarterPlayerScripts/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Store/Cart",
					"StarterPlayer/StarterPlayerScripts/Store",
					"StarterPlayer/StarterPlayerScripts/Ui/Hud",
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should keep a bare folder named after an outranked route as an ordinary folder, silently", async () => {
				await write("src/server/client/Bar.luau");

				const result = (await route()).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ServerScriptService/client/Bar"]);
				expect(result.warnings).toEqual([]);
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

			it("should route models and data files by an @ suffix and strip it", async () => {
				await write("src/Gun@server.rbxm", "src/Data@client.json");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Data",
					"ServerScriptService/Gun",
				]);
			});

			it("should leave Rojo's .server and .client in a model's or data file's name, since only a script has a class", async () => {
				await write("src/Gun.server.rbxm", "src/Data.client.json");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Data.client",
					"ReplicatedStorage/shared/Gun.server",
				]);
			});

			it("should route a .model.json file by a suffix before .model", async () => {
				await write("src/Gun@server.model.json");

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

			it("should keep the name of a Name.variant folder, and prune under it when the variant is off", async () => {
				await write(
					"src/Analytics.mock/Service.luau",
					"src/.mock/Probe.luau"
				);

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Probe",
					"ReplicatedStorage/shared/Analytics/Service",
				]);
				expect(await paths({ variants: { mock: false } })).toEqual([
					"ReplicatedStorage/shared/Probe",
					"ReplicatedStorage/shared/Analytics/Service",
				]);
				expect(
					(await route({ variants: { mock: false } })).unwrap().files
				).toEqual([]);
			});

			it("should route and vary a folder named with both, and take a route that restates an outer one off its name", async () => {
				await write(
					"src/Net.mock@server/Remote.luau",
					"src/client/Hud.mock@client/Bar.luau"
				);

				expect(
					(await route({ variants: { mock: true } }))
						.unwrap()
						.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Hud/Bar",
				]);
			});

			it("should apply every key of a folder named by keys alone, in either order, and leave no folder", async () => {
				await write(
					"src/D/.mock@server/A.luau",
					"src/E/@server.mock/B.luau",
					"src/F/.mock.dev/C.luau",
					"src/G/mock@server/D.luau"
				);
				const placed = async (variants: Record<string, boolean>) =>
					(await route({ variants }))
						.unwrap()
						.files.map((file) => file.instancePath.join("/"));

				expect(await placed({ mock: true, dev: true })).toEqual([
					"ServerScriptService/D/A",
					"ServerScriptService/E/B",
					"ReplicatedStorage/shared/F/C",
					"ServerScriptService/G/mock/D",
				]);
				expect(await placed({ mock: false, dev: true })).toEqual([
					"ServerScriptService/G/mock/D",
				]);
			});

			it("should leave no folder for a key-only folder that restates its route, and hoist one that takes a ^", async () => {
				await write(
					"src/server/.mock@server/A.luau",
					"src/Feature/^.mock@server/B.luau",
					"src/Other/(.mock@server)/C.luau"
				);

				const result = (
					await route({ variants: { mock: true } })
				).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/B",
					"ServerScriptService/Other/C",
					"ServerScriptService/A",
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should refuse a key-only folder whose route an outer route outranks", async () => {
				await write("src/server/.mock@client/A.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
				).toEqual([
					["route.ignoredAt", abs("src/server/.mock@client")],
				]);
			});

			it("should make an init script in a key-only folder the folder above, and refuse one with no folder above", async () => {
				await write("src/Net/.mock@server/init.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ServerScriptService/Net",
				]);

				await write("src/.mock@server/init.luau");
				const result = await route({ variants: { mock: true } });

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code }) => code)
				).toEqual(["tree.initWithoutFolder"]);
			});

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

			it("should route the folder by the route suffix on its init script, as a marker beside it would", async () => {
				await write(
					"src/Combat/init.server.luau",
					"src/Combat/Moves/Punch.luau",
					"src/Store/init@server.luau",
					"src/Store/Row.luau"
				);

				const files = (await route()).unwrap().routed;

				expect(
					files.map(
						(file) =>
							`${file.instancePath.join("/")} · ${file.routeMatch}`
					)
				).toEqual([
					"ServerScriptService/Combat/Moves/Punch · init",
					"ServerScriptService/Combat · suffix",
					"ServerScriptService/Store/Row · init",
					"ServerScriptService/Store · suffix",
				]);
			});

			it("should route the folder by its init scripts whichever variants are on, so a variant swaps the script without moving what sits beside it", async () => {
				await write(
					"src/Combat/init.luau",
					"src/Combat/init.mock.server.luau",
					"src/Combat/Helper.luau"
				);

				expect(await placed({ variants: { mock: false } })).toEqual([
					"Combat/Helper.luau -> ServerScriptService/Combat/Helper",
					"Combat/init.luau -> ServerScriptService/Combat",
				]);
				expect(await placed({ variants: { mock: true } })).toEqual([
					"Combat/Helper.luau -> ServerScriptService/Combat/Helper",
					"Combat/init.mock.server.luau -> ServerScriptService/Combat",
				]);
			});

			it("should make an init script in a variant or invisible folder the folder above it", async () => {
				await write(
					"src/Net/dev/init.luau",
					"src/Bots/(impl)/init.luau"
				);

				expect(await placed({ variants: { dev: true } })).toEqual([
					"Bots/(impl)/init.luau -> ReplicatedStorage/shared/Bots",
					"Net/dev/init.luau -> ReplicatedStorage/shared/Net",
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

			it("should not fail for an init script with no folder that a dormant variant prunes", async () => {
				await write("src/init.mock.luau", "src/Save.luau");

				expect(await paths({ variants: { mock: false } })).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});

			it("should read roblox-ts's index as init", async () => {
				await write("src/Lib/index.ts", "src/Lib/Util.ts");

				expect(await placed()).toEqual([
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
				expect(warnings[0].message).toContain('"*"');
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
				expect(warnings[11].resource).toBe(abs("src/F21.luau"));
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
