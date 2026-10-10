import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { BuildValidator } from "../build-validator.js";
import { MetaReader } from "../meta-reader.js";
import { TreeAssembler } from "../tree-assembler.js";
import {
	abs,
	buildAndPlace,
	configOf,
	configOf as baseConfigOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("BuildValidator", () => {
	describe("validate", () => {
		let fs: MemoryFileSystemService;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		it("should report rules in a fixed order, whatever order the problems arose in", async () => {
			await writeFiles(fs, "src/Orphan.meta.json", "src/Stray.luau");
			const config = baseConfigOf({
				rootDirs: [abs("src"), abs("missing")],
				routes: { server: "ServerScriptService" },
			});
			const index = await indexOf(fs, config.rootDirs);
			const placement = placeFiles(index, config, syncTools).unwrap();
			const meta = (await new MetaReader(fs).read(placement)).unwrap();
			const assembled = new TreeAssembler(placement, meta)
				.assemble()
				.unwrap();

			const warnings = new BuildValidator(assembled).validate();

			expect(warnings.map(({ code }) => code)).toEqual([
				"scan.missingRootDir",
				"meta.unclaimed",
				"route.unrouted",
			]);
		});

		it("should report nothing for a build that raises no problems", async () => {
			await writeFiles(fs, "src/Fine.luau");
			const config = baseConfigOf();
			const index = await indexOf(fs, config.rootDirs);
			const placement = placeFiles(index, config, syncTools).unwrap();
			const meta = (await new MetaReader(fs).read(placement)).unwrap();
			const assembled = new TreeAssembler(placement, meta)
				.assemble()
				.unwrap();

			expect(new BuildValidator(assembled).validate()).toEqual([]);
		});
	});
});

describe("BuildValidator rules", () => {
	const at = (...segments: string[]) => toPosix(abs(...segments));
	const ROUTES = {
		ReplicatedFirst: "ReplicatedFirst",
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage/shared",
	};

	describe("rules", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs: readonly string[] = [abs("src")]
		) =>
			(
				await buildAndPlace(
					fs,
					configOf({
						routes: ROUTES,
						rootDirs: [...rootDirs],
						...overrides,
					})
				)
			).map(({ placement, tree, findings: { warnings } }) => ({
				routed: placement.routed,
				leftOut: placement.leftOut,
				globIgnorePaths: tree.globIgnorePaths,
				unrouted: placement.leftOut
					.withStatus("unrouted")
					.map(([source]) => source),
				warnings,
			}));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("a root dir named after a key", () => {
			const named = async (
				rootDirs: string[],
				overrides: ResolvedConfigSpec = {}
			) =>
				(
					await route(
						overrides,
						rootDirs.map((dir) => abs(dir))
					)
				)
					.unwrap()
					.warnings.filter(
						({ code }) => code === "scan.rootDirNamedAfterKey"
					);

			beforeEach(async () => {
				await write(
					"server/Save.luau",
					"client/Hud.luau",
					"src/server/Net.luau",
					"mock/Fake.luau"
				);
			});

			it("should warn once for every root dir at the project root, with the move-them fix", async () => {
				const [warning] = await named(["server", "client"]);

				expect(warning).toMatchObject({
					severity: DiagnosticSeverity.Warning,
					resource: abs("default.rogen.json"),
					related: [
						{
							resource: abs("server"),
							message: 'named after the "server" route',
						},
						{
							resource: abs("client"),
							message: 'named after the "client" route',
						},
					],
				});
				expect(warning.message.split("\n")).toEqual([
					"2 root dirs are named after a route key, but routing starts below a root dir, so their names route nothing:",
					'  server ("server" route)',
					'  client ("client" route)',
					'Move them into one folder, such as src/server and src/client, and use "rootDirs": ["src"].',
				]);
			});

			it("should say to use the parent when the root dir sits inside the project", async () => {
				const [warning] = await named(["src/server"]);

				expect(warning.message.split("\n")).toEqual([
					"1 root dir is named after a route key, but routing starts below a root dir, so its name routes nothing:",
					'  src/server ("server" route)',
					'Use "src" as the root dir instead, so "server" is read as a key.',
				]);
			});

			it("should fall back to moving the root dir into one folder when its parent is outside the project", async () => {
				const [warning] = await named(["../outside/server"]);

				expect(warning.message.split("\n")).toEqual([
					"1 root dir is named after a route key, but routing starts below a root dir, so its name routes nothing:",
					'  ../outside/server ("server" route)',
					'Move it into one folder, such as src/../outside/server, and use "rootDirs": ["src"].',
				]);
			});

			it("should not warn when the root dir holds a folder named after a key", async () => {
				expect(await named(["src"])).toEqual([]);
			});

			it("should read the name with its first letter in either case", async () => {
				await write("Server/Other.luau");

				const [warning] = await named(["Server"]);

				expect(warning.message).toContain('Server ("server" route)');
			});

			it("should name a variant a root dir is named after", async () => {
				const [warning] = await named(["mock"], {
					variants: { mock: false },
				});

				expect(warning.message.split("\n")).toEqual([
					"1 root dir is named after a variant key, but routing starts below a root dir, so its name prunes nothing:",
					'  mock ("mock" variant)',
					'Move it into one folder, such as src/mock, and use "rootDirs": ["src"].',
				]);
			});

			it("should not stop the build from placing the files", async () => {
				const result = (await route({}, [abs("server")])).unwrap();

				expect(result.routed.map(({ route }) => route)).toEqual(["*"]);
			});
		});

		describe("scripts that never run", () => {
			const dead = async (overrides: ResolvedConfigSpec = {}) =>
				(
					await route({
						routes: {
							...ROUTES,
							shared: "ReplicatedStorage/shared",
						},
						...overrides,
					})
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "tree.deadScript");

			it("should warn once for a LocalScript in a server service and a Script in a replicating one", async () => {
				await write(
					"src/server/Hud.client.luau",
					"src/shared/Secret.server.luau",
					"src/server/Boot.server.luau",
					"src/client/Main.client.luau",
					"src/ReplicatedFirst/Load.client.luau",
					"src/Types.luau"
				);

				const [warning, ...others] = await dead();

				expect(others).toEqual([]);
				expect(warning.message).toContain("2 scripts will never run");
				expect(warning.message).toContain(
					`${abs("src/server/Hud.client.luau")} -> ServerScriptService/Hud (a LocalScript, placed by the "server" route)`
				);
				expect(warning.message).toContain(
					`${abs("src/shared/Secret.server.luau")} -> ReplicatedStorage/shared/Secret (a Script, placed by the "shared" route)`
				);
			});

			const metaWith = (runContext: string) =>
				JSON.stringify({ properties: { RunContext: runContext } });

			it("should not warn about a Script whose meta sets a run context, which runs by that", async () => {
				await write("src/shared/Hud.server.luau");
				await fs.writeFile(
					abs("src/shared/Hud.meta.json"),
					metaWith("Client")
				);

				expect(await dead()).toEqual([]);
			});

			it("should not warn about an init folder's Script whose meta sets a run context", async () => {
				await write("src/shared/Net/init.server.luau");
				await fs.writeFile(
					abs("src/shared/Net/init.meta.json"),
					metaWith("Server")
				);

				expect(await dead()).toEqual([]);
			});

			it("should still warn when the meta sets the Legacy run context or is invalid", async () => {
				await write(
					"src/shared/A.server.luau",
					"src/shared/B.server.luau"
				);
				await fs.writeFile(
					abs("src/shared/A.meta.json"),
					metaWith("Legacy")
				);
				await fs.writeFile(abs("src/shared/B.meta.json"), "{ nope");

				expect((await dead())[0].message).toContain("2 scripts");
			});

			const legacyOff = {
				template: {
					file: abs("template.project.json"),
					project: {
						name: "game",
						emitLegacyScripts: false,
						tree: { $className: "DataModel" },
					},
				},
			};

			it("should warn without legacy scripts about a Client script in ServerScriptService", async () => {
				await write(
					"src/server/Hud.client.luau",
					"src/server/Boot.server.luau",
					"src/shared/Load.client.luau",
					"src/shared/Rules.server.luau"
				);

				const [warning, ...others] = await dead(legacyOff);

				expect(others).toEqual([]);
				expect(warning.message).toContain("1 script will never run");
				expect(warning.message).toContain(
					`${abs("src/server/Hud.client.luau")} -> ServerScriptService/Hud (a Script with RunContext Client, placed by the "server" route)`
				);
			});

			it("should warn about a Script in ServerScriptService whose meta sets RunContext Client", async () => {
				await write("src/server/Hud.server.luau");
				await fs.writeFile(
					abs("src/server/Hud.meta.json"),
					metaWith("Client")
				);

				expect((await dead())[0].message).toContain(
					"a Script with RunContext Client"
				);
			});

			it("should never warn about a script in ServerStorage, where scripts wait to be cloned", async () => {
				await write(
					"src/storage/Npc.server.luau",
					"src/storage/Hud.client.luau"
				);
				const routes = {
					...ROUTES,
					shared: "ReplicatedStorage/shared",
					storage: "ServerStorage",
				};

				expect(await dead({ routes })).toEqual([]);
				expect(await dead({ routes, ...legacyOff })).toEqual([]);
			});

			it("should warn about an init folder's script", async () => {
				await write("src/shared/Net/init.server.luau");

				expect((await dead())[0].message).toContain("1 script will");
			});

			it("should not warn about a ModuleScript or a script that is pruned", async () => {
				await write(
					"src/server/Hud.client.mock.luau",
					"src/server/Save@server.luau"
				);

				expect(await dead({ variants: { mock: false } })).toEqual([]);
			});

			it("should name every script in related, and list them all", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/shared/Save${index}.server.luau`
					)
				);

				const [warning] = await dead();

				expect(warning.message).not.toContain("more like it");
				expect(warning.related).toHaveLength(12);
				expect(warning.related?.[0]).toEqual({
					resource: at("src/shared/Save0.server.luau"),
					message: "a Script never runs in ReplicatedStorage",
				});
			});
		});

		describe("a template that overrides the one it merges over", () => {
			it("should warn at the template that set each field it overrides", async () => {
				await write("src/shared/Util.luau");

				const warnings = (
					await route({
						template: {
							file: abs("places/lobby/template.project.json"),
							project: { name: "Lobby", tree: {} },
							bases: [abs("places/shared/template.project.json")],
							clashes: [
								{
									instancePath: [
										"ReplicatedStorage",
										"Packages",
									],
									field: "$path",
									file: abs(
										"places/lobby/template.project.json"
									),
									base: abs(
										"places/shared/template.project.json"
									),
								},
								{
									instancePath: ["Lighting"],
									field: "$properties.Brightness",
									file: abs(
										"places/arena/template.project.json"
									),
									base: abs(
										"places/shared/template.project.json"
									),
								},
							],
						},
					})
				)
					.unwrap()
					.warnings.filter(
						({ code }) => code === "template.overridesBase"
					);

				expect(
					warnings.map(({ resource, severity, message }) => ({
						resource,
						severity,
						message,
					}))
				).toEqual([
					{
						resource: abs("places/lobby/template.project.json"),
						severity: DiagnosticSeverity.Warning,
						message: `"ReplicatedStorage/Packages" sets $path here and in ${abs("places/shared/template.project.json")}, which this template merges over, so this one wins. Remove it from one of them.`,
					},
					{
						resource: abs("places/arena/template.project.json"),
						severity: DiagnosticSeverity.Warning,
						message: `"Lighting" sets $properties.Brightness here and in ${abs("places/shared/template.project.json")}, which this template merges over, so this one wins. Remove it from one of them.`,
					},
				]);
			});
		});

		describe("an instance named with a leading $", () => {
			const reserved = async () =>
				(await route())
					.unwrap()
					.warnings.filter(
						({ code }) => code === "tree.reservedName"
					);

			it("should warn of a file Rojo would key with a $, and propose the name without it", async () => {
				await write("src/$Config.luau", "src/Fine.luau");

				expect(await reserved()).toMatchObject([
					{
						resource: abs("src/$Config.luau"),
						message: expect.stringContaining(
							'"ReplicatedStorage/shared/$Config"'
						),
						fixes: [
							{
								rename: {
									from: abs("src/$Config.luau"),
									to: abs("src/Config.luau"),
								},
							},
						],
					},
				]);
			});

			it("should warn once of a folder a project key names, with no rename to propose", async () => {
				await write(
					"src/Fine.luau",
					"src/$Kit/A.luau",
					"src/$Kit/B.luau"
				);

				const warnings = await reserved();

				expect(warnings).toHaveLength(1);
				expect(warnings[0].resource).toBe(abs("src/$Kit/A.luau"));
				expect(warnings[0].fixes ?? []).toEqual([]);
			});

			it("should leave a $ inside a name, and a file Rojo reads from a folder it was given whole, alone", async () => {
				await write("src/Cost$.luau", "src/Kit/$Inner.luau");

				expect(await reserved()).toEqual([]);
			});
		});

		describe("instances no variant gives", () => {
			const missing = async (
				variants: Record<string, boolean>,
				rootDirs?: readonly string[]
			) =>
				(await route({ variants }, rootDirs))
					.unwrap()
					.warnings.filter(
						({ code }) => code === "variant.noneActive"
					);

			it("should warn once, naming the instance and the variants that give it, when all are off", async () => {
				await write(
					"src/Analytics/dev/Service.luau",
					"src/Analytics/prod/Service.luau",
					"src/Analytics/Other.luau"
				);

				const [warning, ...others] = await missing({
					dev: false,
					prod: false,
				});

				expect(others).toEqual([]);
				expect(warning.message).toContain(
					"ReplicatedStorage/shared/Analytics/Service (dev, prod)"
				);
			});

			it("should list ten of the instances and count the rest", async () => {
				await write(
					...Array.from({ length: 11 }, (_, index) => [
						`src/Kit${index}/dev/Service.luau`,
						`src/Kit${index}/prod/Service.luau`,
					]).flat()
				);

				const [warning] = await missing({ dev: false, prod: false });

				expect(warning.message).toContain("11 instances are missing");
				expect(warning.message).toContain(
					"  1 more like it isn't listed."
				);
			});

			it("should not warn when one of them is on", async () => {
				await write(
					"src/Analytics/dev/Service.luau",
					"src/Analytics/prod/Service.luau"
				);

				expect(await missing({ dev: true, prod: false })).toEqual([]);
			});

			it("should name a folder two variant folders give, not each file inside", async () => {
				await write(
					"src/Analytics.mock/Service.luau",
					"src/Analytics.prod/Service.luau"
				);

				const [warning] = await missing({ mock: false, prod: false });

				expect(warning.message).toContain("1 instance is missing");
				expect(warning.message).toContain(
					"ReplicatedStorage/shared/Analytics (mock, prod)"
				);
			});

			it("should not count a folder's files as alternatives of the folder", async () => {
				await write(
					"src/Tools/Debug.dev.luau",
					"src/Tools/Profiler.prof.luau",
					"src/Kit/.dev",
					"src/Kit/Y.luau",
					"src/Kit/X.prof.luau"
				);

				expect(await missing({ dev: false, prof: false })).toEqual([]);
			});

			it("should name the file two variant folders give, not the folder above them", async () => {
				await write("src/W/dev/Svc.luau", "src/W/prod/Svc.luau");

				const [warning] = await missing({ dev: false, prod: false });

				expect(warning.message).toContain(
					"ReplicatedStorage/shared/W/Svc (dev, prod)"
				);
			});

			it("should not warn for a lone variant", async () => {
				await write("src/DebugPanel.dev.luau");

				expect(await missing({ dev: false })).toEqual([]);
			});

			it("should not warn when a plain file in a later root dir gives the instance", async () => {
				await write(
					"src/Analytics/dev/Service.luau",
					"src/Analytics/prod/Service.luau",
					"lib/Analytics/Service.luau"
				);

				expect(
					await missing({ dev: false, prod: false }, [
						abs("src"),
						abs("lib"),
					])
				).toEqual([]);
			});
		});

		describe("server code that ships to clients", () => {
			const shipped = async () =>
				(await route())
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.serverCodeShipped"
					);

			it("should warn once, naming each file, the route it sits under, the one that governs it and the marker that keeps it", async () => {
				await write(
					"src/ReplicatedFirst/server/Datastore.luau",
					"src/ReplicatedFirst/(server)/Save.luau",
					"src/server/Net/Fine.luau"
				);

				const [warning, ...others] = await shipped();

				expect(others).toEqual([]);
				expect(warning.severity).toBe(DiagnosticSeverity.Warning);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toBe(
					[
						'2 files under a "server" route ship to clients, because "ReplicatedFirst" governs them:',
						`  ${abs("src/ReplicatedFirst/(server)/Save.luau")} -> ReplicatedFirst/Save`,
						`  ${abs("src/ReplicatedFirst/server/Datastore.luau")} -> ReplicatedFirst/server/Datastore`,
						'Move them out of the "ReplicatedFirst" route\'s files if they\'re server code, or keep them there with a "@ReplicatedFirst" marker file in their folder.',
					].join("\n")
				);
			});

			it("should warn for a data file and a model in the folder", async () => {
				await write(
					"src/ReplicatedFirst/server/Config.json",
					"src/ReplicatedFirst/server/Rig.rbxm"
				);

				expect((await shipped())[0].message).toContain("2 files");
			});

			it("should not warn about files a sign restating the governing route covers, at or below the folder", async () => {
				await write(
					"src/ReplicatedFirst/server/@ReplicatedFirst",
					"src/ReplicatedFirst/server/Secret.luau",
					"src/ReplicatedFirst/server/Deep/More.luau",
					"src/ReplicatedFirst/(server)/@ReplicatedFirst",
					"src/ReplicatedFirst/(server)/Hidden.luau",
					"src/ReplicatedFirst/Net/server/Inner@ReplicatedFirst/Ok.luau",
					"src/ReplicatedFirst/Net/server/Kept@ReplicatedFirst.luau",
					"src/ReplicatedFirst/Net/server/Other.luau"
				);

				const [warning, ...others] = await shipped();

				expect(others).toEqual([]);
				expect(warning.message).toContain("1 file ");
				expect(warning.message).toContain(
					abs("src/ReplicatedFirst/Net/server/Other.luau")
				);
			});

			it("should warn about the files beside an init script whose Rojo suffix an outer route outranks", async () => {
				await write(
					"src/ReplicatedFirst/Store/init.server.luau",
					"src/ReplicatedFirst/Store/Data.luau"
				);

				const [warning, ...others] = await shipped();

				expect(others).toEqual([]);
				expect(warning.message).toContain("1 file ");
				expect(warning.message).toContain(
					abs("src/ReplicatedFirst/Store/Data.luau")
				);
			});

			it("should name a marker per route when several govern the files", async () => {
				await write(
					"src/ReplicatedFirst/server/A.luau",
					"src/client/server/B.luau"
				);

				const [warning] = await shipped();

				expect(warning.message).toContain(
					'or keep them there with a marker file that restates their route ("@ReplicatedFirst" or "@client") in their folder.'
				);
			});

			it("should still warn about a server folder below the one a marker covers", async () => {
				await write(
					"src/ReplicatedFirst/server/@ReplicatedFirst",
					"src/ReplicatedFirst/server/Deep/server/Leak.luau"
				);

				const [warning] = await shipped();

				expect(warning.message).toContain(
					abs("src/ReplicatedFirst/server/Deep/server/Leak.luau")
				);
			});

			it("should not warn when the governing route is server-only too", async () => {
				await write("src/server/Net/client/Save.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should not warn about a Script, whose source stays on the server", async () => {
				await write("src/ReplicatedFirst/server/Boot.server.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should not warn about a route that targets a replicating service", async () => {
				await write("src/ReplicatedFirst/client/Hud.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should name every file in related, and list them all", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) =>
							`src/ReplicatedFirst/server/Save${index}.luau`
					)
				);

				const [warning] = await shipped();

				expect(warning.message).toContain("12 files");
				expect(warning.message).not.toContain("more like it");
				expect(warning.related).toHaveLength(12);
			});

			it("should not warn about a file a dormant variant prunes", async () => {
				await write("src/ReplicatedFirst/server/Save.mock.luau");

				const [warning] = await (async () =>
					(await route({ variants: { mock: false } }))
						.unwrap()
						.warnings.filter(
							({ code }) => code === "route.serverCodeShipped"
						))();

				expect(warning).toBeUndefined();
			});
		});
	});
});
