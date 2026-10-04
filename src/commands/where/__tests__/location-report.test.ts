import { FileLocation, InstanceLocation } from "../../../domain/build/build.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { InstanceReference } from "../../../domain/roblox/roblox.js";
import { LocationReport } from "../location-report.js";

/** A report of what each labelled config said; `everyFile` when no path was asked about. */
const reportOf = (
	configs: [
		label: string,
		files: FileLocation[],
		instances?: InstanceLocation[],
	][],
	everyFile = false
) =>
	new LocationReport("/repo", {
		everyFile,
		configs: configs.map(([label, files, instances = []]) => ({
			config: mockConfig({ file: `/repo/${label}.rogen.json` }),
			files,
			instances,
		})),
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
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "suffix",
					tags: [],
				})
			).toBe(
				"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Http · route Client (suffix)"
			);
		});

		it("should name each active tag with how it matched", () => {
			expect(
				describe1({
					status: "placed",
					source: "/repo/src/A.luau",
					instancePath: ["ReplicatedStorage", "A"],
					route: "*",
					routeMatch: "fallback",
					tags: [
						{ tag: "dev", form: "folder" },
						{ tag: "mock", form: "suffix" },
						{ tag: "test", form: "marker" },
					],
				})
			).toBe(
				"src/A.luau -> ReplicatedStorage/A · route * (fallback) · tags dev (folder), mock (suffix), test (marker)"
			);
		});

		it("should say how a dormant tag matched a pruned file", () => {
			expect(
				describe1({
					status: "pruned",
					source: "/repo/src/Http.mock.luau",
					tags: [
						{
							tag: "mock",
							form: "suffix",
						},
					],
				})
			).toBe("src/Http.mock.luau -> pruned · tag mock is off (suffix)");
		});

		it("should name the glob that excluded a path, relative to the working directory", () => {
			expect(
				describe1({
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					pattern: "/repo/**/*.spec.luau",
				})
			).toBe("src/A.spec.luau -> excluded · matches **/*.spec.luau");
		});

		it.each<[FileLocation, string]>([
			[
				{
					status: "replaced",
					source: "/repo/src/T.lua",
					by: "/repo/src/T.luau",
				},
				"src/T.lua -> replaced by src/T.luau",
			],
			[
				{
					status: "displaced",
					source: "/repo/src/Save.luau",
					node: ["ServerScriptService", "Save"],
				},
				"src/Save.luau -> displaced · the template defines ServerScriptService/Save",
			],
			[
				{ status: "unrouted", source: "/repo/src/U.luau" },
				"src/U.luau -> unrouted · no route matches it",
			],
			[
				{ status: "outside", source: "/repo/README.md" },
				"README.md -> outside the root dirs",
			],
			[
				{ status: "ignored", source: "/repo/src/N.md" },
				"src/N.md -> not an instance",
			],
			[
				{ status: "missing", source: "/repo/src/X" },
				"src/X -> does not exist",
			],
			[
				{ status: "empty", source: "/repo/src/E" },
				"src/E -> empty · no file in it places",
			],
			[
				{ status: "skipped", source: "/repo/src/L" },
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
		});
		const missing = (name: string): FileLocation => ({
			status: "missing",
			source: `/repo/${name}`,
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

		it("should prefix each config's line when they differ", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [missing("a")]],
				]).lines()
			).toEqual([
				"default: a -> outside the root dirs",
				"lobby: a -> does not exist",
			]);
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

	describe("json", () => {
		const jsonOf = (location: FileLocation) => {
			return reportOf([["default", [location]]]).json();
		};

		it("should give the config, the source, the instance path, the route and how it matched", () => {
			expect(
				jsonOf({
					status: "placed",
					source: "/repo/src/Net/Http@client.luau",
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "suffix",
					tags: [{ tag: "mock", form: "suffix" }],
				})
			).toEqual([
				{
					config: "default",
					source: "/repo/src/Net/Http@client.luau",
					status: "placed",
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "suffix",
					tags: [{ tag: "mock", form: "suffix" }],
				},
			]);
		});

		it.each<[FileLocation, Record<string, unknown>]>([
			[
				{
					status: "pruned",
					source: "/repo/src/Http.mock.luau",
					tags: [{ tag: "mock", form: "suffix" }],
				},
				{ tags: [{ tag: "mock", form: "suffix" }] },
			],
			[
				{
					status: "replaced",
					source: "/repo/src/T.lua",
					by: "/repo/src/T.luau",
				},
				{ by: "/repo/src/T.luau" },
			],
			[
				{
					status: "displaced",
					source: "/repo/src/Save.luau",
					node: ["ServerScriptService", "Save"],
				},
				{ node: ["ServerScriptService", "Save"] },
			],
			[
				{
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					pattern: "/repo/**/*.spec.luau",
				},
				{ pattern: "/repo/**/*.spec.luau" },
			],
			[{ status: "unrouted", source: "/repo/src/U.luau" }, {}],
			[{ status: "outside", source: "/repo/src/U.luau" }, {}],
			[{ status: "ignored", source: "/repo/src/U.luau" }, {}],
			[{ status: "missing", source: "/repo/src/U.luau" }, {}],
			[{ status: "empty", source: "/repo/src/U.luau" }, {}],
			[{ status: "skipped", source: "/repo/src/U.luau" }, {}],
		])("should give the fields %j carries", (location, fields) => {
			expect(jsonOf(location)).toEqual([
				{
					config: "default",
					source: location.source,
					status: location.status,
					...fields,
				},
			]);
		});

		it("should say when no file places an instance, and list the files that do", () => {
			const placed: FileLocation = {
				status: "placed",
				source: "/repo/src/Save.luau",
				instancePath: ["ServerScriptService", "Save"],
				route: "Server",
				routeMatch: "folder",
				tags: [],
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
				report.json().map(({ config: _config, ...rest }) => rest)
			).toEqual([
				expect.objectContaining({
					source: "/repo/src/Save.luau",
					status: "placed",
				}),
				{ instance: "ServerScriptService.Gone", status: "noFile" },
			]);
		});

		it("should give each config its own entry however many agree", () => {
			const report = reportOf(
				["default", "lobby"].map((label) => [
					label,
					[{ status: "outside", source: "/repo/a" }],
				])
			);

			expect(report.json().map(({ config }) => config)).toEqual([
				"default",
				"lobby",
			]);
		});

		it("should sort the sources when every file was asked about, and keep the order given otherwise", () => {
			const files: FileLocation[] = [
				{ status: "missing", source: "/repo/b" },
				{ status: "missing", source: "/repo/a" },
			];

			expect(
				reportOf([["default", files]])
					.json()
					.map(({ source }) => source)
			).toEqual(["/repo/b", "/repo/a"]);
			expect(
				reportOf([["default", files]], true)
					.json()
					.map(({ source }) => source)
			).toEqual(["/repo/a", "/repo/b"]);
		});
	});
});
