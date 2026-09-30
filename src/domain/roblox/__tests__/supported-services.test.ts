import { isSupportedService } from "../supported-services.js";

describe("domain/roblox/supported-services", () => {
	describe("isSupportedService", () => {
		it.each([
			"ServerScriptService",
			"StarterPlayer",
			"TextChatService",
			"MaterialService",
			"VoiceChatService",
			"LocalizationService",
			"Teams",
			"TestService",
		])("should accept %s", (name) => {
			expect(isSupportedService(name)).toBe(true);
		});

		it.each(["CoreGui", "CorePackages"])(
			"should reject %s, which Rojo can't write to",
			(name) => {
				expect(isSupportedService(name)).toBe(false);
			}
		);

		it("should reject a name that is not a service", () => {
			expect(isSupportedService("StarterPlayerScripts")).toBe(false);
		});

		it("should reject a typo", () => {
			expect(isSupportedService("ReplicatedStorge")).toBe(false);
		});

		it("should not accept Object.prototype members", () => {
			expect(isSupportedService("constructor")).toBe(false);
		});
	});
});
