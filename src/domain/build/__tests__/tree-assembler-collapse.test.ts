import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { RojoNode } from "../../rojo/rojo-project.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	FOLDER,
	abs,
	assembleFilesOf,
	optional,
	writeFiles,
} from "./fixtures.js";

describe("TreeAssembler", () => {
	describe("tree", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const assemble = (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => assembleFilesOf(fs, overrides, extraTools);

		const storageOf = async (overrides: ResolvedConfigSpec = {}) =>
			(await assemble(overrides)).projectFile.tree
				.ReplicatedStorage as RojoNode;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("collapse", () => {
			it("should collapse a directory whose every file is present under Rojo's name", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Load.server.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					$path: optional("src/Inventory"),
				});
			});

			it("should collapse the outermost directory when nested ones would also qualify", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Deep/Load.luau"
				);

				const storage = await storageOf();

				expect(storage).toEqual({
					$className: "ReplicatedStorage",
					Inventory: { $path: optional("src/Inventory") },
				});
			});

			it("should collapse into the sync path", async () => {
				await write("src/Inventory/Save.ts");

				const storage = await storageOf({ syncPath: abs("dist") });

				expect(storage.Inventory).toEqual({
					$path: optional("dist/Inventory"),
				});
			});

			it("should collapse a directory holding data files, which Rojo names by stem", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Items.json"
				);

				const { projectFile: value, warnings } = await assemble();

				expect(warnings).toEqual([]);
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({ $path: optional("src/Inventory") });
			});

			it("should not collapse an invisible folder into its parent's node", async () => {
				await write("src/Inventory/(group)/Save.luau");

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: {
						$path: optional("src/Inventory/(group)/Save.luau"),
					},
				});
			});

			it("should not collapse a routing folder into its parent's node, but collapse a folder inside it", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/server/Moves/Punch.luau"
				);

				const { projectFile: value } = await assemble({
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Combat: {
						...FOLDER,
						Hit: { $path: optional("src/Combat/server/Hit.luau") },
						Moves: { $path: optional("src/Combat/server/Moves") },
					},
				});
			});

			it("should not collapse a routing folder into its route's target folder", async () => {
				await write("src/shared/Types.luau");

				const storage = await storageOf({
					routes: { shared: "ReplicatedStorage/shared" },
				});

				expect(storage.shared).toEqual({
					...FOLDER,
					Types: { $path: optional("src/shared/Types.luau") },
				});
			});

			it("should not collapse a directory with a folder in it that nothing places, so a collapsed build and an uncollapsed one agree", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Assets/.gitkeep",
					"src/Inventory/Docs/README.md"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("src/Inventory/Save.luau") },
				});
			});

			it("should collapse the folders beside an empty one that hold files", async () => {
				await write(
					"src/Inventory/Empty/.gitkeep",
					"src/Inventory/Items/Sword.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Items: { $path: optional("src/Inventory/Items") },
				});
			});

			it("should collapse a directory with an empty folder when a sync path holds what Rojo reads", async () => {
				await write(
					"src/Inventory/Save.ts",
					"src/Inventory/Assets/.gitkeep"
				);

				const storage = await storageOf({ syncPath: abs("dist") });

				expect(storage.Inventory).toEqual({
					$path: optional("dist/Inventory"),
				});
			});

			it("should not collapse a directory holding a skipped link, and ignore the link", async () => {
				await write("src/Real/Thing.luau");
				await fs.createSymbolicLink(abs("src"), abs("src/Real/Back"));
				await fs.createSymbolicLink(
					abs("missing"),
					abs("src/Real/Gone")
				);

				const { projectFile: value } = await assemble();

				expect((value.tree.ReplicatedStorage as RojoNode).Real).toEqual(
					{
						...FOLDER,
						Thing: { $path: optional("src/Real/Thing.luau") },
					}
				);
				expect(value.globIgnorePaths).toEqual([
					"src/Real/Back",
					"src/Real/Gone",
				]);
			});

			it("should not collapse a directory with an ignored file", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Save.spec.luau"
				);

				const storage = await storageOf({
					ignored: [abs("**/*.spec.luau")],
				});

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("src/Inventory/Save.luau") },
				});
			});

			it("should not collapse a directory with an unrouted file", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Hud.client.luau"
				);

				const { projectFile: value } = await assemble({
					routes: { client: "StarterPlayer/StarterPlayerScripts" },
				});

				expect(value.tree.StarterPlayer).toEqual({
					$className: "StarterPlayer",
					StarterPlayerScripts: {
						$className: "StarterPlayerScripts",
						Inventory: {
							...FOLDER,
							Hud: {
								$path: optional(
									"src/Inventory/Hud.client.luau"
								),
							},
						},
					},
				});
			});

			it("should not collapse a directory holding a file that lost its instance to another root", async () => {
				await write(
					"core/Inventory/Save.luau",
					"core/Inventory/Load.luau"
				);
				await write("mods/Inventory/Save.luau");

				const storage = await storageOf({
					sourcePaths: [abs("core"), abs("mods")],
				});

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("mods/Inventory/Save.luau") },
					Load: { $path: optional("core/Inventory/Load.luau") },
				});
			});

			it("should not collapse a directory whose instance another directory also fills", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/(group)/Inventory/Load.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("src/Inventory/Save.luau") },
					Load: {
						$path: optional("src/(group)/Inventory/Load.luau"),
					},
				});
			});

			it("should not collapse a directory holding a file Rojo would name differently, and emit it under its instance name", async () => {
				await write("src/Save/Save@server.luau");

				const { projectFile: value } = await assemble({
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Save: {
						...FOLDER,
						Save: {
							$path: optional("src/Save/Save@server.luau"),
						},
					},
				});
			});

			it("should not collapse a directory holding the file another replaced", async () => {
				await write(
					"src/Inventory/Analytics.lua",
					"src/Inventory/Analytics.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Analytics: {
						$path: optional("src/Inventory/Analytics.luau"),
					},
				});
			});

			it("should not collapse a directory whose file has an @ route suffix", async () => {
				await write("src/Types/Types@shared.luau");

				const storage = await storageOf({
					routes: { shared: "ReplicatedStorage" },
				});

				expect(storage.Types).toEqual({
					...FOLDER,
					Types: { $path: optional("src/Types/Types@shared.luau") },
				});
			});

			it("should never collapse a directory into a service", async () => {
				await write("src/server/Save.luau");

				const { projectFile: value } = await assemble({
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Save: { $path: optional("src/server/Save.luau") },
				});
			});

			it("should emit an init folder as one node pointing at the directory", async () => {
				await write(
					"src/Inventory/init.luau",
					"src/Inventory/Save.luau"
				);
				await write("src/Other.luau");

				const storage = await storageOf();

				expect(storage).toMatchObject({
					Inventory: { $path: optional("src/Inventory") },
					Other: { $path: optional("src/Other.luau") },
				});
			});

			it("should ignore .d.ts files when deciding to collapse and never list them", async () => {
				await write("src/Inventory/Save.ts", "src/Inventory/Save.d.ts");

				const { projectFile: value } = await assemble({
					ignored: [abs("**/*.d.ts")],
				});

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({ $path: optional("src/Inventory") });
				expect(value.globIgnorePaths).toBeUndefined();
			});
		});

		it("should keep out of the ignore list whatever a processor says it only reads", async () => {
			await write("src/Inventory/Save.luau", "src/Inventory/Save.proto");

			const { projectFile: value } = await assemble(
				{ ignored: [abs("**/*.proto")] },
				[
					{
						id: "protobuf",
						readsOnly: (source) => source.endsWith(".proto"),
					},
				]
			);

			expect(value.globIgnorePaths).toBeUndefined();
		});

		describe("globIgnorePaths", () => {
			it("should never list a path the tree mounts, which Rojo has to read", async () => {
				await write(
					"src/Vendor/Lib.luau",
					"src/Save.luau",
					"src/Save.spec.luau"
				);

				const { projectFile: value } = await assemble({
					ignored: [abs("**/*.spec.luau")],
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Vendor: { $path: "src/Vendor" },
							},
						},
					},
				});

				expect(value.globIgnorePaths).toEqual(["src/Save.spec.luau"]);
			});

			it("should list ignored files in path order, translated to sync paths", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Save.spec.ts",
					"src/Inventory/Alpha.spec.ts"
				);

				const { projectFile: value } = await assemble({
					syncPath: abs("dist"),
					ignored: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Inventory/Alpha.spec.luau",
					"dist/Inventory/Save.spec.luau",
				]);
			});

			it("should list a file ignored anywhere inside an init folder, and what Rojo would read beside its script", async () => {
				await write(
					"src/Moves/init.ts",
					"src/Moves/Punch.spec.ts",
					"src/Moves/Heavy/Slam.spec.ts"
				);

				const { projectFile: value } = await assemble({
					syncPath: abs("dist"),
					ignored: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Moves/Heavy/Slam.spec.luau",
					"dist/Moves/Punch.spec.luau",
					"dist/Moves/Heavy",
				]);
			});

			it("should list an unrouted file", async () => {
				await write("src/Hud.ts", "src/Combat.server.ts");

				const { projectFile: value } = await assemble({
					syncPath: abs("dist"),
					routes: { server: "ServerScriptService" },
				});

				expect(value.globIgnorePaths).toEqual(["dist/Hud.luau"]);
			});

			it("should not list a file another replaced, which shares the winner's emitted path", async () => {
				await write("src/Analytics.luau", "src/Analytics.ts");

				const { projectFile: value } = await assemble({
					syncPath: abs("dist"),
				});

				expect(value.globIgnorePaths).toBeUndefined();
			});

			it("should not list a file the tree displaced, which its $path may mount", async () => {
				await write("src/Packages/A.luau", "src/Other/B.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "src/Packages" },
						},
					},
				};

				const { projectFile: value } = await assemble({ project });

				expect(value.globIgnorePaths).toBeUndefined();
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Other
				).toEqual({
					$path: optional("src/Other"),
				});
			});

			it("should union the tree's globs with the ignored files without duplicates", async () => {
				await write("src/Foo.luau", "src/Foo.spec.luau");
				const project = {
					tree: { $className: "DataModel" },
					globIgnorePaths: ["**/*.spec.luau", "src/Foo.spec.luau"],
				};

				const { projectFile: value } = await assemble({
					project,
					ignored: [abs("src/Foo.spec.luau")],
				});

				expect(value.globIgnorePaths).toEqual([
					"**/*.spec.luau",
					"src/Foo.spec.luau",
				]);
			});
		});
	});
});
