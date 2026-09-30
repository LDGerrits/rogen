import fs from "fs";
import path from "path";
import {
	SERVICES_ROJO_VERSION,
	SUPPORTED_SERVICES,
} from "../../src/domain/roblox/supported-services.js";
import {
	ReflectionDatabase,
	renderServicesModule,
	selectServices,
} from "../services-module.js";

const database: ReflectionDatabase = [
	[0, 697],
	{
		Workspace: ["Workspace", ["NotCreatable", "Service"]],
		Teams: ["Teams", ["NotCreatable", "Service"]],
		Part: ["Part", []],
		Folder: ["Folder", ["NotBrowsable"]],
		CoreGui: ["CoreGui", ["NotCreatable", "Service"]],
		CorePackages: ["CorePackages", ["Service"]],
	},
	{},
];

describe("scripts/services-module", () => {
	describe("selectServices", () => {
		it("should keep classes tagged Service, sorted", () => {
			expect(selectServices(database)).toEqual(["Teams", "Workspace"]);
		});

		it("should keep a service whose name merely starts like a reserved one", () => {
			expect(
				selectServices([
					[0, 697],
					{
						...database[1],
						CoreScriptSyncService: [
							"CoreScriptSyncService",
							["Service"],
						],
					},
				])
			).toContain("CoreScriptSyncService");
		});

		it("should throw when a reserved service is no longer in the database", () => {
			const rest = Object.fromEntries(
				Object.entries(database[1]).filter(
					([name]) => name !== "CorePackages"
				)
			);
			expect(() => selectServices([[0, 697], rest])).toThrow(
				"CorePackages"
			);
		});

		it("should drop the services Roblox keeps for itself", () => {
			const selected = selectServices(database);
			expect(selected).not.toContain("CoreGui");
			expect(selected).not.toContain("CorePackages");
		});
	});

	describe("renderServicesModule", () => {
		it("should export the services and the guard that checks against them", () => {
			const source = renderServicesModule(
				["Lighting", "Workspace"],
				"7.6.1"
			);
			expect(source).toContain('\t"Lighting",\n\t"Workspace",\n');
			expect(source).toContain(
				'export const SERVICES_ROJO_VERSION = "7.6.1";'
			);
			expect(source).toContain("export type SupportedService");
			expect(source).toContain("export function isSupportedService");
		});
	});
	describe("supported-services.ts", () => {
		it("should be the output of the generator, not edited by hand", () => {
			const file = path.resolve("src/domain/roblox/supported-services.ts");
			expect(fs.readFileSync(file, "utf8")).toBe(
				renderServicesModule(SUPPORTED_SERVICES, SERVICES_ROJO_VERSION)
			);
		});

		it("should be generated for the pinned Rojo", () => {
			const manifest = fs.readFileSync(
				path.resolve("rokit.toml"),
				"utf8"
			);
			expect(manifest).toContain(
				`rojo-rbx/rojo@${SERVICES_ROJO_VERSION}"`
			);
		});
	});
});
