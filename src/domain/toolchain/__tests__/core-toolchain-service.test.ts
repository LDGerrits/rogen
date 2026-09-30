import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreToolchainService } from "../core-toolchain-service.js";
import { DetectedWorkspace } from "../toolchain.js";

const rbxts = (workspace: DetectedWorkspace) =>
	workspace.languageFor("roblox-ts");

const PLACE = {
	name: "lobby",
	rootDirs: ["src", "places/lobby"],
	sharedRootDirs: ["src"],
	outDir: "out/lobby",
	projectFile: "lobby.project.json",
};

describe("CoreToolchainService.detect", () => {
	const cwd = path.resolve("/mock/workspace");
	let fs: MemoryFileSystemService;
	const toolchain = () => new CoreToolchainService(fs);

	const write = async (file: string, content = "") => {
		await fs.writeFile(path.join(cwd, file), content);
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
	});

	describe("language and darklua", () => {
		it("should be luau without darklua when nothing is found", async () => {
			const workspace = await toolchain().detect(cwd);

			expect(workspace.language.id).toBe("luau");
			expect(workspace.languages.map(({ id }) => id)).toEqual([
				"luau",
				"roblox-ts",
			]);
			expect(workspace).toMatchObject({
				usesDarklua: false,
				codeFolders: [],
				hasSrc: false,
				packageDirs: new Set(),
				places: [],
			});
			expect(workspace.packageManager).toBeUndefined();
		});

		it("should detect roblox-ts from tsconfig.json", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.language.id).toBe("roblox-ts");
			expect(workspace.usesDarklua).toBe(false);
		});

		it.each([".darklua.json", ".darklua.json5"])(
			"should detect darklua from %s",
			async (file) => {
				await write(file);

				const workspace = await toolchain().detect(cwd);

				expect(workspace.language.id).toBe("luau");
				expect(workspace.usesDarklua).toBe(true);
			}
		);

		it("should report roblox-ts and darklua together", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.language.id).toBe("roblox-ts");
			expect(workspace.usesDarklua).toBe(true);
		});
	});

	describe("outDir", () => {
		it("should read compilerOptions.outDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { outDir: "build" } })
			);

			const workspace = await toolchain().detect(cwd);

			expect(rbxts(workspace).compiler?.outDir).toBe("build");
		});

		it("should read a tsconfig.json that has comments and trailing commas", async () => {
			await write(
				"tsconfig.json",
				`{
					"compilerOptions": { "outDir": "lib", },
				}`
			);

			const workspace = await toolchain().detect(cwd);

			expect(rbxts(workspace).compiler?.outDir).toBe("lib");
		});

		it.each([
			["has no outDir", "{}"],
			["has no compilerOptions", '{"include": ["src"]}'],
			["has a non-string outDir", '{"compilerOptions":{"outDir":1}}'],
			["has an empty outDir", '{"compilerOptions":{"outDir":""}}'],
			["is not valid JSON", "{ nope"],
		])("should fall back to out when tsconfig.json %s", async (_, text) => {
			await write("tsconfig.json", text);

			const workspace = await toolchain().detect(cwd);

			expect(rbxts(workspace).compiler?.outDir).toBe("out");
		});
	});

	describe("rootDir", () => {
		it("should read compilerOptions.rootDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { rootDir: "game" } })
			);

			expect(
				rbxts(await toolchain().detect(cwd)).configuredRootDir()
			).toBe("game");
		});

		it("should not report a rootDir when tsconfig.json has none", async () => {
			await write("tsconfig.json", "{}");

			expect(
				rbxts(await toolchain().detect(cwd)).configuredRootDir()
			).toBeUndefined();
		});
	});

	describe("tsconfig include and tsBuildInfoFile", () => {
		it("should report whether tsconfig.json sets include", async () => {
			await write("tsconfig.json", '{"include":["src"]}');

			const place = rbxts(
				await toolchain().detect(cwd)
			).compiler?.planPlace(PLACE);

			expect(place?.setup).toEqual([]);
		});

		it("should report a tsconfig.json without include", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await toolchain().detect(cwd);

			const place = rbxts(workspace).compiler?.planPlace(PLACE);
			expect(place?.setup).toEqual([
				expect.stringContaining(
					'Add "include": ["src"] to tsconfig.json'
				),
			]);
			expect(place?.files[0].content).not.toContain("tsBuildInfoFile");
		});

		it("should read compilerOptions.tsBuildInfoFile", async () => {
			await write(
				"tsconfig.json",
				'{"compilerOptions":{"tsBuildInfoFile":"out/tsconfig.tsbuildinfo"}}'
			);

			const place = rbxts(
				await toolchain().detect(cwd)
			).compiler?.planPlace(PLACE);

			expect(place?.files[0].content).toContain(
				'"tsBuildInfoFile": "out/lobby/tsconfig.tsbuildinfo"'
			);
		});
	});

	describe("code folders", () => {
		it("should list top-level folders holding code, sorted", async () => {
			await write("src/a/b/Deep.luau");
			await write("lib/Game.server.lua");
			await write("shared/Util.ts");
			await write("web/App.tsx");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.codeFolders).toEqual([
				"lib",
				"shared",
				"src",
				"web",
			]);
		});

		it("should leave out places, whose folders are places rather than code", async () => {
			await write("src/Util.luau");
			await write("places/lobby/Game.server.lua");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.codeFolders).toEqual(["src"]);
		});

		it("should skip folders without code, dot-folders and node_modules", async () => {
			await write("docs/readme.md");
			await write(".git/hooks/pre-commit.lua");
			await write("node_modules/pkg/index.ts");
			await write("src/nested/node_modules/x/y.lua");
			await write("src/Real.luau");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.codeFolders).toEqual(["src"]);
		});

		it("should skip package folders, include and the outDir", async () => {
			await write(
				"tsconfig.json",
				'{"compilerOptions":{"outDir":"lib"}}'
			);
			await write("Packages/Roact.luau");
			await write("include/RuntimeLib.lua");
			await write("lib/main.luau");
			await write("src/main.ts");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.codeFolders).toEqual(["src"]);
		});

		it("should report whether src exists, even without code", async () => {
			await fs.createDirectory(path.join(cwd, "src"));

			const workspace = await toolchain().detect(cwd);

			expect(workspace.hasSrc).toBe(true);
			expect(workspace.codeFolders).toEqual([]);
		});
	});

	describe("packages", () => {
		const mkdir = (dir: string) => fs.createDirectory(path.join(cwd, dir));

		it.each([
			["wally.toml", "wally"],
			["pesde.toml", "pesde"],
		])(
			"should detect the package manager from %s",
			async (file, manager) => {
				await write(file);

				const workspace = await toolchain().detect(cwd);

				expect(workspace.packageManager?.id).toBe(manager);
			}
		);

		it("should prefer pesde when both manifests are present", async () => {
			await write("wally.toml");
			await write("pesde.toml");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.packageManager?.id).toBe("pesde");
		});

		it("should report the package directories that exist", async () => {
			await mkdir("Packages");
			await mkdir("roblox_server_packages");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.packageManager).toBeUndefined();
			expect(workspace.packageDirs).toEqual(
				new Set(["Packages", "roblox_server_packages"])
			);
		});

		it("should report the rbxts scopes installed in node_modules", async () => {
			await write("node_modules/@rbxts/types/package.json");
			await write("node_modules/@flamework/core/package.json");
			await write("node_modules/@other/thing/package.json");

			const workspace = await toolchain().detect(cwd);

			expect(
				rbxts(workspace)
					.alwaysMounted()
					.filter(({ installed }) => installed)
					.map(({ path }) => path)
			).toEqual(["node_modules/@rbxts"]);
			expect(
				rbxts(workspace)
					.offeredMounts()
					.map(({ path }) => path)
			).toEqual(["node_modules/@flamework"]);
		});

		it("should report whether include exists", async () => {
			await mkdir("include");

			const workspace = await toolchain().detect(cwd);

			expect(rbxts(workspace).alwaysMounted()[0]).toMatchObject({
				path: "include",
				installed: true,
			});
		});
	});

	describe("places", () => {
		it("should list the folders in places, sorted", async () => {
			await write("places/match/Game.luau");
			await write("places/lobby/.gitkeep");
			await write("places/.hidden/x.luau");
			await write("places/notes.md");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.places).toEqual(["lobby", "match"]);
		});

		it("should find none without a places folder", async () => {
			expect((await toolchain().detect(cwd)).places).toEqual([]);
		});
	});
});

describe("CoreToolchainService", () => {
	const toolchain = new CoreToolchainService(new MemoryFileSystemService());

	describe("getSyncTools", () => {
		it("should list Darklua and roblox-ts", () => {
			expect(toolchain.getSyncTools().map(({ id }) => id)).toEqual([
				"darklua",
				"roblox-ts",
			]);
		});
	});
});
