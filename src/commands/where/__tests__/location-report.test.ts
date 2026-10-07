import { FileLocation, InstanceLocation } from "../../../domain/build/build.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { InstanceReference } from "../../../domain/roblox/roblox.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { LocationReport } from "../location-report.js";

/** A report of what each labelled config said; `everyFile` when no path was asked about. */
const reportOf = (
	configs: [
		label: string,
		files: FileLocation[],
		instances?: InstanceLocation[],
		diagnostics?: Diagnostic[],
	][],
	everyFile = false,
	errors: Diagnostic[] = []
) =>
	new LocationReport("/repo", {
		everyFile,
		errors,
		configs: configs.map(
			([label, files, instances = [], diagnostics = []]) => ({
				config: mockConfig({ file: `/repo/${label}.rogen.json` }),
				files,
				instances,
				diagnostics,
			})
		),
	});

const describe1 = (location: FileLocation) =>
	reportOf([["default", [location]]]).lines()[0];

describe("LocationReport", () => {
	describe("a location", () => {
		it("should give the instance path, the route and how it matched", () => {
			expect(
				describe1({
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
				describe1({
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
				describe1({
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
				describe1({
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
				describe1({
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

		it("should name the template node that mounts a path", () => {
			expect(
				describe1({
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
				describe1({
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
				})
			).toBe("src/A.spec.luau -> excluded · matches **/*.spec.luau");
		});

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
			expect(describe1(location)).toBe(line);
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

	describe("a missing folder", () => {
		it("should say how to ask about a folder that doesn't exist", () => {
			expect(
				describe1({
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
				describe1({
					status: "missing",
					source: "/repo/src/Hit.luau",
					exists: false,
				})
			).toBe("src/Hit.luau -> does not exist");
		});
	});

	describe("emptyLine", () => {
		it("should name the root dirs of every config once, relative to the working directory", () => {
			const report = new LocationReport("/repo", {
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

	describe("json", () => {
		const jsonOf = (location: FileLocation) => {
			return reportOf([["default", [location]]]).json().locations;
		};

		it("should hold the errors of the configs that didn't load beside the locations", () => {
			const error = errorDiagnostic(
				"config.invalidSyntax",
				{ resource: "/repo/broken.rogen.json" },
				"bad."
			);

			const document = reportOf([], false, [error]).json();

			expect(document).toMatchObject({
				locations: [],
				diagnostics: [
					{
						file: "/repo/broken.rogen.json",
						code: "config.invalidSyntax",
					},
				],
			});
			expect(Object.keys(document)).toEqual(["locations", "diagnostics"]);
		});

		it("should give the config, the source, the instance path, the route and how it matched", () => {
			expect(
				jsonOf({
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
					variants: [{ variant: "mock", form: "suffix" }],
				})
			).toEqual([
				{
					config: "default",
					source: "/repo/src/Net/Http@client.luau",
					exists: true,
					status: "placed",
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "suffix",
					variants: [{ variant: "mock", form: "suffix" }],
					diagnostics: [],
				},
			]);
		});

		it("should give the other nodes a copied init script is", () => {
			expect(
				jsonOf({
					status: "placed",
					source: "/repo/src/Net/init.luau",
					exists: true,
					instancePath: ["ServerScriptService", "Net"],
					alsoAt: [["StarterPlayer", "StarterPlayerScripts", "Net"]],
					route: "server",
					routeMatch: "copy",
					variants: [],
				})[0]
			).toMatchObject({
				alsoAt: [["StarterPlayer", "StarterPlayerScripts", "Net"]],
			});
		});

		it.each<[FileLocation, Record<string, unknown>]>([
			[
				{
					status: "pruned",
					source: "/repo/src/Http.mock.luau",
					exists: true,
					variants: [{ variant: "mock", form: "suffix" }],
				},
				{ variants: [{ variant: "mock", form: "suffix" }] },
			],
			[
				{
					status: "replaced",
					source: "/repo/src/T.lua",
					exists: true,
					by: "/repo/src/T.luau",
				},
				{ by: "/repo/src/T.luau" },
			],
			[
				{
					status: "displaced",
					source: "/repo/src/Save.luau",
					exists: true,
					node: ["ServerScriptService", "Save"],
				},
				{ node: ["ServerScriptService", "Save"] },
			],
			[
				{
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
				},
				{ pattern: "/repo/**/*.spec.luau" },
			],
			[
				{
					status: "unrouted",
					source: "/repo/src/U.luau",
					exists: true,
				},
				{},
			],
			[
				{ status: "outside", source: "/repo/src/U.luau", exists: true },
				{},
			],
			[
				{ status: "ignored", source: "/repo/src/U.luau", exists: true },
				{},
			],
			[
				{ status: "missing", source: "/repo/src/U.luau", exists: true },
				{},
			],
			[{ status: "empty", source: "/repo/src/U.luau", exists: true }, {}],
			[
				{ status: "skipped", source: "/repo/src/U.luau", exists: true },
				{},
			],
		])("should give the fields %j carries", (location, fields) => {
			expect(jsonOf(location)).toEqual([
				{
					config: "default",
					source: location.source,
					status: location.status,
					exists: location.exists,
					...fields,
					diagnostics: [],
				},
			]);
		});

		it("should say when no file places an instance, and list the files that do", () => {
			const placed: FileLocation = {
				status: "placed",
				source: "/repo/src/Save.luau",
				exists: true,
				instancePath: ["ServerScriptService", "Save"],
				route: "Server",
				routeMatch: "folder",
				variants: [],
			};
			const report = reportOf([
				[
					"default",
					[],
					[
						{
							reference: InstanceReference.parse(
								"ServerScriptService.Save"
							)!,
							files: [placed],
						},
						{
							reference: InstanceReference.parse(
								"ServerScriptService.Gone"
							)!,
							files: [],
						},
					],
				],
			]);

			expect(
				report
					.json()
					.locations.map(({ config: _config, ...rest }) => rest)
			).toEqual([
				expect.objectContaining({
					source: "/repo/src/Save.luau",
					exists: true,
					status: "placed",
				}),
				{
					instance: "ServerScriptService.Gone",
					status: "noFile",
					diagnostics: [],
				},
			]);
		});

		it("should keep a config's outside entry when another config places the path", () => {
			const report = reportOf([
				[
					"default",
					[{ status: "outside", source: "/repo/a", exists: true }],
				],
				[
					"lobby",
					[
						{
							status: "placed",
							source: "/repo/a",
							exists: true,
							instancePath: ["ReplicatedStorage", "A"],
							route: "*",
							routeMatch: "fallback",
							variants: [],
						},
					],
				],
			]);

			expect(
				report
					.json()
					.locations.map(({ config, status }) => [config, status])
			).toEqual([
				["default", "outside"],
				["lobby", "placed"],
			]);
		});

		it("should give each config its own entry however many agree", () => {
			const report = reportOf(
				["default", "lobby"].map((label) => [
					label,
					[{ status: "outside", source: "/repo/a", exists: true }],
				])
			);

			expect(report.json().locations.map(({ config }) => config)).toEqual(
				["default", "lobby"]
			);
		});

		it("should sort the sources when every file was asked about, and keep the order given otherwise", () => {
			const files: FileLocation[] = [
				{ status: "missing", source: "/repo/b", exists: true },
				{ status: "missing", source: "/repo/a", exists: true },
			];

			expect(
				reportOf([["default", files]])
					.json()
					.locations.map(({ source }) => source)
			).toEqual(["/repo/b", "/repo/a"]);
			expect(
				reportOf([["default", files]], true)
					.json()
					.locations.map(({ source }) => source)
			).toEqual(["/repo/a", "/repo/b"]);
		});
	});
});
