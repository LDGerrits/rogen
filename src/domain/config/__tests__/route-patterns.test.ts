import { RoutePatterns } from "../route-patterns.js";
import { mockConfig } from "./mock-config-service.js";

const patternsOf = (routes: Record<string, string>) =>
	mockConfig({ routes }).patterns;

describe("RoutePatterns", () => {
	describe("isPattern", () => {
		it.each([
			"*.tsx",
			"*Controller.*",
			"*.service.*",
			"Ui*.luau",
			"*-view.ts",
		])("should take %j as a pattern", (key) => {
			expect(RoutePatterns.isPattern(key)).toBe(true);
		});

		it.each([
			"*",
			"Server",
			"**.tsx",
			"*.",
			"src/*.tsx",
			"*@client",
			"(*)",
			"*.*",
		])("should not take %j as a pattern", (key) => {
			expect(RoutePatterns.isPattern(key)).toBe(false);
		});
	});

	describe("match", () => {
		const routes = {
			Client: "StarterPlayer/StarterPlayerScripts",
			"*.tsx": "StarterPlayer/StarterPlayerScripts",
			"*.story.tsx": "ReplicatedStorage/Stories",
			"*Controller.*": "StarterPlayer/StarterPlayerScripts",
			"*Service.*": "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};

		it("should match a whole file name, case-sensitively", () => {
			const patterns = patternsOf(routes);

			expect(patterns.match("Hud.tsx")).toEqual({
				kind: "routed",
				key: "*.tsx",
			});
			expect(patterns.match("Hud.tsx.bak")).toBeUndefined();
			expect(patterns.match("inputcontroller.luau")).toBeUndefined();
		});

		it("should take the pattern with the most characters that aren't *", () => {
			expect(patternsOf(routes).match("Button.story.tsx")).toEqual({
				kind: "routed",
				key: "*.story.tsx",
			});
		});

		it("should not take * or a name key, which match no file name", () => {
			expect(patternsOf(routes).match("Client")).toBeUndefined();
			expect(patternsOf(routes).match("Util.luau")).toBeUndefined();
		});

		it("should let patterns of equal weight agree when they send a file to one place", () => {
			expect(
				patternsOf({
					"*Hud.*": "StarterPlayer/StarterPlayerScripts",
					"*.tsx": "StarterPlayer/StarterPlayerScripts",
				}).match("MainHud.tsx")
			).toMatchObject({ kind: "routed" });
		});

		it("should report a clash between patterns of equal weight that send a file to different places", () => {
			expect(patternsOf(routes).match("ShopService.tsx")).toEqual({
				kind: "routed",
				key: "*Service.*",
			});
			expect(
				patternsOf({
					"*Ui.*": "StarterPlayer/StarterPlayerScripts",
					"*.ts": "ServerScriptService",
				}).match("MainUi.ts")
			).toEqual({ kind: "clash", keys: ["*.ts", "*Ui.*"] });
		});
	});
});
