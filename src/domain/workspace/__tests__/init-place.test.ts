import "../../config/config.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { DetectedWorkspace } from "../detect-workspace.js";
import {
	BaseConfig,
	PlaceChoices,
	planPlace,
	readBaseConfig,
} from "../init-place.js";

const directory = path.resolve("/mock/my-game");

const luau: DetectedWorkspace = {
	language: "luau",
	darklua: false,
	codeFolders: [],
	hasSrc: true,
	packageDirs: new Set(),
	rbxtsScopes: [],
	hasInclude: false,
};
const darklua: DetectedWorkspace = { ...luau, darklua: true };
const rbxts: DetectedWorkspace = {
	...luau,
	language: "roblox-ts",
	outDir: "out",
	tsconfigHasInclude: true,
};

const choices: PlaceChoices = { name: "lobby", folder: "places/lobby" };

const plan = (
	workspace: DetectedWorkspace,
	base: BaseConfig,
	existingFiles: readonly string[] = []
) =>
	planPlace({
		choices,
		base,
		workspace,
		directory,
		existingFiles: new Set(existingFiles),
	});

const written = (result: ReturnType<typeof plan>) => {
	const value = result.unwrap();
	return {
		configs: Object.fromEntries(
			value.configs.map(({ fileName, content }) => [
				fileName,
				JSON.parse(content),
			])
		),
		tsconfig: value.tsconfig && JSON.parse(value.tsconfig.content),
		nextSteps: value.nextSteps,
	};
};

const SCHEMA = "https://rogen.dev/schema/2/rogen.json";

describe("planPlace", () => {
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
			).toEqual([
				"rogen watch lobby",
				"rojo serve lobby.project.json",
				'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.luau.',
			]);
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

		it("should say that Darklua must process the place folder", () => {
			expect(written(plan(darklua, base)).nextSteps).toEqual([
				"rogen watch lobby",
				"rojo serve lobby.project.json",
				"Darklua must also process places/lobby into dist/lobby.",
				'Add tags under "tags" in lobby-source.rogen.json to swap in variants like Analytics.mock.luau.',
			]);
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
					{ ...rbxts, tsBuildInfoFile: "out/tsconfig.tsbuildinfo" },
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
					{ ...rbxts, darklua: true, outDir: "build" },
					{ rootDirs: ["src"], syncDir: "dist" }
				)
			);

			expect(tsconfig.compilerOptions.outDir).toBe("build/lobby");
			expect(configs["lobby.rogen.json"].syncDir).toBe("dist/lobby");
		});

		it("should say how to compile, watch and serve the place", () => {
			expect(written(plan(rbxts, base)).nextSteps).toEqual([
				"rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
				"rogen watch lobby",
				"rojo serve lobby.project.json",
				'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.ts.',
			]);
		});

		it("should tell the user to add an include to tsconfig.json when it has none", () => {
			const { nextSteps } = written(
				plan(
					{ ...rbxts, tsconfigHasInclude: false },
					{ rootDirs: ["src", "shared"], syncDir: "out" }
				)
			);

			expect(nextSteps[0]).toBe(
				'Add "include": ["src","shared"] to tsconfig.json, so its build skips places/lobby.'
			);
		});

		it("should say what Darklua must process on top", () => {
			const { nextSteps } = written(
				plan(
					{ ...rbxts, darklua: true },
					{ rootDirs: ["src"], syncDir: "dist" }
				)
			);

			expect(nextSteps).toContain(
				"Darklua must also process out/lobby into dist/lobby."
			);
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

describe("readBaseConfig", () => {
	let fs: MemoryFileSystemService;

	const write = (file: string, content: unknown) =>
		fs.writeFile(path.join(directory, file), JSON.stringify(content));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(directory);
	});

	it("should read the root dirs of default.rogen.json relative to the directory", async () => {
		await write("default.rogen.json", { rootDirs: ["src", "shared"] });

		const base = (await readBaseConfig(fs, directory)).unwrap();

		expect(base).toEqual({ rootDirs: ["src", "shared"] });
	});

	it("should read the resolved value through extends, with the parent", async () => {
		await write("default.rogen.json", {
			extends: "./source.rogen.json",
			syncDir: "dist",
		});
		await write("source.rogen.json", { rootDirs: ["core"] });

		const base = (await readBaseConfig(fs, directory)).unwrap();

		expect(base).toEqual({
			rootDirs: ["core"],
			syncDir: "dist",
			parent: "source.rogen.json",
		});
	});

	it("should fail with diagnostics when default.rogen.json is broken", async () => {
		await fs.writeFile(
			path.join(directory, "default.rogen.json"),
			"{ nope"
		);

		const result = await readBaseConfig(fs, directory);

		expect(result.isErr()).toBe(true);
		expect(
			(result as ResultError<Diagnostic[]>).error.length
		).toBeGreaterThan(0);
	});
});
