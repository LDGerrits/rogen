import { toPosix } from "../../../../base/path.js";
import { DiagnosticSeverity } from "../../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../../config/__tests__/mock-config-service.js";
import { BuildValidator } from "../build-validator.js";
import { MetaReader } from "../../meta-reader.js";
import { TreeAssembler } from "../../tree-assembler.js";
import {
	abs,
	buildAndPlace,
	configOf,
	configOf as baseConfigOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "../../__tests__/fixtures.js";

describe("BuildValidator", () => {
	describe("validate", () => {
		let fs: MemoryFileSystemService;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		it("should report rules in a fixed order, whatever order the problems arose in", async () => {
			await writeFiles(fs, "src/Orphan.meta.json", "src/Stray.luau");
			const config = baseConfigOf({
				sourcePaths: [abs("src"), abs("missing")],
				routes: { server: "ServerScriptService" },
			});
			const index = await indexOf(fs, config.sourcePaths);
			const placement = placeFiles(index, config, syncTools).unwrap();
			const meta = (await new MetaReader(fs).read(placement)).unwrap();
			const assembled = new TreeAssembler(placement, meta)
				.assemble()
				.unwrap();

			const warnings = new BuildValidator(assembled).validate();

			expect(warnings.map(({ code }) => code)).toEqual([
				"scan.missingSourcePath",
				"meta.unclaimed",
				"route.unrouted",
			]);
		});

		it("should report nothing for a build that raises no problems", async () => {
			await writeFiles(fs, "src/Fine.luau");
			const config = baseConfigOf();
			const index = await indexOf(fs, config.sourcePaths);
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
			sourcePaths: readonly string[] = [abs("src")]
		) =>
			(
				await buildAndPlace(
					fs,
					configOf({
						routes: ROUTES,
						sourcePaths: [...sourcePaths],
						...overrides,
					})
				)
			).map(({ placement, projectFile, findings: { warnings } }) => ({
				routed: placement.routed,
				leftOut: placement.leftOut,
				globIgnorePaths: projectFile.globIgnorePaths,
				unrouted: placement.leftOut
					.withStatus("unrouted")
					.map(([source]) => source),
				warnings,
			}));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("a project file in a source path", () => {
			const nested = async (...files: string[]) => {
				await write(...files);
				return (await route())
					.unwrap()
					.warnings.filter(
						({ code }) => code === "scan.nestedProject"
					);
			};

			it("should warn for a default.project.json in a source path itself, naming the instance it becomes", async () => {
				const warnings = await nested(
					"src/default.project.json",
					"src/Other.project.json"
				);

				expect(warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						resource: at("src", "default.project.json"),
						message:
							"Rojo reads a default.project.json as the folder it lies in, but a source path never becomes an instance, so this project becomes ReplicatedStorage/shared/default on its own. Move it into a folder of its own.",
					},
				]);
			});

			it("should not warn for a default.project.json in a folder, which becomes that folder", async () => {
				expect(await nested("src/sub/default.project.json")).toEqual(
					[]
				);
			});

			it("should not warn for a project file that is outside the source paths", async () => {
				expect(
					await nested("src/A.luau", "default.project.json")
				).toEqual([]);
			});
		});

		describe("a sync rule whose suffix does not end a file name", () => {
			const suffixed = async (...files: string[]) => {
				await write(...files);
				return (
					await route({
						project: {
							tree: {},
							syncRules: [
								{
									pattern: "*.md",
									use: "text",
									suffix: ".txt",
								},
							],
						},
					})
				)
					.unwrap()
					.warnings.filter(
						({ code }) => code === "scan.syncRuleSuffix"
					);
			};

			it("should warn at each file the rule takes", async () => {
				const warnings = await suffixed(
					"src/B.md",
					"src/A.md",
					"src/C.luau"
				);

				expect(warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						resource: at("src", "A.md"),
						message: expect.stringContaining('"*.md" cuts ".txt"'),
					},
					{ resource: at("src", "B.md") },
				]);
			});

			it("should not warn for a file whose name ends with the suffix", async () => {
				expect(await suffixed("src/A.txt")).toEqual([]);
			});
		});

		describe("a source path named after a key", () => {
			const named = async (
				sourcePaths: string[],
				overrides: ResolvedConfigSpec = {}
			) =>
				(
					await route(
						overrides,
						sourcePaths.map((dir) => abs(dir))
					)
				)
					.unwrap()
					.warnings.filter(
						({ code }) => code === "scan.sourcePathNamedAfterKey"
					);

			beforeEach(async () => {
				await write(
					"server/Save.luau",
					"client/Hud.luau",
					"src/server/Net.luau"
				);
			});

			it("should warn once for every source path at the project root, with the move-them fix", async () => {
				const [warning] = await named(["server", "client"]);

				expect(warning).toMatchObject({
					severity: DiagnosticSeverity.Warning,
					resource: abs("rogen.json"),
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
					"2 source paths are named after a route key, but routing starts below a source path, so their names route nothing:",
					'  server ("server" route)',
					'  client ("client" route)',
					'Move them into one folder, such as src/server and src/client, and use "sourcePaths": ["src"].',
				]);
			});

			it("should say to use the parent when the source path sits inside the project", async () => {
				const [warning] = await named(["src/server"]);

				expect(warning.message.split("\n")).toEqual([
					"1 source path is named after a route key, but routing starts below a source path, so its name routes nothing:",
					'  src/server ("server" route)',
					'Use "src" as the source path instead, so "server" is read as a key.',
				]);
			});

			it("should fall back to moving the source path into one folder when its parent is outside the project", async () => {
				const [warning] = await named(["../outside/server"]);

				expect(warning.message.split("\n")).toEqual([
					"1 source path is named after a route key, but routing starts below a source path, so its name routes nothing:",
					'  ../outside/server ("server" route)',
					'Move it into one folder, such as src/../outside/server, and use "sourcePaths": ["src"].',
				]);
			});

			it("should not warn when the source path holds a folder named after a key", async () => {
				expect(await named(["src"])).toEqual([]);
			});

			it("should read the name with its first letter in either case", async () => {
				await write("Server/Other.luau");

				const [warning] = await named(["Server"]);

				expect(warning.message).toContain('Server ("server" route)');
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
				project: {
					name: "game",
					emitLegacyScripts: false,
					tree: { $className: "DataModel" },
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

			it("should not warn about a ModuleScript", async () => {
				await write("src/server/Save@server.luau");

				expect(await dead()).toEqual([]);
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

		describe("names that fail on some system", () => {
			const named = async (code: string) =>
				(await route())
					.unwrap()
					.warnings.filter((warning) => warning.code === code);

			it("should warn of a file with no name before its suffix", async () => {
				await write("src/.server.luau", "src/Fine.luau");

				expect(await named("scan.emptyName")).toMatchObject([
					{
						resource: abs("src/.server.luau"),
						message: expect.stringContaining("empty name"),
					},
				]);
			});

			it.each([
				["src/Bad:Name.luau", '":"'],
				["src/What?.luau", '"?"'],
				["src/con.luau", "Windows device"],
				["src/trail .luau", "space or a dot"],
			])("should warn of %s", async (file, reason) => {
				await write(file);

				expect(await named("scan.portableName")).toMatchObject([
					{
						resource: abs(file),
						message: expect.stringContaining(reason),
					},
				]);
			});

			it("should warn of a folder whose name Windows cannot create", async () => {
				await write("src/aux/Fine.luau");

				expect(await named("scan.portableName")).toMatchObject([
					{ resource: abs("src/aux") },
				]);
			});

			it("should warn of two names that differ only in letter case, naming both", async () => {
				await write("src/Foo.luau", "src/foo.luau");

				expect(
					(await named("scan.portableName")).map(
						({ resource }) => resource
					)
				).toEqual([abs("src/Foo.luau"), abs("src/foo.luau")]);
			});

			it("should warn of a meta file and a marker whose names Windows cannot hold", async () => {
				await write(
					"src/Foo?.meta.json",
					"src/@ser:ver",
					"src/Foo.luau"
				);

				expect(
					(await named("scan.portableName")).map(
						({ resource }) => resource
					)
				).toEqual([abs("src/@ser:ver"), abs("src/Foo?.meta.json")]);
			});

			it("should leave a name that is fine alone", async () => {
				await write("src/Save.server.luau", "src/My-Lib/Util.luau");

				expect(await named("scan.portableName")).toEqual([]);
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
				expect(warning.resource).toBe(abs("rogen.json"));
				expect(warning.message).toBe(
					[
						'2 files under a "server" route ship to clients, because "ReplicatedFirst" governs them:',
						`  ${abs("src/ReplicatedFirst/(server)/Save.luau")} -> ReplicatedFirst/Save`,
						`  ${abs("src/ReplicatedFirst/server/Datastore.luau")} -> ReplicatedFirst/server/Datastore`,
						'Move them out of the "ReplicatedFirst" route\'s files if they\'re server code, or keep them there with a "@ReplicatedFirst" marker file in their folder.',
					].join("\n")
				);
			});

			it("should carry the way out in the message of each file it lists", async () => {
				await write("src/ReplicatedFirst/server/Datastore.luau");

				const [warning] = await shipped();

				expect(warning.related).toEqual([
					{
						resource: abs(
							"src/ReplicatedFirst/server/Datastore.luau"
						),
						message:
							'ships to clients as ReplicatedFirst/server/Datastore: move it out of the "ReplicatedFirst" route\'s files if it\'s server code, or keep it there with a "@ReplicatedFirst" marker file in its folder',
					},
				]);
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
		});
	});
});
