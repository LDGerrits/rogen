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
import { WhereLog } from "../where-log.js";
import { lineOf, reportOf } from "./where-fixtures.js";

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
					variants: [],
				})
			).toBe(
				"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Http · route Client (suffix)"
			);
		});

		it("should name each active variant with how it matched", () => {
			expect(
				lineOf({
					status: "placed",
					source: "/repo/src/A.luau",
					exists: true,
					instancePath: ["ReplicatedStorage", "A"],
					route: "*",
					routeMatch: "fallback",
					variants: [
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
						{ variant: "test", form: "marker" },
					],
				})
			).toBe(
				"src/A.luau -> ReplicatedStorage/A · route * (fallback) · variants dev (folder), mock (suffix), test (marker)"
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
					variants: [],
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
					variants: [],
				})
			).toBe(
				"src/Net/init.luau -> ServerScriptService/Net · route server (copy) · also StarterPlayer/StarterPlayerScripts/Net"
			);
		});

		it("should say how a dormant variant matched a pruned file", () => {
			expect(
				lineOf({
					status: "pruned",
					source: "/repo/src/Http.mock.luau",
					exists: true,
					variants: [
						{
							variant: "mock",
							form: "suffix",
						},
					],
				})
			).toBe(
				"src/Http.mock.luau -> pruned · variant mock is off (suffix)"
			);
		});

		describe("in a mode", () => {
			const inMode = { modes: { dev: {}, prod: {} }, mode: "dev" };
			const lineIn = (location: FileLocation) =>
				reportOf(
					[["default", [location]]],
					false,
					[],
					inMode
				).lines()[0];

			it("should say the mode is another than the one that marks a pruned file", () => {
				expect(
					lineIn({
						status: "pruned",
						source: "/repo/src/Service.prod.luau",
						exists: true,
						variants: [{ variant: "prod", form: "suffix" }],
					})
				).toBe(
					"src/Service.prod.luau -> pruned · mode is dev, not prod"
				);
			});

			it("should keep the variant wording for a variant that prunes a file", () => {
				expect(
					lineIn({
						status: "pruned",
						source: "/repo/src/Http.mock.luau",
						exists: true,
						variants: [{ variant: "mock", form: "suffix" }],
					})
				).toBe(
					"src/Http.mock.luau -> pruned · variant mock is off (suffix)"
				);
			});

			it("should name a mode a placed file carries as a mode", () => {
				expect(
					lineIn({
						status: "placed",
						source: "/repo/src/Service.dev.luau",
						exists: true,
						instancePath: ["ReplicatedStorage", "Service"],
						route: "*",
						routeMatch: "fallback",
						variants: [{ variant: "dev", form: "suffix" }],
					})
				).toBe(
					"src/Service.dev.luau -> ReplicatedStorage/Service · route * (fallback) · mode dev (suffix)"
				);
			});

			it("should name each carried switch's kind when a file carries both", () => {
				expect(
					lineIn({
						status: "placed",
						source: "/repo/src/Service.dev.mock.luau",
						exists: true,
						instancePath: ["ReplicatedStorage", "Service"],
						route: "*",
						routeMatch: "fallback",
						variants: [
							{ variant: "dev", form: "suffix" },
							{ variant: "mock", form: "suffix" },
						],
					})
				).toBe(
					"src/Service.dev.mock.luau -> ReplicatedStorage/Service · route * (fallback) · mode dev (suffix), variant mock (suffix)"
				);
			});

			it("should add the mode to each location in the JSON form", () => {
				const [location] = reportOf(
					[
						[
							"default",
							[
								{
									status: "excluded",
									source: "/repo/src/A.spec.luau",
									exists: true,
									pattern: "/repo/**/*.spec.luau",
								},
							],
						],
					],
					false,
					[],
					inMode
				).json().locations;

				expect(location).toMatchObject({
					config: "default",
					mode: "dev",
					status: "excluded",
				});
			});

			it("should leave the mode out of a config that declares none", () => {
				const [location] = reportOf([
					[
						"default",
						[
							{
								status: "excluded",
								source: "/repo/src/A.spec.luau",
								exists: true,
								pattern: "/repo/**/*.spec.luau",
							},
						],
					],
				]).json().locations;

				expect(location).not.toHaveProperty("mode");
			});
		});

		it("should name the template node that mounts a path", () => {
			expect(
				lineOf({
					status: "mounted",
					source: "/repo/src/Vendor/Lib.luau",
					exists: true,
					node: ["ReplicatedStorage", "Vendor"],
				})
			).toBe(
				"src/Vendor/Lib.luau -> mounted · the template mounts it at ReplicatedStorage/Vendor"
			);
		});

		it("should name the glob that excluded a path, relative to the working directory", () => {
			expect(
				lineOf({
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
				})
			).toBe("src/A.spec.luau -> excluded · matches **/*.spec.luau");
		});

		it.each([
			["*.rogen.json", "*.rogen.json"],
			["C:/repo/**/*.spec.luau", "**/*.spec.luau"],
		])(
			"should keep a glob of Rogen's own as it is and make a drive glob relative to the working directory: %s",
			(pattern, shown) => {
				const report = new WhereLog("C:\\repo", {
					everyFile: false,
					errors: [],
					configs: [
						{
							config: mockConfig({}),
							files: [
								{
									status: "excluded",
									source: "C:/repo/src/A.luau",
									exists: true,
									pattern,
								},
							],
							instances: [],
							diagnostics: [],
						},
					],
				});

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
				"src/Save.luau -> displaced · the template defines ServerScriptService/Save",
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
				"README.md -> outside the root dirs",
			],
			[
				{ status: "ignored", source: "/repo/src/N.md", exists: true },
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
				"a -> outside the root dirs",
			]);
		});

		it("should print a line once when every config gives the same one", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [outside("a")]],
				]).lines()
			).toEqual(["a -> outside the root dirs"]);
		});

		const placed = (name: string, at: string): FileLocation => ({
			status: "placed",
			source: `/repo/${name}`,
			exists: true,
			instancePath: ["ReplicatedStorage", at],
			route: "*",
			routeMatch: "fallback",
			variants: [],
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
				"a -> outside the root dirs",
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
				"lobby: a -> outside the root dirs",
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
			variants: [],
		});
		const entry = (location: FileLocation) =>
			reportOf([["default", [location]]]).json().locations[0];

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
					status: "pruned",
					source: "/repo/src/Http.mock.luau",
					exists: true,
					variants: [{ variant: "mock", form: "suffix" }],
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
			variants: [],
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
						{ ...placed(["ReplicatedStorage", "X"]), source },
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
		it("should name the root dirs of every config once, relative to the working directory", () => {
			const report = new WhereLog("/repo", {
				everyFile: true,
				errors: [],
				configs: [
					{
						config: mockConfig({
							rootDirs: ["/repo/src", "/repo/places/lobby"],
						}),
						files: [],
						instances: [],
						diagnostics: [],
					},
					{
						config: mockConfig({ rootDirs: ["/repo/src"] }),
						files: [],
						instances: [],
						diagnostics: [],
					},
				],
			});

			expect(report.lines()).toEqual([]);
			expect(report.emptyLine()).toBe(
				"No files in the root dirs (src, places/lobby)."
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
			variants: [],
		});
		const strayAt = warningDiagnostic(
			"route.strayAt",
			{ resource: "/repo/default.rogen.json" },
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
			const [entry] = reportOf([
				["default", [placed(source)], [], [strayAt]],
			]).json().locations;

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
			const [entry] = reportOf([
				["default", [placed("/repo/src/Clean.luau")], [], [strayAt]],
			]).json().locations;

			expect(entry.diagnostics).toEqual([]);
		});
	});
});
