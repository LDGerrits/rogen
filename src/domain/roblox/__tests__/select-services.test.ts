import {
	ReflectionDatabase,
	renderServicesModule,
	selectServices,
} from "../select-services.js";

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

describe("domain/roblox/select-services", () => {
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
			const { CorePackages: _, ...rest } = database[1];
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
});
