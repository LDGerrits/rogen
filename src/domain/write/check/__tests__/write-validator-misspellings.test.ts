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
	indexOf,
	pipelineOf,
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

			it("should name a marker beside the rename for a folder inside a script folder, which may be a child the script requires, and give no one fix", async () => {
				await write(
					"src/Lib/Net/init.luau",
					"src/Lib/Net/SERVER/Remote.luau"
				);

				const errors = await errorsOf("route.caseMismatch", {
					routes: { ...ROUTES, shared: "ReplicatedStorage/shared" },
				});

				expect(listed(errors)).toEqual([
					[
						abs("src/Lib/Net/SERVER"),
						'"SERVER" differs from the route "server" only in letter case, so it would route nothing and its files would go to "*". Spell it "server", or, if the script beside it requires it as a child, add a marker file @shared in it to keep it there.',
					],
				]);
				expect(fixesOf(errors)).toEqual([]);
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

			it("should warn about a folder of files a pattern without a * matches, as a key written for a folder", async () => {
				await write("src/server/Main.luau", "src/Shop/Server/Tax.luau");

				const warnings = await warningsOf("route.folderPattern", {
					"[Ss]erver": "ServerScriptService",
					Client: "StarterPlayer/StarterPlayerScripts",
					"*": "ReplicatedStorage/Shared",
				});

				expect(listed(warnings)).toEqual([
					[
						abs("src/Shop/Server"),
						'matches the pattern "[Ss]erver", but a pattern never routes a folder, so the files in it that no route takes go to "*". No name key routes to that place: add one to "routes" and name the folder for it.',
					],
					[
						abs("src/server"),
						'matches the pattern "[Ss]erver", but a pattern never routes a folder, so the files in it that no route takes go to "*". No name key routes to that place: add one to "routes" and name the folder for it.',
					],
				]);
			});

			it("should warn only about the outermost folder a pattern without a * matches, with the rename to its name key", async () => {
				await write("src/backend/backend/Main.luau");

				const warnings = await warningsOf("route.folderPattern", {
					...ROUTES,
					"{api,backend}": "ServerScriptService",
				});

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/backend"),
				]);
				expect(fixesOf(warnings)).toEqual([
					{
						rename: {
							from: at("src/backend"),
							to: at("src/backend@server"),
						},
					},
				]);
			});

			it("should leave a folder whose name already has an error to that error", async () => {
				await write("src/Server/Main.luau");

				const routes = {
					...ROUTES,
					"[Ss]erver": "ServerScriptService",
				};

				expect(
					(await errorsOf("route.caseMismatch", { routes })).map(
						({ resource }) => resource
					)
				).toEqual([abs("src/Server")]);
				expect(
					await errorsOf("route.folderPattern", { routes })
				).toEqual([]);
			});

			it("should say nothing about a folder of files a pattern with a * matches, which may be a name of its own", async () => {
				await write("src/ShopController/Keys.luau");

				expect(await warningsOf("route.folderPattern")).toEqual([]);
			});

			it("should say nothing about a folder script a name routes", async () => {
				await write(
					"src/Input/InputController@client/init.luau",
					"src/Shop/ShopController.luau"
				);

				expect(await warningsOf("route.folderPattern")).toEqual([]);
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

			it("should say nothing about an @ in a package, version or other name far from every route key", async () => {
				await write(
					"src/Packages/QuickZone@1.7.0/init.luau",
					"src/Packages/sleitnick_knit@1.5.1/init.luau",
					"src/Packages/Promise@4.0.0-rc.1/init.luau",
					"src/Lib/Comm@v2/init.luau",
					"src/Lib/Tween@Latest.luau",
					"src/Lib/Mail@example.luau",
					"src/Lib/Button@Hover.luau"
				);

				const { warnings } = (await route()).unwrap();

				expect(warnings).toEqual([]);
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
			const SHARED = {
				...ROUTES,
				shared: "ReplicatedStorage/shared",
				Story: "ReplicatedStorage/stories",
			};
			const dotErrors = (overrides: ResolvedConfigSpec = {}) =>
				errorsOf("route.dotRoute", { routes: SHARED, ...overrides });
			const renamesOf = (errors: readonly Diagnostic[]) =>
				Object.fromEntries(
					fixesOf(errors)
						.filter(isRenameFix)
						.map(({ rename: { from, to } }) => [
							from.slice(at("src").length + 1),
							to.slice(at("src").length + 1),
						])
				);
			/** Where routing places each file, past errors that stop the write. */
			const placed = async () =>
				(
					await pipelineOf(fs, await indexOf(fs, [abs("src")])).place(
						configOf({ routes: SHARED })
					)
				)
					.unwrap()
					.routed.map(({ entry, instancePath }) => [
						entry.source,
						instancePath.join("/"),
					]);

			it("should stop at a dot-file or dot-folder named for a route, and at Rojo's suffix on a folder, naming each @ form", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Net.server/B.luau",
					"src/.client/C.luau",
					"src/Boot.server.luau"
				);

				const errors = await dotErrors();

				expect(listed(errors)).toEqual(
					expect.arrayContaining([
						[at("src/Inventory/.server"), 'write "@server"'],
						[at("src/Net.server"), 'write "Net@server"'],
						[at("src/.client"), 'write "@client"'],
					])
				);
				expect(errors).toHaveLength(3);
				expect(
					errors.every(
						({ severity }) => severity === DiagnosticSeverity.Error
					)
				).toBe(true);
				expect(renamesOf(errors)).toEqual({
					"Inventory/.server": "Inventory/@server",
					"Net.server": "Net@server",
					".client": "@client",
				});
			});

			it("should leave any other route key after a dot in the name, as a tool's own suffix may be", async () => {
				await write(
					"src/Types.shared.luau",
					"src/Net.shared/A.luau",
					"src/Button.story.luau",
					"src/Hud.Story.luau",
					"src/Foo.spec.luau",
					"src/Lib.SHARED.luau"
				);

				const result = await route({ routes: SHARED });

				expect(result.isOk()).toBe(true);
				expect(
					result
						.unwrap()
						.warnings.filter(
							({ code }) => code === "route.dotRoute"
						)
				).toEqual([]);
			});

			it("should stop at Rojo's .server and .client on a data file or model, which has no script class", async () => {
				await write(
					"src/Data.server.json",
					"src/Hud.client.rbxmx",
					"src/Gun.server.model.json",
					"src/Boot.client.luau"
				);

				expect(renamesOf(await dotErrors())).toEqual({
					"Data.server.json": "Data@server.json",
					"Hud.client.rbxmx": "Hud@client.rbxmx",
					"Gun.server.model.json": "Gun@server.model.json",
				});
			});

			it("should stop at Rojo's suffix in another letter case, renaming a script's to Rojo's own spelling", async () => {
				await write(
					"src/.SERVER/A.luau",
					"src/C/.SERVER",
					"src/C/B.luau",
					"src/Data.Server.json",
					"src/Boot.Server.luau",
					"src/Hud.CLIENT.luau",
					"src/Net.SHARED/D.luau"
				);

				expect(renamesOf(await dotErrors())).toEqual({
					".SERVER": "@server",
					"C/.SERVER": "C/@server",
					"Data.Server.json": "Data@server.json",
					"Boot.Server.luau": "Boot.server.luau",
					"Hud.CLIENT.luau": "Hud.client.luau",
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

				const errors = await dotErrors({
					routes: { ...SHARED, Shared: "ReplicatedStorage/shared" },
				});

				expect(listed(errors)).toEqual(
					expect.arrayContaining([
						[
							at("src/Odd/Shared/Ui.client"),
							'the "Shared" route governs it, so "@client" would do nothing; move it out of that route\'s files to route it',
						],
						[at("src/Odd/Net.server"), 'write "Net@server"'],
					])
				);
				expect(renamesOf(errors)).toEqual({
					"Odd/Net.server": "Odd/Net@server",
				});
			});

			it("should still offer the rename when the route below the folder is one of its own", async () => {
				await write("src/Ui.client/Sub@server/A.luau");

				const [error] = await dotErrors();

				expect(error.message).toBe('write "Ui@client"');
				expect(renamesOf([error])).toEqual({
					"Ui.client": "Ui@client",
				});
			});

			it("should leave a dot-file's folder and a dot-folder's files to the route above", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/.Server/B.luau"
				);

				expect(await placed()).toEqual(
					expect.arrayContaining([
						[
							at("src/Inventory/Save.luau"),
							"ReplicatedStorage/shared/Inventory/Save",
						],
						[
							at("src/.Server/B.luau"),
							"ReplicatedStorage/shared/.Server/B",
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
