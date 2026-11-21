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
			"*[Ss]ervice",
			"Test?.luau",
			"*{Controller,Component}",
			"*.[jt]sx",
			"Main[!0-9].luau",
			"{[Mm]ain,Boot}.luau",
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
			"*[Ss",
			"*{Controller,Component",
			"*{a,{b,c}}",
			"{[Mm,Boot}.luau",
			"*Controller}",
			"*]",
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

		it("should read ?, a class and alternatives as Rojo's globs do", () => {
			const patterns = patternsOf({
				"*[Ss]ervice": "ServerScriptService",
				"Test?.luau": "ReplicatedStorage/Tests",
				"*{Controller,Component}": "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage/Shared",
			});

			expect(
				[
					"ShopService.luau",
					"shopservice.luau",
					"Test1.luau",
					"Test12.luau",
					"HudController.luau",
					"HudComponent.luau",
					"HudControl.luau",
				].map((name) => {
					const found = patterns.match(
						name,
						name.replace(/\.luau$/, "")
					);
					return found?.kind === "routed" ? found.key : undefined;
				})
			).toEqual([
				"*[Ss]ervice",
				"*[Ss]ervice",
				"Test?.luau",
				undefined,
				"*{Controller,Component}",
				"*{Controller,Component}",
				undefined,
			]);
		});

		it("should read a class inside alternatives, as Rojo's globs do", () => {
			const patterns = patternsOf({
				"{[Mm]ain,Boot}.luau": "ServerScriptService",
				"*": "ReplicatedStorage/Shared",
			});

			expect(
				["main.luau", "Main.luau", "Boot.luau", "boot.luau"].map(
					(name) => patterns.match(name)?.kind
				)
			).toEqual(["routed", "routed", "routed", undefined]);
		});

		it("should count ? and a class as one character, and weigh each alternative on its own", () => {
			const patterns = patternsOf({
				"*[Ss]ervice": "ServerScriptService",
				"*Service": "ReplicatedStorage/Services",
				"*{Ui,Controller}": "StarterPlayer/StarterPlayerScripts",
				"*Ui*": "ReplicatedStorage/Ui",
			});

			expect(patterns.match("ShopService")).toEqual({
				kind: "clash",
				keys: ["*Service", "*[Ss]ervice"],
			});
			expect(patterns.match("HudController")).toEqual({
				kind: "routed",
				key: "*{Ui,Controller}",
			});
			expect(patterns.match("HudUi")).toEqual({
				kind: "clash",
				keys: ["*Ui*", "*{Ui,Controller}"],
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
