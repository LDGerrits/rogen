import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreToolchainService } from "../core-toolchain-service.js";

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

			expect(workspace).toEqual({
				language: "luau",
				darklua: false,
				codeFolders: [],
				hasSrc: false,
				packageDirs: new Set(),
				rbxtsScopes: [],
				hasInclude: false,
				places: [],
			});
		});

		it("should detect roblox-ts from tsconfig.json", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.language).toBe("roblox-ts");
			expect(workspace.darklua).toBe(false);
		});

		it.each([".darklua.json", ".darklua.json5"])(
			"should detect darklua from %s",
			async (file) => {
				await write(file);

				const workspace = await toolchain().detect(cwd);

				expect(workspace.language).toBe("luau");
				expect(workspace.darklua).toBe(true);
				expect(workspace.outDir).toBeUndefined();
			}
		);

		it("should report roblox-ts and darklua together", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			const workspace = await toolchain().detect(cwd);

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

			const workspace = await toolchain().detect(cwd);

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

			const workspace = await toolchain().detect(cwd);

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

			const workspace = await toolchain().detect(cwd);

			expect(workspace.outDir).toBe("out");
		});
	});

	describe("rootDir", () => {
		it("should read compilerOptions.rootDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { rootDir: "game" } })
			);

			expect((await toolchain().detect(cwd)).rootDir).toBe("game");
		});

		it("should not report a rootDir when tsconfig.json has none", async () => {
			await write("tsconfig.json", "{}");

			expect((await toolchain().detect(cwd)).rootDir).toBeUndefined();
		});
	});

	describe("tsconfig include and tsBuildInfoFile", () => {
		it("should report whether tsconfig.json sets include", async () => {
			await write("tsconfig.json", '{"include":["src"]}');

			expect((await toolchain().detect(cwd)).tsconfigHasInclude).toBe(
				true
			);
		});

		it("should report a tsconfig.json without include", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.tsconfigHasInclude).toBe(false);
			expect(workspace.tsBuildInfoFile).toBeUndefined();
		});

		it("should read compilerOptions.tsBuildInfoFile", async () => {
			await write(
				"tsconfig.json",
				'{"compilerOptions":{"tsBuildInfoFile":"out/tsconfig.tsbuildinfo"}}'
			);

			expect((await toolchain().detect(cwd)).tsBuildInfoFile).toBe(
				"out/tsconfig.tsbuildinfo"
			);
		});

		it("should not report them for luau", async () => {
			const workspace = await toolchain().detect(cwd);

			expect(workspace.tsconfigHasInclude).toBeUndefined();
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

				expect(workspace.packageManager).toBe(manager);
			}
		);

		it("should prefer pesde when both manifests are present", async () => {
			await write("wally.toml");
			await write("pesde.toml");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.packageManager).toBe("pesde");
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

			expect(workspace.rbxtsScopes).toEqual(["@rbxts", "@flamework"]);
		});

		it("should report whether include exists", async () => {
			await mkdir("include");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.hasInclude).toBe(true);
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

	describe("getLanguages", () => {
		it("should list Luau first, which is the language assumed when none is detected", () => {
			expect(toolchain.getLanguages().map(({ id }) => id)).toEqual([
				"luau",
				"roblox-ts",
			]);
		});
	});

	describe("getLanguage", () => {
		it("should find a language by id", () => {
			expect(toolchain.getLanguage("roblox-ts").compiler?.name).toBe(
				"roblox-ts"
			);
		});

		it("should throw for a language that isn't known", () => {
			expect(() => toolchain.getLanguage("python")).toThrow(
				'Language "python" is not registered.'
			);
		});

		it("should capitalize Luau route keys and keep roblox-ts keys as written", () => {
			expect(
				toolchain.getLanguage("luau").routeKey("serverStorage")
			).toBe("ServerStorage");
			expect(
				toolchain.getLanguage("roblox-ts").routeKey("serverStorage")
			).toBe("serverStorage");
		});
	});

	describe("getSyncTools", () => {
		it("should list Darklua and roblox-ts", () => {
			expect(toolchain.getSyncTools().map(({ id }) => id)).toEqual([
				"darklua",
				"roblox-ts",
			]);
		});
	});
});
