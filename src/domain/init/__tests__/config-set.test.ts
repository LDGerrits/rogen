import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { ConfigSet } from "../config-set.js";
import { InitPlanBuilder } from "../init-plan-builder.js";
import { directoryOf } from "./init-fixtures.js";

const luau = workspaceOf().languageFor("luau");
const robloxTs = workspaceOf().languageFor("roblox-ts");
const darklua = new Darklua();

describe("ConfigSet.syncStemOf", () => {
	it("should call default's synced config sync", () => {
		expect(ConfigSet.syncStemOf("default")).toBe("sync");
	});

	it("should suffix any other name", () => {
		expect(ConfigSet.syncStemOf("lobby")).toBe("lobby-sync");
	});
});

describe("ConfigSet", () => {
	describe("without a processor", () => {
		const set = new ConfigSet("default", luau, undefined);

		it("should write one config, and serve it", () => {
			expect(set.sourced).toBe(false);
			expect(set.syncFile).toBeUndefined();
			expect(set.configFiles).toEqual(["default.rogen.json"]);
			expect(set.stems).toEqual(["default"]);
		});

		it("should write one project file", () => {
			expect(set.outputFiles).toEqual(["default.project.json"]);
		});
	});

	describe("with Darklua reading the root dirs", () => {
		const set = new ConfigSet("game", luau, darklua);

		it("should write the named config first, then the synced one", () => {
			expect(set.sourced).toBe(true);
			expect(set.syncFile).toBe("game-sync.rogen.json");
			expect(set.configFiles).toEqual([
				"game.rogen.json",
				"game-sync.rogen.json",
			]);
		});

		it("should list the source-rooted project first", () => {
			expect(set.stems).toEqual(["game", "game-sync"]);
			expect(set.outputFiles).toEqual([
				"game.project.json",
				"game-sync.project.json",
			]);
		});
	});

	describe("with a compiler", () => {
		it("should write one config even when Darklua reads the compiler's output", () => {
			const set = new ConfigSet("default", robloxTs, darklua);

			expect(set.sourced).toBe(false);
			expect(set.configFiles).toEqual(["default.rogen.json"]);
		});
	});

	describe("placeFiles", () => {
		it("should be the place's config and project file", () => {
			expect(new ConfigSet("lobby", luau, undefined).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the synced config of a sourced place", () => {
			expect(new ConfigSet("lobby", luau, darklua).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby-sync.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the compiler's own per-place files", () => {
			expect(
				new ConfigSet("lobby", robloxTs, undefined).placeFiles
			).toEqual([
				"lobby.rogen.json",
				"tsconfig.lobby.json",
				"lobby.project.json",
			]);
		});
	});
});

describe("ConfigSet naming", () => {
	it("should write a reference as a relative path", () => {
		expect(ConfigSet.reference("default.rogen.json")).toBe(
			"./default.rogen.json"
		);
	});

	it("should keep a place's code under places", () => {
		expect(ConfigSet.placeFolderOf("lobby")).toBe("places/lobby");
	});

	it("should point at where variants of a script are swapped in", () => {
		expect(ConfigSet.variantsStep(luau, "default.rogen.json")).toBe(
			'Declare variants under "variants" in default.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.'
		);
	});

	it("should start the default config from default.rogen.json", () => {
		expect(ConfigSet.DEFAULT_FILE).toBe("default.rogen.json");
	});

	describe("handWrittenProjectFiles", () => {
		it("should leave out the template, which is not hand-written", () => {
			const target = directoryOf({
				existing: [
					"game.project.json",
					"template.project.json",
					"other.project.json",
					"other.rogen.json",
				],
			});

			expect(ConfigSet.handWrittenProjectFiles(target)).toEqual([
				"game.project.json",
			]);
		});
	});

	describe("parseName", () => {
		it("should be default without a name", () => {
			expect(ConfigSet.parseName([]).unwrap()).toBe("default");
		});

		it("should take the one name given", () => {
			expect(ConfigSet.parseName(["lobby"]).unwrap()).toBe("lobby");
		});

		it.each([
			[["a", "b"], "at most one"],
			[[" "], "can't be empty"],
			[["a/b"], "path separators"],
			[[".."], "path separators"],
			[["template"], "over template.project.json"],
		])("should reject %j", (names, message) => {
			const result = ConfigSet.parseName(names);

			expect(result.isErr() && result.error.message).toContain(message);
		});
	});

	describe("syncDir", () => {
		it("should be Darklua's output when Darklua processes the code", () => {
			expect(new ConfigSet("game", luau, darklua).syncDir).toBe("dist");
		});

		it("should be the compiler's output when there is one", () => {
			expect(new ConfigSet("game", robloxTs, undefined).syncDir).toBe(
				"out"
			);
		});

		it("should be none for plain Luau", () => {
			expect(
				new ConfigSet("game", luau, undefined).syncDir
			).toBeUndefined();
		});
	});
});

describe("ConfigSet planning", () => {
	const target = directoryOf();
	const own = { rootDirs: ["src"], routes: { "*": "ReplicatedStorage" } };

	const planned = (plan: (builder: InitPlanBuilder) => void) => {
		const builder = new InitPlanBuilder(target, false);
		plan(builder);
		return builder.build().unwrap();
	};
	const configsOf = (plan: ReturnType<typeof planned>) =>
		Object.fromEntries(
			plan.files.map(({ fileName, content }) => [
				fileName,
				JSON.parse(content),
			])
		);

	describe("planConfigs", () => {
		it("should write one config that carries the sync dir", () => {
			const plan = planned((builder) =>
				new ConfigSet("game", robloxTs, undefined).planConfigs(
					builder,
					own,
					"out"
				)
			);

			expect(configsOf(plan)).toMatchObject({
				"game.rogen.json": { ...own, syncDir: "out" },
			});
			expect(plan.files).toHaveLength(1);
		});

		it("should leave out the sync dir when there is none", () => {
			const plan = planned((builder) =>
				new ConfigSet("game", luau, undefined).planConfigs(builder, own)
			);

			expect(configsOf(plan)["game.rogen.json"]).not.toHaveProperty(
				"syncDir"
			);
		});

		it("should move the sync dir to the synced config beside a sourced one", () => {
			const plan = planned((builder) =>
				new ConfigSet("game", luau, darklua).planConfigs(
					builder,
					own,
					"dist"
				)
			);

			const configs = configsOf(plan);
			expect(plan.files.map(({ fileName }) => fileName)).toEqual([
				"game.rogen.json",
				"game-sync.rogen.json",
			]);
			expect(configs["game.rogen.json"]).toMatchObject(own);
			expect(configs["game.rogen.json"]).not.toHaveProperty("syncDir");
			expect(configs["game-sync.rogen.json"]).toMatchObject({
				extends: "./game.rogen.json",
				syncDir: "dist",
			});
		});
	});

	describe("planSteps", () => {
		const steps = (set: ConfigSet, compileCommand?: string) =>
			planned((builder) =>
				set.planSteps(builder, target, {
					compileCommand,
					processed: ["src"],
					syncDir: set.syncDir,
				})
			).nextSteps;

		it("should run the compile command, then serve", () => {
			expect(
				steps(new ConfigSet("game", luau, undefined), "rbxtsc -w").run
			).toEqual(["rbxtsc -w", "rogen serve game"]);
		});

		it("should have no compile command for plain Luau", () => {
			expect(steps(new ConfigSet("game", luau, undefined)).run).toEqual([
				"rogen serve game",
			]);
		});

		it("should serve a sourced set with one command, which picks the synced config", () => {
			const { run } = steps(new ConfigSet("game", luau, darklua));

			expect(run[0]).toBe("rogen serve game-sync");
		});

		it("should process the dirs into the sync dir when Darklua is used", () => {
			const { darklua: commands } = steps(
				new ConfigSet("game", luau, darklua)
			);

			expect(commands).toEqual(
				target.workspace.darklua.processCommands(
					target.path,
					["src"],
					"dist"
				)
			);
		});

		it("should keep a sourced set's sourcemap current", () => {
			const { run } = steps(new ConfigSet("game", luau, darklua));

			expect(run).toContain(
				target.workspace.darklua.sourcemapCommand("game.project.json")
			);
		});

		it("should have no Darklua commands without Darklua", () => {
			expect(
				steps(new ConfigSet("game", luau, undefined)).darklua
			).toEqual([]);
		});
	});
});
