import { SUPPORTED_SERVICES, isSupportedService } from "../services.js";

describe("domain/roblox/services", () => {
	it("should list the supported services", () => {
		expect(SUPPORTED_SERVICES).toEqual([
			"ServerScriptService",
			"ServerStorage",
			"ReplicatedStorage",
			"ReplicatedFirst",
			"StarterGui",
			"StarterPack",
			"StarterPlayer",
			"Workspace",
			"Lighting",
			"SoundService",
			"RobloxPluginGuiService",
		]);
	});

	describe("isSupportedService", () => {
		it("should accept a supported service", () => {
			expect(isSupportedService("StarterPlayer")).toBe(true);
		});

		it("should reject a name that is not a service", () => {
			expect(isSupportedService("StarterPlayerScripts")).toBe(false);
		});
	});
});
