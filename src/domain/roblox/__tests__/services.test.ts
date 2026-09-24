import {
	SUPPORTED_SERVICES,
	containerClassName,
	isSupportedService,
} from "../services.js";

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

	describe("containerClassName", () => {
		it("should give a service its own class", () => {
			expect(containerClassName(["Workspace"])).toBe("Workspace");
		});

		it("should give StarterPlayer's script containers their own class", () => {
			expect(
				containerClassName(["StarterPlayer", "StarterCharacterScripts"])
			).toBe("StarterCharacterScripts");
		});

		it("should make anything else a Folder", () => {
			expect(containerClassName(["ReplicatedStorage", "shared"])).toBe(
				"Folder"
			);
			expect(
				containerClassName([
					"ReplicatedStorage",
					"StarterPlayerScripts",
				])
			).toBe("Folder");
		});
	});
});
