import {
	FileLocation,
	InstanceLocation,
} from "../../../domain/build/build-service.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { InstanceReference } from "../../../domain/roblox/roblox.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { WhereAnswers } from "../where-answers.js";
import { WhereFileEntry } from "../where-document.js";
import { WhereLog } from "../where-log.js";
import { documentOf, lineOf, reportOf } from "./where-fixtures.js";

const luauOf = (source: string): { luau?: "module" | "script" } =>
	/\.luau?$/.test(source)
		? {
				luau: /\.(server|client|plugin)\.luau?$/.test(source)
					? "script"
					: "module",
			}
		: {};

describe("WhereLog", () => {
	describe("a location", () => {
		it("should give the instance path, the route and how it matched", () => {
			expect(
				lineOf({
					status: "placed",
					source: "/repo/src/Net/Http@client.luau",
					exists: true,
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "suffix",
				})
			).toBe(
				"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Http · route Client (suffix)"
			);
		});

		it("should say a ^ name was hoisted", () => {
			expect(
				lineOf({
					status: "placed",
					source: "/repo/src/Player/^Animate.client.luau",
					exists: true,
					instancePath: [
						"StarterPlayer",
						"StarterCharacterScripts",
						"Animate",
					],
					route: "character",
					routeMatch: "marker",
					hoisted: true,
				})
			).toBe(
				"src/Player/^Animate.client.luau -> StarterPlayer/StarterCharacterScripts/Animate · route character (marker) · hoisted by ^"
			);
		});

		it("should list the other nodes a copied init script is", () => {
			expect(
				lineOf({
					status: "placed",
					source: "/repo/src/Net/init.luau",
					exists: true,
					instancePath: ["ServerScriptService", "Net"],
					alsoAt: [["StarterPlayer", "StarterPlayerScripts", "Net"]],
					route: "server",
					routeMatch: "copy",
				})
			).toBe(
				"src/Net/init.luau -> ServerScriptService/Net · route server (copy) · also StarterPlayer/StarterPlayerScripts/Net"
			);
		});

		it("should name the tree node that mounts a path", () => {
			expect(
				lineOf({
					status: "mounted",
					source: "/repo/src/Vendor/Lib.luau",
					exists: true,
					node: ["ReplicatedStorage", "Vendor"],
				})
			).toBe(
				"src/Vendor/Lib.luau -> mounted · the tree mounts it at ReplicatedStorage/Vendor"
			);
		});

		it("should name the instance a mounted file becomes, and the mount", () => {
			expect(
				lineOf({
					status: "mounted",
					source: "/repo/src/Vendor/Lib.luau",
					exists: true,
					node: ["ReplicatedStorage", "Vendor"],
					instancePath: ["ReplicatedStorage", "Vendor", "Lib"],
				})
			).toBe(
				"src/Vendor/Lib.luau -> ReplicatedStorage/Vendor/Lib · inside the mount at ReplicatedStorage/Vendor, which Rojo reads"
			);
			expect(
				lineOf({
					status: "mounted",
					source: "/repo/src/Vendor/init.luau",
					exists: true,
					node: ["ReplicatedStorage", "Vendor"],
					instancePath: ["ReplicatedStorage", "Vendor"],
				})
			).toBe(
				"src/Vendor/init.luau -> ReplicatedStorage/Vendor · mounted, which Rojo reads"
			);
		});

		it("should name the glob that ignored a path, relative to the working directory", () => {
			expect(
				lineOf({
					status: "ignored",
					source: "/repo/src/A.spec.luau",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
				})
			).toBe("src/A.spec.luau -> ignored · matches **/*.spec.luau");
		});

		it.each([
			["**/*.tmp", "**/*.tmp"],
			["C:/repo/**/*.spec.luau", "**/*.spec.luau"],
		])(
			"should keep a glob of Rogen's own as it is and make a drive glob relative to the working directory: %s",
			(pattern, shown) => {
				const report = new WhereLog(
					"C:\\repo",
					new WhereAnswers({
						everyFile: false,
						asked: [],
						errors: [],
						configs: [
							{
								config: mockConfig({}),
								files: [
									{
										status: "ignored",
										source: "C:/repo/src/A.luau",
										exists: true,
										pattern,
									},
								],
								instances: [],
								queried: [],
								diagnostics: [],
							},
						],
					})
				);

				expect(report.lines()[0]).toContain(`matches ${shown}`);
			}
		);

		it.each<[FileLocation, string]>([
			[
				{
					status: "replaced",
					source: "/repo/src/T.lua",
					exists: true,
					by: "/repo/src/T.luau",
				},
				"src/T.lua -> replaced by src/T.luau",
			],
			[
				{
					status: "displaced",
					source: "/repo/src/Save.luau",
					exists: true,
					node: ["ServerScriptService", "Save"],
				},
				"src/Save.luau -> displaced · the tree defines ServerScriptService/Save",
			],
			[
				{
					status: "unrouted",
					source: "/repo/src/U.luau",
					exists: true,
				},
				"src/U.luau -> unrouted · no route matches it",
			],
			[
				{ status: "outside", source: "/repo/README.md", exists: true },
				"README.md -> outside the source paths",
			],
			[
				{
					status: "notInstance",
					source: "/repo/src/N.md",
					exists: true,
				},
				"src/N.md -> not an instance",
			],
			[
				{ status: "missing", source: "/repo/src/X", exists: true },
				"src/X -> does not exist",
			],
			[
				{ status: "empty", source: "/repo/src/E", exists: true },
				"src/E -> empty · no file in it places",
			],
			[
				{ status: "skipped", source: "/repo/src/L", exists: true },
				"src/L -> skipped · the link loops or points at nothing",
			],
		])("should describe %j", (location, line) => {
			expect(lineOf(location)).toBe(line);
		});
	});

	describe("several configs", () => {
		const outside = (name: string): FileLocation => ({
			status: "outside",
			source: `/repo/${name}`,
			exists: true,
		});
		const missing = (name: string): FileLocation => ({
			status: "missing",
			source: `/repo/${name}`,
			exists: true,
		});
		const report = reportOf;

		it("should print one config's lines as they are", () => {
			expect(report([["default", [outside("a")]]]).lines()).toEqual([
				"a -> outside the source paths",
			]);
		});

		it("should print a line once when every config gives the same one", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [outside("a")]],
				]).lines()
			).toEqual(["a -> outside the source paths"]);
		});

		const placed = (name: string, at: string): FileLocation => ({
			status: "placed",
			source: `/repo/${name}`,
			exists: true,
			instancePath: ["ReplicatedStorage", at],
			route: "*",
			routeMatch: "fallback",
		});

		it("should prefix each config's line when they differ", () => {
			expect(
				report([
					["default", [placed("a", "A")]],
					["lobby", [placed("a", "B")]],
				]).lines()
			).toEqual([
				"default: a -> ReplicatedStorage/A · route * (fallback)",
				"lobby: a -> ReplicatedStorage/B · route * (fallback)",
			]);
		});

		it("should drop a config's outside answer when another config places the path, and head the rest", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [placed("a", "A")]],
				]).lines()
			).toEqual(["lobby: a -> ReplicatedStorage/A · route * (fallback)"]);
		});

		it("should print a path every config places the same way once, unheaded, beside one only some place", () => {
			expect(
				report([
					["default", [placed("a", "A"), outside("b")]],
					["lobby", [placed("a", "A"), placed("b", "B")]],
					["match", [placed("a", "A"), outside("b")]],
				]).lines()
			).toEqual([
				"a -> ReplicatedStorage/A · route * (fallback)",
				"lobby: b -> ReplicatedStorage/B · route * (fallback)",
			]);
		});

		it("should count any answer but outside as placing a path", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [missing("a")]],
				]).lines()
			).toEqual(["lobby: a -> does not exist"]);
		});

		it("should prefix a line that only some configs have", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [outside("a"), missing("b")]],
				]).lines()
			).toEqual([
				"a -> outside the source paths",
				"lobby: b -> does not exist",
			]);
		});

		it("should keep the order the paths were first given in", () => {
			expect(
				report([["default", [missing("b"), missing("a")]]]).lines()
			).toEqual(["b -> does not exist", "a -> does not exist"]);
		});

		it("should sort the paths when every file was asked about", () => {
			expect(
				report(
					[
						["default", [missing("b")]],
						["lobby", [outside("a")]],
					],
					true
				).lines()
			).toEqual([
				"lobby: a -> outside the source paths",
				"default: b -> does not exist",
			]);
		});
	});

	describe("require", () => {
		const placedAt = (
			source: string,
			instancePath: string[]
		): FileLocation => ({
			status: "placed",
			source,
			exists: true,
			instancePath,
			route: "*",
			routeMatch: "fallback",
			...luauOf(source),
		});
		const entry = (location: FileLocation) =>
			documentOf([["default", [location]]])
				.locations[0] as WhereFileEntry & { require?: string };

		it("should give a placed Luau module the expression that reaches it, after its instance path", () => {
			const module = entry(
				placedAt("/repo/src/Inventory/Types.luau", [
					"ReplicatedStorage",
					"Shared",
					"Inventory",
					"Types",
				])
			);

			expect(module.require).toBe(
				'game:GetService("ReplicatedStorage").Shared.Inventory.Types'
			);
			expect(Object.keys(module).slice(3, 6)).toEqual([
				"exists",
				"instancePath",
				"require",
			]);
		});

		it("should write names that aren't identifiers as indexes", () => {
			expect(
				entry(
					placedAt("/repo/src/Foo Bar/end.luau", [
						"ReplicatedStorage",
						"Foo Bar",
						"end",
					])
				).require
			).toBe('game:GetService("ReplicatedStorage")["Foo Bar"]["end"]');
		});

		it.each([
			[
				"a Script",
				"/repo/src/Hit.server.luau",
				["ServerScriptService", "Hit"],
			],
			[
				"a roblox-ts source",
				"/repo/src/Hit.ts",
				["ReplicatedStorage", "Hit"],
			],
			[
				"a module in StarterPlayerScripts",
				"/repo/src/Http.luau",
				["StarterPlayer", "StarterPlayerScripts", "Http"],
			],
			[
				"a data file",
				"/repo/src/Data.json",
				["ReplicatedStorage", "Data"],
			],
		])("should give none for %s", (_, source, instancePath) => {
			expect(entry(placedAt(source, instancePath))).not.toHaveProperty(
				"require"
			);
		});

		it("should give none for a location that isn't placed", () => {
			expect(
				entry({
					status: "replaced",
					source: "/repo/src/Http.lua",
					exists: true,
					by: "/repo/src/Http.luau",
				})
			).not.toHaveProperty("require");
		});

		it("should hold the expressions of a path beside its lines, once", () => {
			const location = placedAt("/repo/src/Util.luau", [
				"ReplicatedStorage",
				"Util",
			]);
			const [block] = reportOf([
				["default", [location]],
				["lobby", [location]],
			]).blocks();

			expect(block.requires).toEqual([
				'game:GetService("ReplicatedStorage").Util',
			]);
		});
	});

	describe("the require lines of a named file", () => {
		const placed = (
			instancePath: string[],
			named = true
		): FileLocation => ({
			status: "placed",
			source: "/repo/src/Util.luau",
			exists: true,
			instancePath,
			route: "*",
			routeMatch: "fallback",
			...luauOf("/repo/src/Util.luau"),
			...(named && { named: true as const }),
		});
		const requireLines = (...configs: [string, FileLocation][]) =>
			reportOf(
				configs.map(([label, location]) => [label, [location]])
			).blocks()[0].requireLines;

		it("should say a script is not a module, and a file whose path no require reaches why", () => {
			expect(
				requireLines([
					"default",
					{
						...placed(["ReplicatedStorage", "Boot"]),
						source: "/repo/src/Boot.client.luau",
						...luauOf("/repo/src/Boot.client.luau"),
					},
				])
			).toEqual([
				"  no require by this path: a script runs on its own and is not a module",
			]);
			expect(
				requireLines([
					"default",
					placed(["StarterPlayer", "StarterPlayerScripts", "Util"]),
				])
			).toEqual([
				"  no require by this path: StarterPlayerScripts is cloned into each player",
			]);
		});

		it("should give a module's require, and none for a file found in a folder", () => {
			const path = ["ReplicatedStorage", "Util"];

			expect(requireLines(["default", placed(path)])).toEqual([
				'  require(game:GetService("ReplicatedStorage").Util)',
			]);
			expect(requireLines(["default", placed(path, false)])).toEqual([]);
		});

		it.each(["/repo/src/Hit.ts", "/repo/src/Data.json"])(
			"should give none for %s, which is not Luau",
			(source) => {
				expect(
					requireLines([
						"default",
						{
							...placed(["ReplicatedStorage", "X"]),
							source,
							...{ luau: luauOf(source).luau },
						},
					])
				).toEqual([]);
			}
		);

		it("should say it once when every config places the file alike", () => {
			const location = placed(["ReplicatedStorage", "Util"]);

			expect(
				requireLines(["default", location], ["lobby", location])
			).toHaveLength(1);
		});

		it("should head each config's line when they place the file apart", () => {
			expect(
				requireLines(
					["default", placed(["ReplicatedStorage", "Util"])],
					["lobby", placed(["ReplicatedFirst", "Util"])]
				)
			).toEqual([
				'  default: require(game:GetService("ReplicatedStorage").Util)',
				'  lobby: require(game:GetService("ReplicatedFirst").Util)',
			]);
		});
	});

	describe("an instance no file places", () => {
		const unplaced = (
			text: string,
			folders: string[] = [],
			fixes: InstanceLocation["fixes"] = []
		): InstanceLocation => ({
			reference: InstanceReference.parse(text)!,
			files: [],
			folders,
			fixes,
		});
		const linesOf = (
			instance: InstanceLocation,
			diagnostics: Diagnostic[] = []
		) => reportOf([["default", [], [instance], diagnostics]]).lines();

		it("should say no file places it", () => {
			expect(linesOf(unplaced("Workspace.Missing"))).toEqual([
				"Workspace.Missing -> no file places it",
			]);
		});

		it("should name each folder a new file for it goes in", () => {
			expect(
				linesOf(
					unplaced("ServerScriptService.Inventory.NewThing", [
						"/repo/src/Inventory/Server",
						"/repo/lib/Inventory/Server",
					])
				)
			).toEqual([
				"ServerScriptService.Inventory.NewThing -> no file places it · a new file goes in src/Inventory/Server/ or lib/Inventory/Server/",
			]);
		});

		it("should name a rename that would place it, by its new name in the same folder and its path in another", () => {
			expect(
				linesOf(
					unplaced(
						"ServerScriptService.Stray.Buy",
						[],
						[
							{
								code: "route.strayAt",
								rename: {
									from: "/repo/src/Stray/Buy@sever.luau",
									to: "/repo/src/Stray/Buy@Server.luau",
								},
							},
							{
								code: "route.misplaced",
								rename: {
									from: "/repo/src/Stray/Buy.luau",
									to: "/repo/src/Shop/Server/Buy.luau",
								},
							},
						]
					)
				)
			).toEqual([
				"ServerScriptService.Stray.Buy -> no file places it · src/Stray/Buy@sever.luau would, renamed to Buy@Server.luau (route.strayAt) · src/Stray/Buy.luau would, renamed to src/Shop/Server/Buy.luau (route.misplaced)",
			]);
		});

		it("should print no diagnostic under it, which is about a file", () => {
			expect(
				linesOf(unplaced("Workspace.Missing"), [
					warningDiagnostic(
						"route.strayAt",
						{ resource: "/repo/src/A.luau" },
						"A stray @."
					),
				])
			).toEqual(["Workspace.Missing -> no file places it"]);
		});
	});

	describe("a missing folder", () => {
		it("should say how to ask about a folder that doesn't exist", () => {
			expect(
				lineOf({
					status: "missing",
					source: "/repo/src/Combat",
					exists: false,
					folder: true,
				})
			).toBe(
				"src/Combat -> does not exist · name a file in it to see where it would land"
			);
		});

		it("should leave a missing file as it is", () => {
			expect(
				lineOf({
					status: "missing",
					source: "/repo/src/Hit.luau",
					exists: false,
				})
			).toBe("src/Hit.luau -> does not exist");
		});
	});

	describe("emptyLine", () => {
		it("should name the source paths of every config once, relative to the working directory", () => {
			const report = new WhereLog(
				"/repo",
				new WhereAnswers({
					everyFile: true,
					asked: [],
					errors: [],
					configs: [
						{
							config: mockConfig({
								sourcePaths: [
									"/repo/src",
									"/repo/places/lobby",
								],
							}),
							files: [],
							instances: [],
							queried: [],
							diagnostics: [],
						},
						{
							config: mockConfig({ sourcePaths: ["/repo/src"] }),
							files: [],
							instances: [],
							queried: [],
							diagnostics: [],
						},
					],
				})
			);

			expect(report.lines()).toEqual([]);
			expect(report.emptyLine()).toBe(
				"No files in the source paths (src, places/lobby)."
			);
		});

		it("should say nothing when no config answered", () => {
			expect(reportOf([]).emptyLine()).toBeUndefined();
		});
	});

	describe("diagnostics", () => {
		const source = "/repo/src/Save@sever.luau";
		const placed = (at: string): FileLocation => ({
			status: "placed",
			source: at,
			exists: true,
			instancePath: ["ReplicatedStorage", "Save"],
			route: "*",
			routeMatch: "fallback",
		});
		const strayAt = warningDiagnostic(
			"route.strayAt",
			{ resource: "/repo/rogen.json" },
			'2 names have an "@" that routes nowhere:',
			[
				{
					rename: {
						from: source,
						to: "/repo/src/Save@server.luau",
					},
				},
				{
					rename: {
						from: "/repo/src/Other@sever.luau",
						to: "/repo/src/Other@server.luau",
					},
				},
			],
			[
				{ resource: source, message: 'did you mean "@server"?' },
				{
					resource: "/repo/src/Other@sever.luau",
					message: 'did you mean "@server"?',
				},
			]
		);
		const own = warningDiagnostic(
			"route.unrouted",
			{ resource: "/repo/src/U.luau" },
			"matched no route."
		);

		it("should print a line under the path for a grouped diagnostic's entry about it, with the code", () => {
			const report = reportOf([
				["default", [placed(source)], [], [strayAt]],
			]);

			expect(report.lines()).toEqual([
				"src/Save@sever.luau -> ReplicatedStorage/Save · route * (fallback)",
				'  warning: did you mean "@server"? (route.strayAt)',
			]);
		});

		it("should print a path's own diagnostic and none about other paths or the config as a whole", () => {
			const report = reportOf([
				[
					"default",
					[
						placed("/repo/src/U.luau"),
						placed("/repo/src/Clean.luau"),
					],
					[],
					[own, strayAt],
				],
			]);

			expect(report.lines()).toEqual([
				"src/U.luau -> ReplicatedStorage/Save · route * (fallback)",
				"  warning: matched no route. (route.unrouted)",
				"src/Clean.luau -> ReplicatedStorage/Save · route * (fallback)",
			]);
		});

		it("should print an error as an error", () => {
			const report = reportOf([
				[
					"default",
					[placed("/repo/src/Combat/init.meta.json")],
					[],
					[
						errorDiagnostic(
							"meta.invalidSyntax",
							{ resource: "/repo/src/Combat/init.meta.json" },
							"invalid JSONC."
						),
					],
				],
			]);

			expect(report.lines()[1]).toBe(
				"  error: invalid JSONC. (meta.invalidSyntax)"
			);
		});

		it("should print a diagnostic once when every config agrees and under each config when they differ", () => {
			const agree = reportOf([
				["default", [placed("/repo/src/U.luau")], [], [own]],
				["lobby", [placed("/repo/src/U.luau")], [], [own]],
			]);
			const differ = reportOf([
				["default", [placed("/repo/src/U.luau")], [], [own]],
				["lobby", [placed("/repo/src/U.luau")]],
			]);
			const apart = reportOf([
				["default", [placed("/repo/src/U.luau")], [], [own]],
				[
					"lobby",
					[
						{
							status: "unrouted",
							source: "/repo/src/U.luau",
							exists: true,
						},
					],
					[],
					[own],
				],
			]);

			expect(agree.lines()).toHaveLength(2);
			expect(differ.lines()).toEqual([
				"src/U.luau -> ReplicatedStorage/Save · route * (fallback)",
				"  default: warning: matched no route. (route.unrouted)",
			]);
			expect(apart.lines()).toEqual([
				"default: src/U.luau -> ReplicatedStorage/Save · route * (fallback)",
				"  warning: matched no route. (route.unrouted)",
				"lobby: src/U.luau -> unrouted · no route matches it",
				"  warning: matched no route. (route.unrouted)",
			]);
		});

		it("should narrow a grouped diagnostic to the path in json: its entry's message and its own fixes", () => {
			const [entry] = documentOf([
				["default", [placed(source)], [], [strayAt]],
			]).locations;

			expect(entry.diagnostics).toEqual([
				{
					file: source,
					severity: "warning",
					code: "route.strayAt",
					message: 'did you mean "@server"?',
					url: expect.stringContaining("#route-strayat"),
					fixes: [
						{
							rename: {
								from: source,
								to: "/repo/src/Save@server.luau",
							},
						},
					],
				},
			]);
		});

		it("should give a clean path an empty list", () => {
			const [entry] = documentOf([
				["default", [placed("/repo/src/Clean.luau")], [], [strayAt]],
			]).locations;

			expect(entry.diagnostics).toEqual([]);
		});
	});
});
