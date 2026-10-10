import path from "path";
import { ResultError, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	WorkspaceSpec,
	withRobloxTs,
} from "../../toolchain/__tests__/workspaces.js";
import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { BaseConfigReader } from "../base-config-reader.js";
import { PlaceFolder } from "../place-folder.js";
import { PlaceSetup } from "../place-setup.js";
import {
	directory,
	directoryOf,
	legacyPlan,
	placeFoldersOf,
	planOf,
} from "./init-fixtures.js";
import { BaseConfig } from "../init-directory.js";

const luau: WorkspaceSpec = { hasSrc: true };
const darklua: WorkspaceSpec = { ...luau, darkluaConfig: ".darklua.json" };
const rbxts: WorkspaceSpec = withRobloxTs(
	{ ...luau, language: "roblox-ts" },
	{ outDir: "out", tsconfigHasInclude: true }
);

const choices = {
	name: "lobby",
	folder: PlaceFolder.empty("places/lobby"),
	servePort: 34873,
};

const plan = (
	spec: WorkspaceSpec,
	base: BaseConfig,
	existingFiles: readonly string[] = []
) => {
	const target = directoryOf({ workspace: spec, existing: existingFiles });
	const { workspace } = target;
	return planOf(
		new PlaceSetup(
			target,
			ok(base),
			new InitQuestions(new MockPromptService([], false), false),
			placeFoldersOf()
		),
		{
			...choices,
			language: workspace.language,
			darklua: workspace.detectedDarklua,
			base,
		},
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
		it("should write one config extending default, with only the place folder", () => {
			const { configs, tsconfig } = written(
				plan(luau, { rootDirs: ["src"] })
			);

			expect(configs).toEqual({
				"lobby.rogen.json": {
					$schema: SCHEMA,
					extends: "./default.rogen.json",
					rootDirs: ["places/lobby/src"],
					template: "places/lobby/template.project.json",
				},
			});
			expect(tsconfig).toBeUndefined();
		});

		it("should leave the root dirs default has to default", () => {
			const { configs } = written(
				plan(luau, { rootDirs: ["core", "shared"] })
			);

			expect(configs["lobby.rogen.json"].rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should write the fields in pipeline order", () => {
			const value = plan(luau, { rootDirs: ["src"] }).unwrap();

			expect(Object.keys(JSON.parse(value.configs[0].content))).toEqual([
				"$schema",
				"extends",
				"rootDirs",
				"template",
			]);
		});

		it("should say how to run the place", () => {
			expect(
				written(plan(luau, { rootDirs: ["src"] })).nextSteps
			).toEqual({
				setup: [],
				run: ["rogen serve"],
				darklua: [],
				edits: [
					'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
				],
			});
		});
	});

	describe("directories", () => {
		it("should plan only the place folder, not the root dirs it inherits", () => {
			const target = directoryOf({ workspace: luau });
			const { workspace } = target;

			const value = planOf(
				new PlaceSetup(
					target,
					ok({ rootDirs: ["src"] }),
					new InitQuestions(new MockPromptService([], false), false),
					placeFoldersOf()
				),
				{
					...choices,
					language: workspace.language,
					darklua: workspace.detectedDarklua,
					base: { rootDirs: ["src"] },
				},
				target
			).unwrap();

			expect(value.directories).toEqual(["places/lobby/src"]);
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
					rootDirs: ["places/lobby/src"],
					template: "places/lobby/template.project.json",
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
					"rogen serve lobby-sync",
					"rojo sourcemap lobby.project.json --output sourcemap.json --watch",
				],
				darklua: [
					"darklua process src dist/lobby/src",
					"darklua process places/lobby/src dist/lobby/places/lobby/src",
				],
				edits: [
					'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
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
					rootDirs: ["places/lobby/src"],
					syncDir: "out/lobby",
					template: "places/lobby/template.project.json",
				},
			});
		});

		it("should write tsconfig.<name>.json extending tsconfig.json", () => {
			const { tsconfig } = written(plan(rbxts, base));

			expect(tsconfig).toEqual({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: null,
					rootDirs: ["src", "places/lobby/src"],
					outDir: "out/lobby",
				},
				include: ["src", "places/lobby/src"],
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
						{ ...rbxts, darkluaConfig: ".darklua.json" },
						{ outDir: "build" }
					),
					{ rootDirs: ["src"], syncDir: "dist" }
				)
			);

			expect(tsconfig.compilerOptions.outDir).toBe("build/lobby");
			expect(configs["lobby.rogen.json"].syncDir).toBe("dist/lobby");
		});

		it("should sync from Darklua's output when Darklua processes compiled code and its config sets no sync dir", () => {
			const { configs, nextSteps } = written(
				plan(
					{ ...rbxts, darkluaConfig: ".darklua.json" },
					{ rootDirs: ["src"] }
				)
			);

			expect(configs["lobby.rogen.json"].syncDir).toBe("dist/lobby");
			expect(nextSteps.darklua).toEqual([
				"darklua process out/lobby dist/lobby",
			]);
		});

		it("should say how to compile, watch and serve the place", () => {
			expect(written(plan(rbxts, base)).nextSteps).toEqual({
				setup: [],
				run: [
					"rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
					"rogen serve",
				],
				darklua: [],
				edits: [
					'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.ts, and turn them on in a mode or with --variant.',
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
					{ ...rbxts, darkluaConfig: ".darklua.json" },
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

describe("BaseConfigReader", () => {
	let fs: MemoryFileSystemService;

	const write = (file: string, content: unknown) =>
		fs.writeFile(path.join(directory, file), JSON.stringify(content));

	const readBase = (entries: readonly string[] = ["default.rogen.json"]) =>
		new BaseConfigReader(
			new CoreConfigService(fs, new MockEnvironmentService(directory)),
			directory
		).read(new Set(entries));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(directory);
	});

	it("should read the root dirs of default.rogen.json relative to the directory", async () => {
		await write("default.rogen.json", { rootDirs: ["src", "shared"] });

		expect((await readBase()).unwrap()).toEqual({
			rootDirs: ["src", "shared"],
			ports: [],
			sharedPort: false,
		});
	});

	it("should read the resolved value through extends", async () => {
		await write("default.rogen.json", {
			extends: "./core.rogen.json",
			syncDir: "dist",
		});
		await write("core.rogen.json", { rootDirs: ["core"] });

		expect((await readBase()).unwrap()).toMatchObject({
			rootDirs: ["core"],
			syncDir: "dist",
		});
	});

	it("should take the sync dir from the synced config when default is source-rooted", async () => {
		await write("default.rogen.json", { rootDirs: ["src"] });
		await write("sync.rogen.json", {
			extends: "./default.rogen.json",
			syncDir: "dist",
		});

		expect(
			(await readBase(["default.rogen.json", "sync.rogen.json"])).unwrap()
		).toMatchObject({ rootDirs: ["src"], syncDir: "dist" });
	});

	it("should read the port every config's template serves on, skipping a broken config", async () => {
		await write("default.rogen.json", {
			template: "default.template.json",
		});
		await write("default.template.json", { servePort: 34872 });
		await write("lobby.rogen.json", {
			extends: "./default.rogen.json",
			template: "lobby.template.json",
		});
		await write("lobby.template.json", { servePort: 34873 });
		await fs.writeFile(path.join(directory, "broken.rogen.json"), "{ nope");

		expect(
			(
				await readBase([
					"default.rogen.json",
					"lobby.rogen.json",
					"broken.rogen.json",
					"lobby.template.json",
				])
			).unwrap().ports
		).toEqual([34872, 34873]);
	});

	it("should fail with diagnostics when default.rogen.json is broken", async () => {
		await fs.writeFile(
			path.join(directory, "default.rogen.json"),
			"{ nope"
		);

		const result = await readBase();

		expect(
			(result as ResultError<Diagnostic[]>).error.length
		).toBeGreaterThan(0);
	});
});
