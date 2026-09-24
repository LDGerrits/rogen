import { RogenConfig } from "../../config/config.js";
import { RojoTree } from "../../rojo/rojo-tree.js";
import { DetectedWorkspace } from "../detect-workspace.js";
import { parseInitName, planInit } from "../init-plan.js";

const STARTING_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

const luau: DetectedWorkspace = { toolchain: "luau", packageMounts: {} };
const mounts = {
	ReplicatedStorage: { Packages: { $path: "Packages" } },
};

const plan = (
	workspace: DetectedWorkspace,
	name = "default",
	templateExists = false
) => planInit({ name, workspace, projectName: "my-game", templateExists });

const configOf = (
	files: ReturnType<typeof plan>,
	fileName: string
): RogenConfig => {
	const file = files.configs.find((config) => config.fileName === fileName);
	if (!file) throw new Error(`${fileName} was not planned`);
	return JSON.parse(file.content);
};

describe("planInit", () => {
	it("should write default.rogen.json for the default name", () => {
		const { configs } = plan(luau);

		expect(configs.map((config) => config.fileName)).toEqual([
			"default.rogen.json",
		]);
	});

	it("should write <name>.rogen.json for a named config", () => {
		const { configs } = plan(luau, "lobby");

		expect(configs.map((config) => config.fileName)).toEqual([
			"lobby.rogen.json",
		]);
	});

	it("should write the starting routes explicitly", () => {
		const config = configOf(plan(luau), "default.rogen.json");

		expect(config.routes).toEqual(STARTING_ROUTES);
	});

	it("should write fields in pipeline order", () => {
		const { configs } = plan(
			{ toolchain: "roblox-ts", outDir: "out", packageMounts: mounts },
			"default"
		);

		expect(Object.keys(JSON.parse(configs[0].content))).toEqual([
			"$schema",
			"rootDirs",
			"routes",
			"template",
			"syncDir",
		]);
	});

	it("should write strict JSON with a trailing newline", () => {
		const { configs } = plan(luau);

		expect(configs[0].content.endsWith("}\n")).toBe(true);
		expect(() => JSON.parse(configs[0].content)).not.toThrow();
	});

	it("should write neither sync dir nor template for plain luau", () => {
		const config = configOf(plan(luau), "default.rogen.json");

		expect(config.syncDir).toBeUndefined();
		expect(config.template).toBeUndefined();
		expect(config.extends).toBeUndefined();
	});

	it("should write the detected outDir as syncDir for roblox-ts", () => {
		const { configs } = plan({
			toolchain: "roblox-ts",
			outDir: "build",
			packageMounts: {},
		});

		expect(configs).toHaveLength(1);
		expect(JSON.parse(configs[0].content).syncDir).toBe("build");
	});

	describe("darklua", () => {
		const darklua: DetectedWorkspace = {
			toolchain: "darklua",
			packageMounts: {},
		};

		it("should write a source config and a default config extending it", () => {
			const files = plan(darklua);

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"source.rogen.json",
				"default.rogen.json",
			]);
			const source = configOf(files, "source.rogen.json");
			const child = configOf(files, "default.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(STARTING_ROUTES);
			expect(child.extends).toBe("source.rogen.json");
			expect(child.syncDir).toBe("dist");
		});

		it("should add only syncDir to the extending config", () => {
			const child = configOf(plan(darklua), "default.rogen.json");

			expect(Object.keys(child)).toEqual([
				"$schema",
				"extends",
				"syncDir",
			]);
		});

		it("should name the pair <name> and <name>-source for a named config", () => {
			const files = plan(darklua, "lobby");

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"lobby-source.rogen.json",
				"lobby.rogen.json",
			]);
			expect(configOf(files, "lobby.rogen.json").extends).toBe(
				"lobby-source.rogen.json"
			);
		});

		it("should put the template in the source config only", () => {
			const files = plan({ ...darklua, packageMounts: mounts });

			expect(configOf(files, "source.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(
				configOf(files, "default.rogen.json").template
			).toBeUndefined();
		});
	});

	describe("template", () => {
		it("should write template.project.json when mounts were detected", () => {
			const files = plan({ ...luau, packageMounts: mounts });

			expect(files.template?.fileName).toBe("template.project.json");
			expect(JSON.parse(files.template!.content)).toEqual({
				name: "my-game",
				tree: { $className: "DataModel", ...mounts },
			} satisfies RojoTree);
			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
		});

		it("should not write a template when nothing was mounted", () => {
			const files = plan(luau);

			expect(files.template).toBeUndefined();
		});

		it("should reference an existing template without rewriting it", () => {
			const files = plan(
				{ ...luau, packageMounts: mounts },
				"lobby",
				true
			);

			expect(files.template).toBeUndefined();
			expect(configOf(files, "lobby.rogen.json").template).toBe(
				"template.project.json"
			);
		});
	});
});

describe("parseInitName", () => {
	it("should default to the default config name", () => {
		expect(parseInitName([]).unwrap()).toBe("default");
	});

	it("should accept a single name", () => {
		expect(parseInitName(["lobby"]).unwrap()).toBe("lobby");
	});

	it.each(["a/b", "a\\b", "..", "."])("should reject %s", (name) => {
		expect(parseInitName([name]).isErr()).toBe(true);
	});

	it("should reject more than one name", () => {
		expect(parseInitName(["a", "b"]).isErr()).toBe(true);
	});
});
