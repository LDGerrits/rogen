import {
	ApiDump,
	renderServicesModule,
	selectServices,
} from "../select-services.js";

const dump: ApiDump = {
	Classes: [
		{ Name: "Workspace", Tags: ["NotCreatable", "Service"] },
		{ Name: "Teams", Tags: ["NotCreatable", "Service"] },
		{ Name: "Part", Tags: [] },
		{ Name: "Folder" },
		{ Name: "CoreGui", Tags: ["NotCreatable", "Service"] },
		{ Name: "CorePackages", Tags: ["Service"] },
		{ Name: "BrandNewService", Tags: ["Service"] },
	],
};

const knownToRojo = (name: string) => name !== "BrandNewService";

describe("domain/roblox/select-services", () => {
	describe("selectServices", () => {
		it("should keep classes tagged Service", () => {
			expect(selectServices(dump, knownToRojo)).toEqual([
				"Teams",
				"Workspace",
			]);
		});

		it("should drop the services Roblox keeps for itself", () => {
			const selected = selectServices(dump, knownToRojo);
			expect(selected).not.toContain("CoreGui");
			expect(selected).not.toContain("CorePackages");
		});

		it("should drop services Rojo does not know", () => {
			expect(selectServices(dump, knownToRojo)).not.toContain(
				"BrandNewService"
			);
		});

		it("should not ask Rojo about classes it already dropped", () => {
			const asked: string[] = [];
			selectServices(dump, (name) => {
				asked.push(name);
				return true;
			});
			expect(asked.sort()).toEqual([
				"BrandNewService",
				"Teams",
				"Workspace",
			]);
		});

		it("should sort the result so regenerating gives a stable diff", () => {
			const names = selectServices(
				{
					Classes: [
						{ Name: "Workspace", Tags: ["Service"] },
						{ Name: "Lighting", Tags: ["Service"] },
					],
				},
				() => true
			);
			expect(names).toEqual(["Lighting", "Workspace"]);
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
