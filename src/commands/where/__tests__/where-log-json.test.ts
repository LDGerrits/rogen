import path from "path";
import {
	FileLocation,
	InstanceLocation,
} from "../../../domain/build/build-service.js";
import { InstanceReference } from "../../../domain/roblox/roblox.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { documentOf } from "./where-fixtures.js";

describe("WhereLog", () => {
	describe("json", () => {
		const jsonOf = (location: FileLocation) => {
			return documentOf([["default", [location]]]).locations;
		};

		it("should hold the errors of the configs that didn't load beside the locations", () => {
			const error = errorDiagnostic(
				"config.invalidSyntax",
				{ resource: "/repo/broken/rogen.json" },
				"bad."
			);

			const document = documentOf([], false, [error]);

			expect(document).toMatchObject({
				locations: [],
				diagnostics: [
					{
						file: "/repo/broken/rogen.json",
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
					diagnostics: [],
				},
			]);
		});

		it("should mark a hoisted name in json, and leave the mark off an unhoisted one", () => {
			const placed: FileLocation = {
				status: "placed",
				source: "/repo/src/Player/^Animate.client.luau",
				exists: true,
				instancePath: ["StarterPlayer", "Animate"],
				route: "character",
				routeMatch: "marker",
			};

			expect(jsonOf({ ...placed, hoisted: true })[0]).toHaveProperty(
				"hoisted",
				true
			);
			expect(jsonOf(placed)[0]).not.toHaveProperty("hoisted");
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
				})[0]
			).toMatchObject({
				alsoAt: [["StarterPlayer", "StarterPlayerScripts", "Net"]],
			});
		});

		it.each<[FileLocation, Record<string, unknown>]>([
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
					status: "ignored",
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
				{
					status: "notInstance",
					source: "/repo/src/U.luau",
					exists: true,
				},
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
			};
			const report = documentOf([
				[
					"default",
					[],
					[
						{
							reference: InstanceReference.parse(
								"ServerScriptService.Save"
							)!,
							files: [placed],
							folders: [],
							fixes: [],
						},
						{
							reference: InstanceReference.parse(
								"ServerScriptService.Gone"
							)!,
							files: [],
							folders: ["/repo/src/Inventory/Server"],
							fixes: [],
						},
					],
				],
			]);

			expect(
				report.locations.map(({ config: _config, ...rest }) => rest)
			).toEqual([
				expect.objectContaining({
					source: "/repo/src/Save.luau",
					exists: true,
					status: "placed",
				}),
				{
					instance: "ServerScriptService.Gone",
					status: "noFile",
					folders: [path.normalize("/repo/src/Inventory/Server")],
					diagnostics: [],
				},
			]);
		});

		it("should give the renames that would place an instance no file does, and leave out empty lists", () => {
			const entries = (instance: InstanceLocation) =>
				documentOf([["default", [], [instance]]]).locations.map(
					({ config: _config, ...rest }) => rest
				);
			const reference = InstanceReference.parse("Workspace.Missing")!;

			expect(
				entries({
					reference,
					files: [],
					folders: [],
					fixes: [
						{
							code: "route.misspelt",
							rename: {
								from: "/repo/src/Gone.luau",
								to: "/repo/src/Missing.luau",
							},
						},
					],
				})
			).toEqual([
				{
					instance: "Workspace.Missing",
					status: "noFile",
					fixes: [
						{
							rename: {
								from: path.normalize("/repo/src/Gone.luau"),
								to: path.normalize("/repo/src/Missing.luau"),
							},
						},
					],
					diagnostics: [],
				},
			]);
			expect(
				entries({ reference, files: [], folders: [], fixes: [] })[0]
			).not.toHaveProperty("fixes");
		});

		it("should keep a config's outside entry when another config places the path", () => {
			const report = documentOf([
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
						},
					],
				],
			]);

			expect(
				report.locations.map(({ config, status }) => [config, status])
			).toEqual([
				["default", "outside"],
				["lobby", "placed"],
			]);
		});

		it("should give each config its own entry however many agree", () => {
			const report = documentOf(
				["default", "lobby"].map((label) => [
					label,
					[{ status: "outside", source: "/repo/a", exists: true }],
				])
			);

			expect(report.locations.map(({ config }) => config)).toEqual([
				"default",
				"lobby",
			]);
		});

		it("should sort the sources when every file was asked about, and keep the order given otherwise", () => {
			const files: FileLocation[] = [
				{ status: "missing", source: "/repo/b", exists: true },
				{ status: "missing", source: "/repo/a", exists: true },
			];

			expect(
				documentOf([["default", files]]).locations.map(
					(entry) => "source" in entry && entry.source
				)
			).toEqual(["/repo/b", "/repo/a"]);
			expect(
				documentOf([["default", files]], true).locations.map(
					(entry) => "source" in entry && entry.source
				)
			).toEqual(["/repo/a", "/repo/b"]);
		});
	});
});
