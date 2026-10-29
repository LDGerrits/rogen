import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreToolchainService } from "../core-toolchain-service.js";
import { DetectedWorkspace } from "../toolchain.js";

const rbxts = (workspace: DetectedWorkspace) =>
	workspace.languageFor("roblox-ts");

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

	describe("test runner", () => {
		it("should name the runner a manifest depends on", async () => {
			await write(
				"wally.toml",
				'[dev-dependencies]\nJest = "jsdotlua/jest@3"\n'
			);

			expect((await toolchain().detect(cwd)).testRunner).toBe("Jest");
		});

		it("should find none without one", async () => {
			expect((await toolchain().detect(cwd)).testRunner).toBeUndefined();
		});
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
				darkluaConfig: undefined,
				packageDirs: new Set(),
			});
			expect(workspace.packageManager).toBeUndefined();
		});

		it("should detect roblox-ts from tsconfig.json", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.language.id).toBe("roblox-ts");
			expect(workspace.darkluaConfig).toBeUndefined();
		});

		it.each([".darklua.json", ".darklua.json5"])(
			"should detect darklua from %s, and name the file",
			async (file) => {
				await write(file);

				const workspace = await toolchain().detect(cwd);

				expect(workspace.language.id).toBe("luau");
				expect(workspace.darkluaConfig).toBe(file);
			}
		);

		it("should name .darklua.json when both configs exist, as Darklua reads it first", async () => {
			await write(".darklua.json5");
			await write(".darklua.json");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.darkluaConfig).toBe(".darklua.json");
		});

		it("should report roblox-ts and darklua together", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			const workspace = await toolchain().detect(cwd);

			expect(workspace.language.id).toBe("roblox-ts");
			expect(workspace.darkluaConfig).toBe(".darklua.json");
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

	describe("extends", () => {
		const extending = (extendsPath: string | string[]) =>
			write("tsconfig.json", JSON.stringify({ extends: extendsPath }));

		it("should read the outDir of a base config", async () => {
			await write(
				"tsconfig.base.json",
				JSON.stringify({ compilerOptions: { outDir: "build" } })
			);
			await extending("./tsconfig.base");

			expect(rbxts(await toolchain().detect(cwd)).compiler?.outDir).toBe(
				"build"
			);
		});

		it("should let the config override the base, and keep the rest of it", async () => {
			await write(
				"tsconfig.base.json",
				JSON.stringify({
					compilerOptions: { outDir: "build", rootDir: "game" },
					include: ["game"],
				})
			);
			await write(
				"tsconfig.json",
				JSON.stringify({
					extends: "./tsconfig.base.json",
					compilerOptions: { outDir: "lib" },
				})
			);

			const language = rbxts(await toolchain().detect(cwd));

			expect(language.compiler?.outDir).toBe("lib");
			expect(language.configuredSourcePath()).toBe("game");
		});

		it("should read a base in another folder, with its paths made relative to here", async () => {
			await write(
				"configs/tsconfig.base.json",
				JSON.stringify({ compilerOptions: { outDir: "../build" } })
			);
			await extending("./configs/tsconfig.base.json");

			expect(rbxts(await toolchain().detect(cwd)).compiler?.outDir).toBe(
				"build"
			);
		});

		it("should follow a chain of bases and a package under node_modules, reading paths from the file that sets them", async () => {
			await write(
				"node_modules/@acme/tsconfig/tsconfig.json",
				JSON.stringify({ compilerOptions: { outDir: "dist" } })
			);
			await write(
				"tsconfig.base.json",
				JSON.stringify({ extends: "@acme/tsconfig" })
			);
			await extending("./tsconfig.base.json");

			expect(rbxts(await toolchain().detect(cwd)).compiler?.outDir).toBe(
				"node_modules/@acme/tsconfig/dist"
			);
		});

		it("should read a list of bases, the last of them having the last word", async () => {
			await write(
				"tsconfig.a.json",
				JSON.stringify({
					compilerOptions: { outDir: "from-a", rootDir: "game" },
				})
			);
			await write(
				"tsconfig.b.json",
				JSON.stringify({ compilerOptions: { outDir: "from-b" } })
			);
			await extending(["./tsconfig.a.json", "./tsconfig.b.json"]);

			const language = rbxts(await toolchain().detect(cwd));

			expect(language.compiler?.outDir).toBe("from-b");
			expect(language.configuredSourcePath()).toBe("game");
		});

		it("should find a package in a node_modules above the folder", async () => {
			await write(
				"../node_modules/@acme/tsconfig/tsconfig.json",
				JSON.stringify({ compilerOptions: { rootDir: "shared" } })
			);
			await extending("@acme/tsconfig");

			expect(
				rbxts(await toolchain().detect(cwd)).configuredSourcePath()
			).toBe("../node_modules/@acme/tsconfig/shared");
		});

		it("should stop at a loop or a base that is missing", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ extends: "./tsconfig.json" })
			);

			expect(rbxts(await toolchain().detect(cwd)).compiler?.outDir).toBe(
				"out"
			);

			await extending("./nowhere.json");

			expect(rbxts(await toolchain().detect(cwd)).compiler?.outDir).toBe(
				"out"
			);
		});
	});

	describe("source path", () => {
		it("should read compilerOptions.rootDir from tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { rootDir: "game" } })
			);

			expect(
				rbxts(await toolchain().detect(cwd)).configuredSourcePath()
			).toBe("game");
		});

		it("should not report a source path when tsconfig.json has no rootDir", async () => {
			await write("tsconfig.json", "{}");

			expect(
				rbxts(await toolchain().detect(cwd)).configuredSourcePath()
			).toBeUndefined();
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
});

describe("CoreToolchainService", () => {
	const toolchain = new CoreToolchainService(new MemoryFileSystemService());

	describe("syncTools", () => {
		it("should list Darklua and roblox-ts", () => {
			expect(toolchain.syncTools.map(({ id }) => id)).toEqual([
				"darklua",
				"roblox-ts",
			]);
		});
	});
});

describe("CoreToolchainService.readManifests", () => {
	let fs: MemoryFileSystemService;
	let toolchain: CoreToolchainService;
	const files = async (directory: string) =>
		(await toolchain.readManifests(directory)).map(({ file }) => file);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/game");
		toolchain = new CoreToolchainService(fs);
	});

	it("should list the files of the folder and every folder above, the nearest first", async () => {
		await fs.writeFile("/repo/rokit.toml", "[tools]\n");
		await fs.writeFile("/repo/game/aftman.toml", "[tools]\n");
		await fs.writeFile("/repo/game/rokit.toml", "[tools]\n");

		expect(await files("/repo/game")).toEqual([
			"/repo/game/rokit.toml",
			"/repo/game/aftman.toml",
			"/repo/rokit.toml",
		]);
	});

	it("should list none when no folder has one", async () => {
		expect(await files("/repo/game")).toEqual([]);
	});

	it("should skip a file that cannot be read", async () => {
		await fs.createDirectory("/repo/game/rokit.toml");
		await fs.writeFile("/repo/foreman.toml", "[tools]\n");

		expect(await files("/repo/game")).toEqual(["/repo/foreman.toml"]);
	});
});
