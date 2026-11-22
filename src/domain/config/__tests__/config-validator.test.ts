import path from "path";
import { ConfigValidator } from "../config-validator.js";

const file = path.resolve("/repo/game.rogen.json");
const at = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("ConfigValidator", () => {
	describe("sourcePathsIn", () => {
		it("should resolve the source paths a config gives from its folder", () => {
			expect(
				ConfigValidator.sourcePathsIn(file, {
					sourcePaths: ["src/game"],
				})
			).toEqual([at("src/game")]);
		});

		it("should read src for a config with routes and no source paths", () => {
			expect(
				ConfigValidator.sourcePathsIn(file, {
					routes: { Server: "ServerScriptService" },
				})
			).toEqual([at("src")]);
		});

		it("should read none for a config with neither", () => {
			expect(ConfigValidator.sourcePathsIn(file, {})).toEqual([]);
		});

		it.each([
			["a config that isn't an object", []],
			["source paths that aren't a list", { sourcePaths: "src" }],
			["source paths that aren't text", { sourcePaths: [1] }],
			[
				"routes that aren't an object, and no source paths",
				{ routes: "x" },
			],
		])("should know none for %s", (_, value) => {
			expect(ConfigValidator.sourcePathsIn(file, value)).toBeUndefined();
		});
	});
});
