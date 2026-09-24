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

		it("should drop the services Roblox keeps for itself", () => {
			const selected = selectServices(database);
			expect(selected).not.toContain("CoreGui");
			expect(selected).not.toContain("CorePackages");
		});
	});

	describe("renderServicesModule", () => {
		it("should export the services and the guard that checks against them", () => {
			const source = renderServicesModule(["Lighting", "Workspace"]);
			expect(source).toContain('\t"Lighting",\n\t"Workspace",\n');
			expect(source).toContain("export type SupportedService");
			expect(source).toContain("export function isSupportedService");
		});
	});
});
