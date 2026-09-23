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
			expect(workspace.outDir).toBeUndefined();
			expect(workspace.packageMounts).toEqual({});
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

	describe("package mounts", () => {
		const mkdir = (dir: string) => fs.createDirectory(path.join(cwd, dir));

		it("should mount rbxts packages and include that exist", async () => {
			await write("tsconfig.json", "{}");
			await write("node_modules/@rbxts/types/package.json");
			await write("node_modules/@flamework/core/package.json");
			await mkdir("include");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({
				ReplicatedStorage: {
					rbxts_include: {
						$path: "include",
						node_modules: {
							$className: "Folder",
							"@rbxts": { $path: "node_modules/@rbxts" },
							"@flamework": { $path: "node_modules/@flamework" },
						},
					},
				},
			});
		});

		it("should not mount include when it does not exist", async () => {
			await write("node_modules/@rbxts/types/package.json");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({
				ReplicatedStorage: {
					rbxts_include: {
						node_modules: {
							$className: "Folder",
							"@rbxts": { $path: "node_modules/@rbxts" },
						},
					},
				},
			});
		});

		it("should mount @rbxts-js and @flamework when installed", async () => {
			await write("node_modules/@rbxts-js/react/package.json");
			await write("node_modules/@flamework/core/package.json");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toMatchObject({
				ReplicatedStorage: {
					rbxts_include: {
						node_modules: {
							"@rbxts-js": { $path: "node_modules/@rbxts-js" },
							"@flamework": { $path: "node_modules/@flamework" },
						},
					},
				},
			});
		});

		it("should not mount anything for tsconfig.json alone", async () => {
			await write("tsconfig.json", "{}");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({});
		});

		it("should mount wally packages that exist", async () => {
			await write("wally.toml");
			await mkdir("Packages");
			await mkdir("ServerPackages");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({
				ReplicatedStorage: { Packages: { $path: "Packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should mount only the wally folders that exist", async () => {
			await write("wally.toml");
			await mkdir("Packages");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({
				ReplicatedStorage: { Packages: { $path: "Packages" } },
			});
		});

		it("should not mount wally packages that are not installed", async () => {
			await write("wally.toml");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({});
		});

		it("should mount pesde packages that exist", async () => {
			await write("pesde.toml");
			await mkdir("roblox_packages");
			await mkdir("roblox_server_packages");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({
				ReplicatedStorage: { Packages: { $path: "roblox_packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "roblox_server_packages" },
				},
			});
		});

		it("should not mount a package folder without its manifest", async () => {
			await mkdir("Packages");
			await mkdir("roblox_packages");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(packageMounts).toEqual({});
		});

		it("should combine mounts from several package managers under one service", async () => {
			await write("wally.toml");
			await mkdir("Packages");
			await write("node_modules/@rbxts/types/package.json");

			const { packageMounts } = await detectWorkspace(fs, cwd);

			expect(Object.keys(packageMounts)).toEqual(["ReplicatedStorage"]);
			expect(packageMounts.ReplicatedStorage).toMatchObject({
				rbxts_include: expect.anything(),
				Packages: expect.anything(),
			});
		});
	});
});
