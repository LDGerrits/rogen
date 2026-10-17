import { ProjectTemplate } from "../project-template.js";

describe("ProjectTemplate", () => {
	it("should write the .gitignore Rojo writes for each kind", () => {
		expect(new ProjectTemplate("place", "game").gitignore.content).toBe(
			"# Project place file\n/game.rbxlx\n\n# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n\nsourcemap.json\n"
		);
		expect(new ProjectTemplate("model", "lib").gitignore.content).toBe(
			"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n\nsourcemap.json\n"
		);
		expect(new ProjectTemplate("plugin", "tool").gitignore.content).toBe(
			"# Plugin model files\n/tool.rbxmx\n/tool.rbxm\n\nsourcemap.json\n"
		);
	});

	it("should write the one script of a model or a plugin, and none for a place", () => {
		expect(new ProjectTemplate("model", "lib").script?.fileName).toBe(
			"src/init.luau"
		);
		expect(new ProjectTemplate("plugin", "tool").script?.fileName).toBe(
			"src/init.server.luau"
		);
		expect(new ProjectTemplate("place", "game").script).toBeUndefined();
	});

	it("should name the project in the README and build it with Rogen", () => {
		const { content } = new ProjectTemplate("plugin", "tool").readme;

		expect(content).toContain("# tool\n");
		expect(content).toContain('rogen build -p "tool.rbxm"');
	});
});
