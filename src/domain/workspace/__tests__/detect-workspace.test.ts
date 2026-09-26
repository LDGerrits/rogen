import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { detectWorkspace } from "../detect-workspace.js";

describe("detectWorkspace", () => {
	const cwd = path.resolve("/mock/workspace");
	let fs: MemoryFileSystemService;

	const write = async (file: string, content = "") => {
		await fs.writeFile(path.join(cwd, file), content);
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
	});

	describe("language and darklua", () => {
		it("should be luau without darklua when nothing is found", async () => {
			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace).toEqual({
				language: "luau",
				darklua: false,
				codeFolders: [],
				hasSrc: false,
				packageDirs: new Set(),
				rbxtsScopes: [],
				hasInclude: false,
			});
		});

		it("should detect roblox-ts from tsconfig.json", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.language).toBe("roblox-ts");
			expect(workspace.darklua).toBe(false);
		});

		it.each([".darklua.json", ".darklua.json5"])(
			"should detect darklua from %s",
			async (file) => {
				await write(file);

				const workspace = await detectWorkspace(fs, cwd);

				expect(workspace.language).toBe("luau");
				expect(workspace.darklua).toBe(true);
				expect(workspace.outDir).toBeUndefined();
			}
		);

		it("should report roblox-ts and darklua together", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.language).toBe("roblox-ts");
			expect(workspace.darklua).toBe(true);
		});
	});

	describe("outDir", () => {
		it("should read compilerOptions.outDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { outDir: "build" } })
			);

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.outDir).toBe("build");
		});

		it("should read a tsconfig.json that has comments and trailing commas", async () => {
			await write(
				"tsconfig.json",
				`{
					// roblox-ts
					"compilerOptions": { "outDir": "lib", },
				}`
			);

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.outDir).toBe("lib");
		});

		it.each([
			["has no outDir", "{}"],
			["has no compilerOptions", '{"include": ["src"]}'],
			["has a non-string outDir", '{"compilerOptions":{"outDir":1}}'],
			["has an empty outDir", '{"compilerOptions":{"outDir":""}}'],
			["is not valid JSON", "{ nope"],
		])("should fall back to out when tsconfig.json %s", async (_, text) => {
			await write("tsconfig.json", text);

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.outDir).toBe("out");
		});
	});

	describe("rootDir", () => {
		it("should read compilerOptions.rootDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { rootDir: "game" } })
			);

			expect((await detectWorkspace(fs, cwd)).rootDir).toBe("game");
		});

		it("should not report a rootDir when tsconfig.json has none", async () => {
			await write("tsconfig.json", "{}");

			expect((await detectWorkspace(fs, cwd)).rootDir).toBeUndefined();
		});
	});

	describe("tsconfig include and tsBuildInfoFile", () => {
		it("should report whether tsconfig.json sets include", async () => {
			await write("tsconfig.json", '{"include":["src"]}');

			expect((await detectWorkspace(fs, cwd)).tsconfigHasInclude).toBe(
				true
			);
		});

		it("should report a tsconfig.json without include", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.tsconfigHasInclude).toBe(false);
			expect(workspace.tsBuildInfoFile).toBeUndefined();
		});

		it("should read compilerOptions.tsBuildInfoFile", async () => {
			await write(
				"tsconfig.json",
				'{"compilerOptions":{"tsBuildInfoFile":"out/tsconfig.tsbuildinfo"}}'
			);

			expect((await detectWorkspace(fs, cwd)).tsBuildInfoFile).toBe(
				"out/tsconfig.tsbuildinfo"
			);
		});

		it("should not report them for luau", async () => {
			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.tsconfigHasInclude).toBeUndefined();
		});
	});

	describe("code folders", () => {
		it("should list top-level folders holding code, sorted", async () => {
			await write("src/a/b/Deep.luau");
			await write("places/lobby/Game.server.lua");
			await write("shared/Util.ts");
			await write("web/App.tsx");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.codeFolders).toEqual([
				"places",
				"shared",
				"src",
				"web",
			]);
		});

		it("should skip folders without code, dot-folders and node_modules", async () => {
			await write("docs/readme.md");
			await write(".git/hooks/pre-commit.lua");
			await write("node_modules/pkg/index.ts");
			await write("src/nested/node_modules/x/y.lua");
			await write("src/Real.luau");

			const workspace = await detectWorkspace(fs, cwd);

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

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.codeFolders).toEqual(["src"]);
		});

		it("should report whether src exists, even without code", async () => {
			await fs.createDirectory(path.join(cwd, "src"));

			const workspace = await detectWorkspace(fs, cwd);

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

				const workspace = await detectWorkspace(fs, cwd);

				expect(workspace.packageManager).toBe(manager);
			}
		);

		it("should prefer pesde when both manifests are present", async () => {
			await write("wally.toml");
			await write("pesde.toml");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.packageManager).toBe("pesde");
		});

		it("should report the package directories that exist", async () => {
			await mkdir("Packages");
			await mkdir("roblox_server_packages");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.packageManager).toBeUndefined();
			expect(workspace.packageDirs).toEqual(
				new Set(["Packages", "roblox_server_packages"])
			);
		});

		it("should report the rbxts scopes installed in node_modules", async () => {
			await write("node_modules/@rbxts/types/package.json");
			await write("node_modules/@flamework/core/package.json");
			await write("node_modules/@other/thing/package.json");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.rbxtsScopes).toEqual(["@rbxts", "@flamework"]);
		});

		it("should report whether include exists", async () => {
			await mkdir("include");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.hasInclude).toBe(true);
		});
	});
});
