import "../../config/config-schema.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import {
	WorkspaceSpec,
	withRobloxTs,
} from "../../toolchain/__tests__/workspaces.js";
import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { BaseConfig } from "../init-directory.js";
import { InitQuestions } from "../init-questions.js";
import { PlaceChoices, PlaceSetup, VariantSetup } from "../place-setup.js";
import { directory, directoryOf, legacyPlan, planOf } from "./init-fixtures.js";

const luau: WorkspaceSpec = { hasSrc: true };
const darklua: WorkspaceSpec = { ...luau, usesDarklua: true };
const rbxts: WorkspaceSpec = withRobloxTs(
	{ ...luau, language: "roblox-ts" },
	{ outDir: "out", tsconfigHasInclude: true }
);

const choices: PlaceChoices = { name: "lobby", folder: "places/lobby" };

const plan = (
	spec: WorkspaceSpec,
	base: BaseConfig,
	existingFiles: readonly string[] = []
) => {
	const target = directoryOf({ workspace: spec, existing: existingFiles });
	const { workspace } = target;
	return planOf(
		PlaceSetup.within(
			target,
			{
				language: workspace.language,
				darklua: workspace.usesDarklua,
				base,
			},
			choices
		),
		target
	).map(legacyPlan);
};

const written = (result: ReturnType<typeof plan>) => {
	const value = result.unwrap();
	return {
		configs: Object.fromEntries(
			value.configs.map(({ fileName, content }) => [
				fileName,
				JSON.parse(content),
			])
		),
		tsconfig:
			value.compilerConfigs[0] &&
			JSON.parse(value.compilerConfigs[0].content),
		nextSteps: value.nextSteps,
	};
};

describe("PlaceSetup", () => {
	describe("luau", () => {
		it("should write one config extending default, with the place folder added", () => {
			const { configs, tsconfig } = written(
				plan(luau, { rootDirs: ["src"] })
			);

			expect(configs).toEqual({
				"lobby.rogen.json": {
					$schema: SCHEMA,
					extends: "./default.rogen.json",
					rootDirs: ["src", "places/lobby"],
				},
			});
			expect(tsconfig).toBeUndefined();
		});

		it("should keep every root dir default has", () => {
			const { configs } = written(
				plan(luau, { rootDirs: ["core", "shared"] })
			);

			expect(configs["lobby.rogen.json"].rootDirs).toEqual([
				"core",
				"shared",
				"places/lobby",
			]);
		});

		it("should write the fields in pipeline order", () => {
			const value = plan(luau, { rootDirs: ["src"] }).unwrap();

			expect(Object.keys(JSON.parse(value.configs[0].content))).toEqual([
				"$schema",
				"extends",
				"rootDirs",
			]);
		});

		it("should say how to run the place", () => {
			expect(
				written(plan(luau, { rootDirs: ["src"] })).nextSteps
			).toEqual({
				setup: [],
				run: ["rogen watch lobby", "rojo serve lobby.project.json"],
				darklua: [],
				edits: [
					'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.luau.',
				],
			});
		});
	});

	describe("luau with darklua", () => {
		const base: BaseConfig = {
			rootDirs: ["src"],
			syncDir: "dist",
			parent: "source.rogen.json",
		};

		it("should write <name>-source and a <name> synced from dist/<name>", () => {
			const { configs } = written(plan(darklua, base));

			expect(configs).toEqual({
				"lobby-source.rogen.json": {
					$schema: SCHEMA,
					extends: "./source.rogen.json",
					rootDirs: ["src", "places/lobby"],
				},
				"lobby.rogen.json": {
					$schema: SCHEMA,
					extends: "./lobby-source.rogen.json",
					syncDir: "dist/lobby",
				},
			});
		});

		it("should extend the shared source config wherever default gets it", () => {
			const { configs } = written(
				plan(darklua, { ...base, parent: "configs/core.rogen.json" })
			);

			expect(configs["lobby-source.rogen.json"].extends).toBe(
				"./configs/core.rogen.json"
			);
		});

		it("should process each root dir to its path under the place's sync dir", () => {
			expect(written(plan(darklua, base)).nextSteps).toEqual({
				setup: [],
				run: [
					"rogen watch lobby lobby-source",
					"rojo serve lobby.project.json",
				],
				darklua: [
					"darklua process src dist/lobby/src",
					"darklua process places/lobby dist/lobby/places/lobby",
				],
				edits: [
					'Add tags under "tags" in lobby-source.rogen.json to swap in variants like Analytics.mock.luau.',
				],
			});
		});

		it("should write one synced config when default has no source config to extend", () => {
			const { configs } = written(
				plan(darklua, { rootDirs: ["src"], syncDir: "dist" })
			);

			expect(Object.keys(configs)).toEqual(["lobby.rogen.json"]);
			expect(configs["lobby.rogen.json"]).toMatchObject({
				extends: "./default.rogen.json",
				rootDirs: ["src", "places/lobby"],
				syncDir: "dist/lobby",
			});
		});
	});

	describe("roblox-ts", () => {
		const base: BaseConfig = { rootDirs: ["src"], syncDir: "out" };

		it("should write a config synced from <default's sync dir>/<name>", () => {
			const { configs } = written(plan(rbxts, base));

			expect(configs).toEqual({
				"lobby.rogen.json": {
					$schema: SCHEMA,
					extends: "./default.rogen.json",
					rootDirs: ["src", "places/lobby"],
					syncDir: "out/lobby",
				},
			});
		});

		it("should write tsconfig.<name>.json extending tsconfig.json", () => {
			const { tsconfig } = written(plan(rbxts, base));

			expect(tsconfig).toEqual({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: null,
					rootDirs: ["src", "places/lobby"],
					outDir: "out/lobby",
				},
				include: ["src", "places/lobby"],
			});
		});

		it("should give the place its own tsBuildInfoFile when tsconfig.json sets one", () => {
			const { tsconfig } = written(
				plan(
					withRobloxTs(rbxts, {
						tsBuildInfoFile: "out/tsconfig.tsbuildinfo",
					}),
					base
				)
			);

			expect(tsconfig.compilerOptions.tsBuildInfoFile).toBe(
				"out/lobby/tsconfig.tsbuildinfo"
			);
		});

		it("should use the tsconfig outDir for the compiler and the sync dir for Rojo", () => {
			const { configs, tsconfig } = written(
				plan(
					withRobloxTs(
						{ ...rbxts, usesDarklua: true },
						{ outDir: "build" }
					),
					{ rootDirs: ["src"], syncDir: "dist" }
				)
			);

			expect(tsconfig.compilerOptions.outDir).toBe("build/lobby");
			expect(configs["lobby.rogen.json"].syncDir).toBe("dist/lobby");
		});

		it("should say how to compile, watch and serve the place", () => {
			expect(written(plan(rbxts, base)).nextSteps).toEqual({
				setup: [],
				run: [
					"rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
					"rogen watch lobby",
					"rojo serve lobby.project.json",
				],
				darklua: [],
				edits: [
					'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.ts.',
				],
			});
		});

		it("should tell the user to add an include to tsconfig.json when it has none", () => {
			const { nextSteps } = written(
				plan(withRobloxTs(rbxts, { tsconfigHasInclude: false }), {
					rootDirs: ["src", "shared"],
					syncDir: "out",
				})
			);

			expect(nextSteps.setup).toEqual([
				'Add "include": ["src","shared"] to tsconfig.json, so its own build leaves out the place folders.',
			]);
		});

		it("should say what Darklua must process on top", () => {
			const { nextSteps } = written(
				plan(
					{ ...rbxts, usesDarklua: true },
					{ rootDirs: ["src"], syncDir: "dist" }
				)
			);

			expect(nextSteps.darklua).toEqual([
				"darklua process out/lobby dist/lobby",
			]);
		});
	});

	describe("existing files", () => {
		const conflictsOf = (result: ReturnType<typeof plan>) =>
			(result as ResultError<Diagnostic[]>).error.map((d) => d.resource);

		it("should fail when the place's config exists", () => {
			const result = plan(luau, { rootDirs: ["src"] }, [
				"lobby.rogen.json",
			]);

			expect(conflictsOf(result)).toEqual([
				path.join(directory, "lobby.rogen.json"),
			]);
		});

		it("should report every file a Darklua place would write that exists", () => {
			const result = plan(
				darklua,
				{ rootDirs: ["src"], parent: "source.rogen.json" },
				["lobby-source.rogen.json", "lobby.rogen.json"]
			);

			expect(conflictsOf(result)).toEqual([
				path.join(directory, "lobby-source.rogen.json"),
				path.join(directory, "lobby.rogen.json"),
			]);
		});

		it("should fail when the place's tsconfig exists", () => {
			const result = plan(rbxts, { rootDirs: ["src"] }, [
				"tsconfig.lobby.json",
			]);

			expect(conflictsOf(result)).toEqual([
				path.join(directory, "tsconfig.lobby.json"),
			]);
		});
	});
});

describe("VariantSetup", () => {
	const variant = async (existing: readonly string[] = []) => {
		const target = directoryOf({ givenName: "prod", existing });
		const setup = new VariantSetup(
			target,
			new InitQuestions(new MockPromptService([], false))
		);
		return { asked: await setup.ask(), setup, target };
	};

	it("should write a config that only extends default", async () => {
		const { setup, target } = await variant();

		const plan = legacyPlan(planOf(setup, target).unwrap());

		expect(plan.configs.map(({ fileName }) => fileName)).toEqual([
			"prod.rogen.json",
		]);
		expect(JSON.parse(plan.configs[0].content)).toEqual({
			$schema: SCHEMA,
			extends: "./default.rogen.json",
		});
		expect(plan.nextSteps).toEqual({
			setup: [],
			run: ["rogen watch prod", "rojo serve prod.project.json"],
			darklua: [],
			edits: [
				'Turn tags on or off under "tags", or add "exclude", in prod.rogen.json.',
			],
		});
	});

	it("should fail when the variant's config exists", async () => {
		const { asked } = await variant(["prod.rogen.json"]);

		expect(asked.isErr()).toBe(true);
	});

	it("should fail when the variant's project file exists", async () => {
		const { asked } = await variant(["prod.project.json"]);

		expect(asked.isErr()).toBe(true);
	});
});
