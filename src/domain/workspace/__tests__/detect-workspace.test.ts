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

	describe("toolchain", () => {
		it("should be luau when nothing is found", async () => {
			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.toolchain).toBe("luau");
			expect(workspace).toEqual({
				toolchain: "luau",
				packageDirs: new Set(),
				rbxtsScopes: [],
				hasInclude: false,
			});
		});

		it("should detect roblox-ts from tsconfig.json", async () => {
			await write("tsconfig.json", "{}");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.toolchain).toBe("roblox-ts");
		});

		it.each([".darklua.json", ".darklua.json5"])(
			"should detect darklua from %s",
			async (file) => {
				await write(file);

				const workspace = await detectWorkspace(fs, cwd);

				expect(workspace.toolchain).toBe("darklua");
				expect(workspace.outDir).toBeUndefined();
			}
		);

		it("should prefer roblox-ts when both are present", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			const workspace = await detectWorkspace(fs, cwd);

			expect(workspace.toolchain).toBe("roblox-ts");
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
