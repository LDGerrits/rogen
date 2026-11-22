import { ProjectTemplate } from "../project-template.js";

describe("ProjectTemplate", () => {
	it("should write the .gitignore Rojo writes for each kind, with every place file ignored", () => {
		expect(new ProjectTemplate("place", "game").gitignore.content).toBe(
			"# Place files\n/*.rbxl\n/*.rbxlx\n\n# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n\nsourcemap.json\n*.project.json\n"
		);
		expect(new ProjectTemplate("model", "lib").gitignore.content).toBe(
			"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n\nsourcemap.json\n*.project.json\n"
		);
		expect(new ProjectTemplate("plugin", "tool").gitignore.content).toBe(
			"# Plugin model files\n/tool.rbxmx\n/tool.rbxm\n\nsourcemap.json\n*.project.json\n"
		);
	});

	it("should list compiler output and installed packages after the rest", () => {
		const { content } = new ProjectTemplate("model", "lib", {
			compiled: ["/out"],
			installed: ["/node_modules", "/Packages"],
		}).gitignore;

		expect(content).toBe(
			"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n\nsourcemap.json\n*.project.json\n\n# Compiler output\n/out\n\n# Installed packages\n/node_modules\n/Packages\n"
		);
	});

	it("should leave out a section with nothing in it", () => {
		const { content } = new ProjectTemplate("model", "lib", {
			compiled: [],
			installed: ["/Packages"],
		}).gitignore;

		expect(content).not.toContain("Compiler output");
		expect(content).toContain("# Installed packages\n/Packages\n");
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

	it("should leave the README of a place to its sample", () => {
		expect(new ProjectTemplate("place", "game").readme).toBeUndefined();
	});

	it("should name the project in the README and build it with Rogen", () => {
		const content = new ProjectTemplate("plugin", "tool").readme?.content;

		expect(content).toContain("# tool\n");
		expect(content).toContain('rogen build -p "tool.rbxm"');
	});
});
