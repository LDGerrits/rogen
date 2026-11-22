import path from "path";
import { rojoDone } from "../report-rojo.js";

const cwd = path.resolve("/repo");

describe("rojoDone", () => {
	it.each([
		[{ command: "build", cwd, output: "game.rbxl" }, "Built game.rbxl"],
		[
			{ command: "build", cwd, plugin: "Tool.rbxm" },
			"Built plugin Tool.rbxm",
		],
		[{ command: "build", cwd }, "Built ."],
		[{ command: "sourcemap", cwd, output: "map.json" }, "Wrote map.json"],
		[{ command: "sourcemap", cwd }, "Wrote the sourcemap"],
		[{ command: "upload", cwd, asset: "123" }, "Uploaded to asset 123"],
		[{ command: "upload", cwd }, "Uploaded"],
	] as const)("should say what Rojo did for %j", (target, said) => {
		expect(rojoDone(target, cwd)).toBe(said);
	});

	it("should name the output relative to the working directory", () => {
		expect(
			rojoDone(
				{
					command: "build",
					cwd: path.join(cwd, "game"),
					output: "out.rbxl",
				},
				cwd
			)
		).toEqual("Built game/out.rbxl");
	});
});
