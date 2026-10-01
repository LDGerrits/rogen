import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	WorkspaceSpec,
	withRobloxTs,
} from "../../toolchain/__tests__/workspaces.js";
import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { BaseConfig } from "../init-directory.js";
import { PlaceChoices, PlaceSetup } from "../place-setup.js";
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
		const base: BaseConfig = { rootDirs: ["src"], syncDir: "dist" };

		it("should write <name> from the source and a <name>-sync synced from dist/<name>", () => {
			const { configs } = written(plan(darklua, base));

			expect(configs).toEqual({
				"lobby.rogen.json": {
					$schema: SCHEMA,
					extends: "./default.rogen.json",
					rootDirs: ["src", "places/lobby"],
				},
				"lobby-sync.rogen.json": {
					$schema: SCHEMA,
					extends: "./lobby.rogen.json",
					syncDir: "dist/lobby",
				},
			});
		});

		it("should serve the synced project, keep the sourcemap current and process each root dir under the place's sync dir", () => {
			expect(written(plan(darklua, base)).nextSteps).toEqual({
				setup: [],
				run: [
					"rogen watch lobby lobby-sync",
					"rojo serve lobby-sync.project.json",
					"rojo sourcemap lobby.project.json --output sourcemap.json --watch",
				],
				darklua: [
					"darklua process src dist/lobby/src",
					"darklua process places/lobby dist/lobby/places/lobby",
				],
				edits: [
					'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.luau.',
				],
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
				{ rootDirs: ["src"], syncDir: "dist" },
				["lobby.rogen.json", "lobby-sync.rogen.json"]
			);

			expect(conflictsOf(result)).toEqual([
				path.join(directory, "lobby.rogen.json"),
				path.join(directory, "lobby-sync.rogen.json"),
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
