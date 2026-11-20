import { toPosix } from "../../../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	isRenameFix,
} from "../../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../../config/__tests__/mock-config-service.js";
import {
	abs,
	prepareAndPlace,
	configOf,
	writeFiles,
} from "../../__tests__/fixtures.js";

describe("WriteValidator rules", () => {
	const at = (...segments: string[]) => toPosix(abs(...segments));
	const listed = (warnings: readonly Diagnostic[]) =>
		warnings.map(({ resource, message }) => [resource, message]);
	const fixesOf = (warnings: readonly Diagnostic[]) =>
		warnings.flatMap(({ fixes = [] }) => fixes);
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
				await prepareAndPlace(
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

		/** The errors of `code` that stop the write. */
		const errorsOf = async (
			code: string,
			overrides: ResolvedConfigSpec = {}
		) => {
			const result = await route(overrides);
			return result.isErr()
				? result.error.diagnostics.filter(
						(diagnostic) => diagnostic.code === code
					)
				: [];
		};

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
					resource: abs("src/Inventory/Sever"),
					message: 'did you mean "Server"?',
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

				expect(warning.message).toBe('did you mean "Sever"?');
			});

			it("should rename to the key as it is spelled, which a folder must match exactly", async () => {
				await write("src/sever/Save.luau");

				const [warning] = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warning.fixes).toEqual([
					{ rename: { from: at("src/sever"), to: at("src/Server") } },
				]);
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

			it("should not warn about a plural, which is a name of its own", async () => {
				await write("src/Servers/Save.luau", "src/Clientes/Load.luau");

				expect(
					await folderTypos({
						routes: {
							Server: "ServerScriptService",
							Client: "StarterPlayer/StarterPlayerScripts",
							"*": "ReplicatedStorage",
						},
					})
				).toEqual([]);
			});

			it("should not warn under a route that governs the folder, where its name would route nothing", async () => {
				await write("src/server/Clent/Save.luau");

				expect(await folderTypos()).toEqual([]);
			});

			it("should give no rename onto a folder that is already there", async () => {
				await write("src/Shop/Sever/A.luau", "src/Shop/server/B.luau");

				const [warning] = await folderTypos();

				expect(warning.resource).toBe(abs("src/Shop/Sever"));
				expect(warning.fixes).toBeUndefined();
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
					"src/Shared/SERVER/Other.luau"
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

			it("should read the name with its parentheses off", async () => {
				await write("src/(Sever)/A.luau", "src/^Sever/B.luau");

				const warnings = await folderTypos({
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/(Sever)"),
					abs("src/^Sever"),
				]);
			});
		});

		describe("letter case mismatches", () => {
			const caseErrors = () => errorsOf("route.caseMismatch");

			it("should stop on a folder named like a route in different case that no route governs, at that folder", async () => {
				await write("src/SERVER/Save.luau");

				const [error] = await caseErrors();

				expect(error).toMatchObject({
					severity: DiagnosticSeverity.Error,
					resource: abs("src/SERVER"),
				});
				expect(error.message).toBe(
					'"SERVER" differs from the route "server" only in letter case, so it would route nothing and its files would go to "*". Spell it "server".'
				);
			});

			it("should stop on a marker file named like a route in different case as on any @ that misses its route", async () => {
				await write("src/Inventory/@SERVER", "src/Inventory/Save.luau");

				expect(await caseErrors()).toEqual([]);
				expect(await errorsOf("route.strayAt")).toMatchObject([
					{
						severity: DiagnosticSeverity.Error,
						resource: abs("src/Inventory/@SERVER"),
						message:
							'"@SERVER" names no route; did you mean "@server"?',
						fixes: [
							{
								rename: {
									from: at("src/Inventory/@SERVER"),
									to: at("src/Inventory/@server"),
								},
							},
						],
					},
				]);
			});

			it("should report a folder once however many files it holds", async () => {
				await write("src/SERVER/A.luau", "src/SERVER/B.luau");

				expect(await caseErrors()).toHaveLength(1);
			});

			it("should report each mismatched name, the first letter alone included", async () => {
				await write(
					"src/SERVER/A.luau",
					"src/CLIENT/B.luau",
					"src/Server/C.luau"
				);

				expect(
					(await caseErrors()).map(({ resource }) => resource).sort()
				).toEqual([
					abs("src/CLIENT"),
					abs("src/SERVER"),
					abs("src/Server"),
				]);
			});

			it("should not report a name that matches exactly or not at all", async () => {
				await write(
					"src/server/A.luau",
					"src/Inventory/B.server.luau",
					"src/Inventory/HTTPServer.luau",
					"src/Inventory/Player.luau"
				);

				expect(
					(await route())
						.unwrap()
						.warnings.filter(
							({ code }) => code === "route.caseMismatch"
						)
				).toEqual([]);
			});

			it("should fix each mismatch by renaming the name to the key's spelling", async () => {
				await write("src/(SERVER)/A.luau");

				expect(fixesOf(await caseErrors())).toEqual([
					{
						rename: {
							from: at("src/(SERVER)"),
							to: at("src/(server)"),
						},
					},
				]);
			});

			it("should stop on a mismatch where no route would place the file", async () => {
				await write("src/SERVER/Save.luau");

				expect(
					await errorsOf("route.caseMismatch", {
						routes: { server: "ServerScriptService" },
					})
				).toHaveLength(1);
			});

			it("should leave a folder in another case under a route alone, as the outer route places its files whatever its name", async () => {
				await write("src/server/CLIENT/A.luau");

				const { warnings, routed } = (await route()).unwrap();

				expect(warnings).toEqual([]);
				expect(routed.map(({ instancePath }) => instancePath)).toEqual([
					["ServerScriptService", "CLIENT", "A"],
				]);
			});

			it("should warn that server code ships to clients from a server folder in any case under a client route", async () => {
				await write("src/client/SERVER/A.luau");

				const { warnings } = (await route()).unwrap();

				expect(
					warnings.map(({ code, resource }) => [code, resource])
				).toEqual([
					[
						"route.serverCodeShipped",
						abs("src/client/SERVER/A.luau"),
					],
				]);
			});
		});

		describe("patterns that just miss", () => {
			const PATTERNS = {
				...ROUTES,
				"*Controller": "StarterPlayer/StarterPlayerScripts",
			};
			const warningsOf = async (
				code: string,
				routes: Record<string, string> = PATTERNS
			) =>
				(await route({ routes }))
					.unwrap()
					.warnings.filter((warning) => warning.code === code);

			it("should warn about a file that matches a pattern only ignoring letter case", async () => {
				await write("src/Shop/ShopController.luau");

				expect(
					listed(
						await warningsOf("route.patternCase", {
							...ROUTES,
							"*controller": "StarterPlayer/StarterPlayerScripts",
						})
					)
				).toEqual([
					[
						abs("src/Shop/ShopController.luau"),
						'matches the pattern "*controller" only ignoring letter case, so it goes to "*". A pattern matches letter case exactly; fix the pattern\'s case or the file\'s.',
					],
				]);
			});

			it("should warn about a folder script whose folder a pattern matches, which no pattern routes, with the rename that routes it there", async () => {
				await write(
					"src/Input/InputController/init.luau",
					"src/Input/InputController/Keys.luau"
				);

				const [warning] = await warningsOf("route.folderPattern");

				expect(warning).toMatchObject({
					resource: abs("src/Input/InputController"),
					message:
						'matches the pattern "*Controller", but a pattern never routes a folder or its init script, so it and its files go to "*". Name it InputController@client to route it there.',
					fixes: [
						{
							rename: {
								from: at("src/Input/InputController"),
								to: at("src/Input/InputController@client"),
							},
						},
					],
				});
			});

			it("should say nothing about a folder script a name routes, or a file that matches", async () => {
				await write(
					"src/Input/InputController@client/init.luau",
					"src/Shop/ShopController.luau"
				);

				expect(await warningsOf("route.folderPattern")).toEqual([]);
				expect(await warningsOf("route.patternCase")).toEqual([]);
			});
		});

		describe("@ that routes nowhere", () => {
			const strayWarnings = () => errorsOf("route.strayAt");

			it("should stop the write at every file and folder, naming the closest route", async () => {
				await write(
					"src/Inventory/Save@sever.luau",
					"src/Queue@clent/Load.luau",
					"src/Inventory/Fine@server.luau"
				);

				const warnings = await strayWarnings();

				expect(warnings[0].severity).toBe(DiagnosticSeverity.Error);
				expect(listed(warnings)).toEqual([
					[
						at("src/Inventory/Save@sever.luau"),
						'"@sever" names no route; did you mean "@server"?',
					],
					[
						at("src/Queue@clent"),
						'"@clent" names no route; did you mean "@client"?',
					],
				]);
			});

			it("should list every stray @ before a folder in another case, so each code reads as one group", async () => {
				await write(
					"src/A@sever.luau",
					"src/B/SERVER/X.luau",
					"src/C@sever.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code }) => code)
				).toEqual([
					"route.strayAt",
					"route.strayAt",
					"route.caseMismatch",
				]);
			});

			it("should say when a declared route isn't at the end of the name", async () => {
				await write("src/Save@server.bak.luau");

				const [warning] = await strayWarnings();

				expect(warning.message).toBe(
					'"@server" must end the name to route it'
				);
			});

			it("should report a mistyped @ for another route under a route that governs it as one that does nothing there, with no rename to follow", async () => {
				await write(
					"src/server/Up@clent.luau",
					"src/server/M/@CLIENT",
					"src/server/M/A.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ code, resource, message, fixes }) => ({
								code,
								resource,
								message,
								fixes,
							})
						)
				).toEqual([
					{
						code: "route.ignoredAt",
						resource: abs("src/server/M/@CLIENT"),
						message:
							'"@CLIENT" does nothing here, because the "server" route already governs this folder. Remove it, or move the folder out of the "server" route\'s files.',
						fixes: undefined,
					},
					{
						code: "route.ignoredAt",
						resource: abs("src/server/Up@clent.luau"),
						message:
							'"@clent" does nothing here, because the "server" route already governs this file. Remove it, or move the file out of the "server" route\'s files.',
						fixes: undefined,
					},
				]);
			});

			it("should keep the rename of a mistyped @ that restates the route governing it", async () => {
				await write("src/server/Up@Server.luau");

				expect(fixesOf(await strayWarnings())).toEqual([
					{
						rename: {
							from: at("src/server/Up@Server.luau"),
							to: at("src/server/Up@server.luau"),
						},
					},
				]);
			});

			it("should give no rename onto a name that is already there", async () => {
				await write("src/Save@sever.luau", "src/Save@server.luau");

				const [error] = await strayWarnings();

				expect(error.fixes).toBeUndefined();
			});

			it("should not stop on a route that restates the outer one", async () => {
				await write("src/server/Net/Save@server.luau");

				expect(await strayWarnings()).toEqual([]);
			});

			it("should fix each name by renaming it to the closest route, a folder as a folder", async () => {
				await write(
					"src/Inventory/Save@sever.luau",
					"src/(Queue@clent)/Load.luau"
				);

				const warnings = await strayWarnings();

				expect(warnings.map(({ fixes }) => fixes)).toEqual([
					[
						{
							rename: {
								from: at("src/(Queue@clent)"),
								to: at("src/(Queue@client)"),
							},
						},
					],
					[
						{
							rename: {
								from: at("src/Inventory/Save@sever.luau"),
								to: at("src/Inventory/Save@server.luau"),
							},
						},
					],
				]);
			});

			it("should give no fix when two routes are as close", async () => {
				await write("src/Save@serer.luau");

				const [warning] = await errorsOf("route.strayAt", {
					routes: { ...ROUTES, sever: "Workspace" },
				});

				expect(warning.fixes).toBeUndefined();
			});

			it("should give no fix for a declared route that isn't at the end", async () => {
				await write("src/Save@server.bak.luau");

				const [warning] = await strayWarnings();

				expect(warning.fixes).toBeUndefined();
			});
		});

		describe("route keys after a dot", () => {
			const SHARED = { ...ROUTES, shared: "ReplicatedStorage/shared" };
			const warningsOf = async (code: string) =>
				(await route({ routes: SHARED }))
					.unwrap()
					.warnings.filter((warning) => warning.code === code);

			it("should warn at a dot-file and each name with a dot part that spells a route, naming each @ form", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Inventory/Types.shared.luau",
					"src/Net.shared/A.luau",
					"src/Net.server/B.luau",
					"src/Boot.server.luau"
				);

				const warnings = await warningsOf("route.dotRoute");

				expect(listed(warnings)).toEqual(
					expect.arrayContaining([
						[at("src/Inventory/.server"), 'write "@server"'],
						[
							at("src/Inventory/Types.shared.luau"),
							'write "Types@shared.luau"',
						],
						[at("src/Net.shared"), 'write "Net@shared"'],
						[at("src/Net.server"), 'write "Net@server"'],
					])
				);
				expect(warnings).toHaveLength(4);
				expect(
					warnings.find(
						({ resource }) => resource === at("src/Net.server")
					)?.fixes
				).toEqual([
					{
						rename: {
							from: at("src/Net.server"),
							to: at("src/Net@server"),
						},
					},
				]);
			});

			it("should warn about Rojo's .server and .client on a data file or model, which has no script class", async () => {
				await write(
					"src/Data.server.json",
					"src/Hud.client.rbxmx",
					"src/Gun.server.model.json",
					"src/Boot.client.luau"
				);

				const warnings = await warningsOf("route.dotRoute");

				expect(warnings.map(({ message }) => message)).toEqual(
					expect.arrayContaining([
						'write "Data@server.json"',
						'write "Hud@client.rbxmx"',
					])
				);
				expect(warnings).toHaveLength(3);
				expect(fixesOf(warnings)).toContainEqual({
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

				const renamed = Object.fromEntries(
					fixesOf(await warningsOf("route.dotRoute"))
						.filter(isRenameFix)
						.map(({ rename: { from, to } }) => [
							from.slice(at("src").length + 1),
							to.slice(at("src").length + 1),
						])
				);

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

			it("should leave the letter-case error to bare names when a dot route key differs in case", async () => {
				await write(
					"src/.SERVER/A.luau",
					"src/C/.SERVER",
					"src/SERVER/B.luau"
				);

				expect(
					(
						await errorsOf("route.caseMismatch", { routes: SHARED })
					).map(({ resource }) => resource)
				).toEqual([abs("src/SERVER")]);
			});

			it("should not offer a rename that another route's folder would ignore", async () => {
				await write(
					"src/Odd/Shared/Ui.client/A.luau",
					"src/Odd/Net.server/B.luau"
				);

				const warnings = (
					await route({
						routes: {
							...SHARED,
							Shared: "ReplicatedStorage/shared",
						},
					})
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "route.dotRoute");

				expect(warnings).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							resource: at("src/Odd/Shared/Ui.client"),
							message:
								'the "Shared" route governs it, so "@client" would do nothing; move it out of that route\'s files to route it',
						}),
						expect.objectContaining({
							resource: at("src/Odd/Net.server"),
							message: 'write "Net@server"',
						}),
					])
				);
				expect(fixesOf(warnings)).toEqual([
					{
						rename: {
							from: at("src/Odd/Net.server"),
							to: at("src/Odd/Net@server"),
						},
					},
				]);
			});

			it("should still offer the rename when the route below the folder is one of its own", async () => {
				await write("src/Ui.client/Sub@server/A.luau");

				const [warning] = await warningsOf("route.dotRoute");

				expect(warning.message).toBe('write "Ui@client"');
				expect(warning.fixes).toEqual([
					{
						rename: {
							from: at("src/Ui.client"),
							to: at("src/Ui@client"),
						},
					},
				]);
			});

			it("should warn about a dot-folder that spells a route, which is no routing folder", async () => {
				await write("src/.server/A.luau", "src/.Server/B.luau");

				const warnings = await warningsOf("route.dotRoute");
				const paths = (await route({ routes: SHARED }))
					.unwrap()
					.routed.map(({ instancePath }) => instancePath.join("/"));

				expect(fixesOf(warnings)).toEqual([
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

			it("should stop on an @ marker that nearly spells a route", async () => {
				await write("src/Ui/@sever", "src/Ui/B.luau");

				expect(
					listed(await errorsOf("route.strayAt", { routes: SHARED }))
				).toEqual([
					[
						at("src/Ui/@sever"),
						'"@sever" names no route; did you mean "@server"?',
					],
				]);
			});
		});
	});
});
