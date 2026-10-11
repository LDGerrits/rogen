import { toPosix } from "../../../base/path.js";
import {
	DiagnosticSeverity,
	isRenameFix,
} from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { abs, buildAndPlace, configOf, writeFiles } from "./fixtures.js";

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

		describe("a folder one edit from a key", () => {
			const folderTypos = async (overrides: ResolvedConfigSpec = {}) =>
				(await route({ routes: ROUTES, ...overrides }))
					.unwrap()
					.warnings.filter(
						({ code }) =>
							code === "route.folderTypo" ||
							code === "variant.typo"
					);

			it("should warn about a folder one edit from a route key, with the key and a rename", async () => {
				await write("src/Inventory/Sever/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning).toMatchObject({
					code: "route.folderTypo",
					resource: abs("default.rogen.json"),
					related: [
						{
							resource: abs("src/Inventory/Sever"),
							message: 'did you mean "Server"?',
						},
					],
					fixes: [
						{
							rename: {
								from: at("src/Inventory/Sever"),
								to: at("src/Inventory/Server"),
							},
						},
					],
				});
			});

			it("should name the config's key when the config has the typo", async () => {
				await write("src/Server/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Sever: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning.related?.[0].message).toBe(
					'did you mean "Sever"?'
				);
			});

			it("should keep the folder's own first-letter case in the rename", async () => {
				await write("src/sever/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning.fixes).toEqual([
					{ rename: { from: at("src/sever"), to: at("src/server") } },
				]);
			});

			it("should warn about a variant folder one edit from a variant, without a dot", async () => {
				await write("src/mokc/Fake.luau");

				const [warning] = await folderTypos({
					variants: { mock: false },
				});

				expect(warning).toMatchObject({
					code: "variant.typo",
					related: [{ message: 'did you mean "mock"?' }],
				});
				expect(warning.message.split("\n")[0]).toBe(
					"1 name is one edit from a declared variant, so it is read as an ordinary name:"
				);
			});

			it("should count two swapped letters as one edit", async () => {
				await write("src/Sevrer/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning.code).toBe("route.folderTypo");
			});

			it("should warn about a plural, which is one edit away like any other", async () => {
				await write("src/Servers/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning.code).toBe("route.folderTypo");
			});

			it.each([
				["two edits", "Srvr"],
				["an ordinary name", "Inventory"],
			])("should not warn about %s", async (_, folder) => {
				await write(`src/${folder}/Save.luau`);

				expect(
					await folderTypos({
						routes: {
							Server: "ServerScriptService",
							"*": "ReplicatedStorage",
						},
					})
				).toEqual([]);
			});

			it("should not warn about a key shorter than four letters", async () => {
				await write("src/Gui/Hud.luau");

				expect(
					await folderTypos({
						routes: { Guy: "StarterGui", "*": "ReplicatedStorage" },
					})
				).toEqual([]);
			});

			it("should not warn about a declared key, a case-only miss, or the folder a route governs", async () => {
				await write(
					"src/Shared/Server/Secret.luau",
					"src/SERVER/Other.luau"
				);

				expect(
					await folderTypos({
						routes: {
							Shared: "ReplicatedStorage",
							Server: "ServerScriptService",
							"*": "ReplicatedStorage",
						},
					})
				).toEqual([]);
			});

			it("should read the name with its parentheses and variant parts off", async () => {
				await write("src/(Sever)/A.luau", "src/Sever.mock/B.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
					variants: { mock: true },
				});

				expect(
					warning.related?.map(({ resource }) => resource)
				).toEqual([abs("src/(Sever)"), abs("src/Sever.mock")]);
			});
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
				await write("src/Inventory/@SERVER", "src/Inventory/Save.luau");

				const [warning] = await caseWarnings();

				expect(warning.resource).toBe(abs("src/Inventory/@SERVER"));
				expect(warning.message).toContain('route "server"');
			});

			it("should warn once for a folder however many files it holds", async () => {
				await write("src/SERVER/A.luau", "src/SERVER/B.luau");

				expect(await caseWarnings()).toHaveLength(1);
			});

			it("should warn once per mismatched name", async () => {
				await write(
					"src/SERVER/A.luau",
					"src/Inventory/@CLIENT",
					"src/CLIENT/B.luau"
				);

				const warnings = await caseWarnings();

				expect(warnings.map(({ resource }) => resource).sort()).toEqual(
					[
						abs("src/CLIENT"),
						abs("src/Inventory/@CLIENT"),
						abs("src/SERVER"),
					]
				);
			});

			it("should not warn about a name that only differs in its first letter", async () => {
				await write(
					"src/Server/Save.luau",
					"src/Inventory/@Client",
					"src/Inventory/Load@Client.luau"
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

			it("should list every name in related and the message", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/Save${index}@sever.luau`
					)
				);

				const [warning] = await strayWarnings();

				expect(warning.message).toContain("12 names have");
				expect(warning.message).not.toContain("more like it");
				expect(warning.related).toHaveLength(12);
				expect(warning.related?.[0]).toEqual({
					resource: at("src/Save0@sever.luau"),
					message: 'did you mean "@server"?',
				});
			});

			it("should not warn for a route that restates the outer one", async () => {
				await write("src/server/Net/Save@server.luau");

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

		describe("route keys after a dot", () => {
			const SHARED = { ...ROUTES, shared: "ReplicatedStorage/shared" };
			const warningsOf = async (code: string) =>
				(await route({ routes: SHARED, variants: { mock: false } }))
					.unwrap()
					.warnings.filter((warning) => warning.code === code);

			it("should warn once for a dot-file and dot parts that spell a route, naming each @ form", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Inventory/Types.shared.luau",
					"src/Net.shared/A.luau",
					"src/Net.server/B.luau",
					"src/Boot.server.luau"
				);

				const [warning, ...others] = await warningsOf("route.dotRoute");

				expect(others).toEqual([]);
				expect(warning.message).toContain("4 names write a route key");
				expect(warning.message).toContain(
					`${at("src/Inventory/.server")} (write "@server")`
				);
				expect(warning.message).toContain(
					`${at("src/Inventory/Types.shared.luau")} (write "Types@shared.luau")`
				);
				expect(warning.message).toContain(`(write "Net@shared")`);
				expect(warning.message).toContain(`(write "Net@server")`);
				expect(warning.message).not.toContain("Boot");
				expect(warning.fixes).toContainEqual({
					rename: {
						from: at("src/Net.server"),
						to: at("src/Net@server"),
					},
				});
			});

			it("should warn about Rojo's .server and .client on a data file or model, which has no script class", async () => {
				await write(
					"src/Data.server.json",
					"src/Hud.client.rbxmx",
					"src/Gun.server.model.json",
					"src/Boot.client.luau"
				);

				const [warning] = await warningsOf("route.dotRoute");

				expect(warning.message).toContain("3 names write a route key");
				expect(warning.message).toContain(`(write "Data@server.json")`);
				expect(warning.message).toContain(`(write "Hud@client.rbxmx")`);
				expect(warning.message).not.toContain("Boot");
				expect(warning.fixes).toContainEqual({
					rename: {
						from: at("src/Gun.server.model.json"),
						to: at("src/Gun@server.model.json"),
					},
				});
			});

			it("should warn about a route key after a dot in any letter case, renaming a script's to Rojo's own spelling", async () => {
				await write(
					"src/.SERVER/A.luau",
					"src/C/.SERVER",
					"src/C/B.luau",
					"src/Net.SHARED/D.luau",
					"src/Types.SHARED.luau",
					"src/Data.Server.json",
					"src/Boot.Server.luau",
					"src/Hud.CLIENT.luau",
					"src/Lib.SHARED.luau"
				);

				const [warning, ...others] = await warningsOf("route.dotRoute");
				const renamed = Object.fromEntries(
					(warning.fixes ?? [])
						.filter(isRenameFix)
						.map(({ rename: { from, to } }) => [
							from.slice(at("src").length + 1),
							to.slice(at("src").length + 1),
						])
				);

				expect(others).toEqual([]);
				expect(renamed).toEqual({
					".SERVER": "@server",
					"C/.SERVER": "C/@server",
					"Net.SHARED": "Net@shared",
					"Types.SHARED.luau": "Types@shared.luau",
					"Data.Server.json": "Data@server.json",
					"Boot.Server.luau": "Boot.server.luau",
					"Hud.CLIENT.luau": "Hud.client.luau",
					"Lib.SHARED.luau": "Lib@shared.luau",
				});
			});

			it("should leave the letter-case warning to bare names when a dot route key differs in case", async () => {
				await write(
					"src/.SERVER/A.luau",
					"src/C/.SERVER",
					"src/SERVER/B.luau"
				);

				const mismatched = (await route({ routes: SHARED }))
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.caseMismatch"
					)
					.map(({ resource }) => resource);

				expect(mismatched).toEqual([abs("src/SERVER")]);
			});

			it("should warn about a dot-folder that spells a route, which is no routing folder", async () => {
				await write("src/.server/A.luau", "src/.Server/B.luau");

				const [warning] = await warningsOf("route.dotRoute");
				const paths = (await route({ routes: SHARED }))
					.unwrap()
					.routed.map(({ instancePath }) => instancePath.join("/"));

				expect(warning.message).toContain("2 names write a route key");
				expect(warning.fixes).toEqual([
					{
						rename: {
							from: at("src/.Server"),
							to: at("src/@server"),
						},
					},
					{
						rename: {
							from: at("src/.server"),
							to: at("src/@server"),
						},
					},
				]);
				expect(paths).toEqual([
					"ReplicatedStorage/shared/.Server/B",
					"ReplicatedStorage/shared/.server/A",
				]);
			});

			it("should leave a dot-file's folder and a dot part's name to the route above", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Types.shared.luau"
				);

				const files = (await route({ routes: SHARED }))
					.unwrap()
					.routed.map(({ entry, instancePath }) => [
						entry.source,
						instancePath.join("/"),
					]);

				expect(files).toEqual(
					expect.arrayContaining([
						[
							at("src/Inventory/Save.luau"),
							"ReplicatedStorage/shared/Inventory/Save",
						],
						[
							at("src/Types.shared.luau"),
							"ReplicatedStorage/shared/Types.shared",
						],
					])
				);
			});

			it("should name a variant's dot form for an @ that spells a variant, in a marker, a name or a folder", async () => {
				await write(
					"src/Experimental/@mock",
					"src/Experimental/A.luau",
					"src/Analytics@mock.luau",
					"src/Net@mock/B.luau"
				);

				const [warning] = await warningsOf("route.strayAt");

				expect(warning.message).toContain("3 names have");
				expect(warning.message).toContain(
					`${at("src/Experimental/@mock")} (did you mean ".mock"?)`
				);
				expect(warning.fixes).toContainEqual({
					rename: {
						from: at("src/Analytics@mock.luau"),
						to: at("src/Analytics.mock.luau"),
					},
				});
			});

			it("should warn about an @ marker that nearly spells a route", async () => {
				await write("src/Ui/@sever", "src/Ui/B.luau");

				const warnings = (await route({ routes: SHARED })).unwrap()
					.warnings;

				expect(
					warnings.find(({ code }) => code === "route.strayAt")
						?.message
				).toContain(`${at("src/Ui/@sever")} (did you mean "@server"?)`);
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
					`${abs("src/Analytics.mok.luau")} (did you mean ".mock"?)`
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

			it("should warn about a dot-file marker and a dot-folder one edit from a variant, and leave their files unmarked", async () => {
				await write(
					"src/M/.mok",
					"src/M/A.luau",
					"src/.mok/B.luau",
					"src/modules/C.luau",
					"src/.gitkeep",
					"src/.luaurc",
					"src/.spec"
				);

				const [warning, ...others] = await typos();
				const result = (
					await route({ variants: { mock: true } })
				).unwrap();

				expect(others).toEqual([]);
				expect(warning.message).toContain("2 names");
				expect(warning.fixes).toEqual([
					{ rename: { from: at("src/.mok"), to: at("src/.mock") } },
					{
						rename: {
							from: at("src/M/.mok"),
							to: at("src/M/.mock"),
						},
					},
				]);
				expect(
					result.routed.map(({ instancePath, variants }) => [
						instancePath.join("/"),
						variants.length,
					])
				).toEqual([
					["ReplicatedStorage/shared/.mok/B", 0],
					["ReplicatedStorage/shared/M/A", 0],
					["ReplicatedStorage/shared/modules/C", 0],
				]);
			});

			it("should give a dot-file or dot-folder that differs in letter case the letter-case warning, and leave a dot near a route silent", async () => {
				await write(
					"src/A/.MOCK",
					"src/A/X.luau",
					"src/.MOCK/Y.luau",
					"src/B/.sever",
					"src/B/Z.luau"
				);

				const warnings = (
					await route({ variants: { mock: true } })
				).unwrap().warnings;

				expect(
					warnings.map(({ code, resource }) => [code, resource])
				).toEqual([
					["route.caseMismatch", abs("src/A/.MOCK")],
					["route.caseMismatch", abs("src/.MOCK")],
				]);
			});

			it("should give a dot-file no fix when two variants are one edit away", async () => {
				await write("src/A/.mok", "src/A/X.luau");

				const [warning] = (
					await route({ variants: { mock: true, mob: false } })
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "variant.typo");

				expect(warning.message).toContain(`${abs("src/A/.mok")}`);
				expect(warning.fixes).toBeUndefined();
			});

			it("should warn about a variant's near miss in a folder that also routes", async () => {
				await write(
					"src/K.mok@server/A.luau",
					"src/.mok@server/B.luau"
				);

				const [warning] = await typos();

				expect(warning.fixes).toEqual([
					{
						rename: {
							from: at("src/.mok@server"),
							to: at("src/.mock@server"),
						},
					},
					{
						rename: {
							from: at("src/K.mok@server"),
							to: at("src/K.mock@server"),
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
	});
});
