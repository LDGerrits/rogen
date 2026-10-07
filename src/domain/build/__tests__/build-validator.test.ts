import { toPosix } from "../../../base/path.js";
import { DisposableStore } from "../../../base/disposable.js";
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
		let store: DisposableStore;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		it("should report rules in a fixed order, whatever order the problems arose in", async () => {
			await writeFiles(fs, "src/Orphan.meta.json", "src/Stray.luau");
			const config = baseConfigOf({
				rootDirs: [abs("src"), abs("missing")],
				routes: { server: "ServerScriptService" },
			});
			const index = await indexOf(store, fs, config.rootDirs);
			const placement = placeFiles(index, config, syncTools).unwrap();
			const meta = (await new MetaReader(fs).read(placement)).unwrap();
			const assembled = new TreeAssembler()
				.assemble(placement, meta)
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
			const index = await indexOf(store, fs, config.rootDirs);
			const placement = placeFiles(index, config, syncTools).unwrap();
			const meta = (await new MetaReader(fs).read(placement)).unwrap();
			const assembled = new TreeAssembler()
				.assemble(placement, meta)
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
				leftOut: placement.leftOut,
				globIgnorePaths: tree.globIgnorePaths,
				unrouted: placement.leftOut
					.withStatus("unrouted")
					.map(([source]) => source),
				warnings,
			}));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("letter case mismatches", () => {
			const caseWarnings = async (overrides: ResolvedConfigSpec = {}) =>
				(await route(overrides))
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.caseMismatch"
					);

			it("should warn about a folder named like a route in different case, at that folder", async () => {
				await write("src/SERVER/Save.luau");

				const [warning] = await caseWarnings();

				expect(warning).toMatchObject({
					severity: DiagnosticSeverity.Warning,
					resource: abs("src/SERVER"),
				});
				expect(warning.message).toContain('"server"');
				expect(warning.message).toContain(
					'Spell it "server" or "Server"'
				);
			});

			it("should warn about an invisible folder named like a variant in different case", async () => {
				await write("src/Analytics/(MOCK)/Service.luau");

				const [warning] = await caseWarnings({
					variants: { mock: true },
				});

				expect(warning.resource).toBe(abs("src/Analytics/(MOCK)"));
				expect(warning.message).toContain('variant "mock"');
			});

			it("should warn about a marker file named like a route in different case", async () => {
				await write("src/Inventory/.SERVER", "src/Inventory/Save.luau");

				const [warning] = await caseWarnings();

				expect(warning.resource).toBe(abs("src/Inventory/.SERVER"));
				expect(warning.message).toContain('route "server"');
			});

			it("should warn once for a folder however many files it holds", async () => {
				await write("src/SERVER/A.luau", "src/SERVER/B.luau");

				expect(await caseWarnings()).toHaveLength(1);
			});

			it("should warn once per mismatched name", async () => {
				await write(
					"src/SERVER/A.luau",
					"src/Inventory/.CLIENT",
					"src/CLIENT/B.luau"
				);

				const warnings = await caseWarnings();

				expect(warnings.map(({ resource }) => resource).sort()).toEqual(
					[
						abs("src/CLIENT"),
						abs("src/Inventory/.CLIENT"),
						abs("src/SERVER"),
					]
				);
			});

			it("should not warn about a name that only differs in its first letter", async () => {
				await write(
					"src/Server/Save.luau",
					"src/Inventory/.Client",
					"src/Inventory/Load@Server.luau"
				);

				expect(await caseWarnings()).toEqual([]);
			});

			it("should not warn about a name that matches exactly or not at all", async () => {
				await write(
					"src/server/A.luau",
					"src/Inventory/B.server.luau",
					"src/Inventory/HTTPServer.luau",
					"src/Inventory/Player.luau"
				);

				expect(await caseWarnings()).toEqual([]);
			});

			it("should still report a mismatch on a file that no route governs", async () => {
				await write("src/SERVER/Save.luau");

				const warnings = (
					await route({ routes: { server: "ServerScriptService" } })
				).unwrap().warnings;

				expect(warnings.map(({ code }) => code)).toEqual([
					"route.caseMismatch",
					"route.unrouted",
				]);
			});
		});

		describe("@ that routes nowhere", () => {
			const strayWarnings = async () =>
				(await route())
					.unwrap()
					.warnings.filter(({ code }) => code === "route.strayAt");

			it("should warn once for every file and folder, naming the closest route", async () => {
				await write(
					"src/Inventory/Save@sever.luau",
					"src/Queue@clent/Load.luau",
					"src/Inventory/Fine@server.luau"
				);

				const [warning, ...others] = await strayWarnings();

				expect(others).toEqual([]);
				expect(warning.severity).toBe(DiagnosticSeverity.Warning);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toContain("2 names have");
				expect(warning.message).toContain(
					`${abs("src/Inventory/Save@sever.luau")} (did you mean "@server"?)`
				);
				expect(warning.message).toContain(
					`${abs("src/Queue@clent")} (did you mean "@client"?)`
				);
				expect(warning.message).not.toContain("Fine@server");
			});

			it("should say when a declared route isn't at the end of the name", async () => {
				await write("src/Save@server.bak.luau");

				const [warning] = await strayWarnings();

				expect(warning.message).toContain(
					'"@server" must end the name'
				);
			});

			it("should list the first few and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/Save${index}@sever.luau`
					)
				);

				const [warning] = await strayWarnings();

				expect(warning.message).toContain("12 names have");
				expect(warning.message).toContain("2 more like it");
			});

			it("should not warn for a route that an outer route ignores", async () => {
				await write("src/server/Net/Save@client.luau");

				expect(await strayWarnings()).toEqual([]);
			});

			it("should fix each name by renaming it to the closest route, a folder as a folder", async () => {
				await write(
					"src/Inventory/Save@sever.luau",
					"src/(Queue@clent)/Load.luau"
				);

				const [warning] = await strayWarnings();

				expect(warning.fixes).toEqual([
					{
						rename: {
							from: at("src/(Queue@clent)"),
							to: at("src/(Queue@client)"),
						},
					},
					{
						rename: {
							from: at("src/Inventory/Save@sever.luau"),
							to: at("src/Inventory/Save@server.luau"),
						},
					},
				]);
			});

			it("should give no fix when two routes are as close", async () => {
				await write("src/Save@serer.luau");

				const [warning] = (
					await route({ routes: { ...ROUTES, sever: "Workspace" } })
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "route.strayAt");

				expect(warning.fixes).toBeUndefined();
			});

			it("should give no fix for a declared route that isn't at the end", async () => {
				await write("src/Save@server.bak.luau");

				const [warning] = await strayWarnings();

				expect(warning.fixes).toBeUndefined();
			});

			it("should fix every name, not only those the message lists", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/Save${index}@sever.luau`
					)
				);

				const [warning] = await strayWarnings();

				expect(warning.fixes).toHaveLength(12);
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
					"src/server/Save@client.luau"
				);

				expect(await dead({ variants: { mock: false } })).toEqual([]);
			});

			it("should list the first few and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/shared/Save${index}.server.luau`
					)
				);

				expect((await dead())[0].message).toContain("2 more like it");
			});
		});

		describe("variant typos", () => {
			const typos = async () =>
				(await route({ variants: { mock: true } }))
					.unwrap()
					.warnings.filter(({ code }) => code === "variant.typo");

			it("should warn once, naming the variant a dot part is one edit from", async () => {
				await write(
					"src/Analytics.mok.luau",
					"src/Save.spec.luau",
					"src/Fine.mock.luau"
				);

				const [warning, ...others] = await typos();

				expect(others).toEqual([]);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toContain(
					`${abs("src/Analytics.mok.luau")} (did you mean ".mock" for ".mok"?)`
				);
				expect(warning.message).not.toContain("spec");
			});

			it("should fix the name by renaming it to the variant", async () => {
				await write("src/Analytics.mok.luau");

				const [warning] = await typos();

				expect(warning.fixes).toEqual([
					{
						rename: {
							from: at("src/Analytics.mok.luau"),
							to: at("src/Analytics.mock.luau"),
						},
					},
				]);
			});

			it("should give no fix when two variants are one edit away", async () => {
				await write("src/Analytics.mok.luau");

				const [warning] = (
					await route({ variants: { mock: true, mook: false } })
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "variant.typo");

				expect(warning.fixes).toBeUndefined();
			});
		});

		describe("server code that ships to clients", () => {
			const shipped = async () =>
				(await route())
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.serverCodeShipped"
					);

			it("should warn once, naming each file, the route it sits under and the one that governs it", async () => {
				await write(
					"src/ReplicatedFirst/server/Datastore.luau",
					"src/ReplicatedFirst/Other@server/Save.luau",
					"src/server/Net/Fine.luau"
				);

				const [warning, ...others] = await shipped();

				expect(others).toEqual([]);
				expect(warning.severity).toBe(DiagnosticSeverity.Warning);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toBe(
					[
						'2 files under a "server" route ship to clients, because "ReplicatedFirst" governs them:',
						`  ${abs("src/ReplicatedFirst/Other@server/Save.luau")} -> ReplicatedFirst/Other@server/Save`,
						`  ${abs("src/ReplicatedFirst/server/Datastore.luau")} -> ReplicatedFirst/server/Datastore`,
						"Move them out of the \"ReplicatedFirst\" route's files if they're server code.",
					].join("\n")
				);
			});

			it("should warn for a data file and a suffix that an outer route ignores", async () => {
				await write(
					"src/ReplicatedFirst/Config@server.json",
					"src/ReplicatedFirst/Rules@server.luau"
				);

				expect((await shipped())[0].message).toContain("2 files");
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

			it("should list the first few files and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) =>
							`src/ReplicatedFirst/server/Save${index}.luau`
					)
				);

				const [warning] = await shipped();

				expect(warning.message).toContain("12 files");
				expect(warning.message).toContain("2 more like it");
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

		describe("an @ an outer route outranks", () => {
			const ignoredAts = async () =>
				(await route())
					.unwrap()
					.warnings.filter(({ code }) => code === "route.ignoredAt");

			it("should warn per file that the suffix does nothing and stays in the name", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/client/Hud@client.luau"
				);

				const warnings = await ignoredAts();

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/client/Hud@client.luau"),
					abs("src/server/Util@client.luau"),
				]);
				expect(warnings[1].message).toBe(
					'"@client" does nothing here, because the "server" route already governs this file, so it stays in the name (Util@client). Remove it, or move the file out of the "server" route\'s files.'
				);
			});

			it("should leave a file that ships to clients to that warning", async () => {
				await write("src/client/Save@server.luau");

				expect(await ignoredAts()).toEqual([]);
			});

			it("should warn once per folder whose @ does nothing, where it stays in the name", async () => {
				await write(
					"src/server/Ui@client/Hud.luau",
					"src/server/Ui@client/Bar.luau",
					"src/server/@client/Probe.luau"
				);

				const warnings = await ignoredAts();

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/server/@client"),
					abs("src/server/Ui@client"),
				]);
				expect(warnings[1].message).toBe(
					'"@client" does nothing here, because the "server" route already governs this folder, so it stays in the name (Ui@client). Remove it, or move the folder out of the "server" route\'s files.'
				);
			});

			it("should not warn about a folder named after a route that an outer route outranks", async () => {
				await write("src/server/client/Bar.luau");

				expect(await ignoredAts()).toEqual([]);
			});
		});
	});
});
