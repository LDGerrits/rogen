import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { RojoNode } from "../../rojo/rojo-project.js";
import { SyncTool } from "../build.js";
import {
	FOLDER,
	abs,
	assembleFilesOf,
	optional,
	templateOf,
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
			(await assemble(overrides)).tree.tree.ReplicatedStorage as RojoNode;

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

			it("should collapse into the sync dir", async () => {
				await write("src/Inventory/Save.ts");

				const storage = await storageOf({ syncDir: abs("dist") });

				expect(storage.Inventory).toEqual({
					$path: optional("dist/Inventory"),
				});
			});

			it("should collapse a directory holding data files, which Rojo names by stem", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Items.json"
				);

				const { tree: value, warnings } = await assemble();

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

				const { tree: value } = await assemble({
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

			it("should not collapse an active variant folder into its parent's node", async () => {
				await write("src/Combat/dev/Cheats.luau");

				const storage = await storageOf({ variants: { dev: true } });

				expect(storage.Combat).toEqual({
					...FOLDER,
					Cheats: { $path: optional("src/Combat/dev/Cheats.luau") },
				});
			});

			it("should not collapse a directory holding a skipped link, and ignore the link", async () => {
				await write("src/Real/Thing.luau");
				await fs.createSymbolicLink(abs("src"), abs("src/Real/Back"));
				await fs.createSymbolicLink(
					abs("missing"),
					abs("src/Real/Gone")
				);

				const { tree: value } = await assemble();

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

			it("should not collapse a directory with a dormant-variant file", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Analytics: {
						$path: optional("src/Inventory/Analytics.luau"),
					},
				});
			});

			it("should not collapse a directory with an excluded file", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Save.spec.luau"
				);

				const storage = await storageOf({
					exclude: [abs("**/*.spec.luau")],
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

				const { tree: value } = await assemble({
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
					rootDirs: [abs("core"), abs("mods")],
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
				await write("src/Save/Save.mock@server.luau");

				const { tree: value } = await assemble({
					variants: { mock: true },
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Save: {
						...FOLDER,
						Save: {
							$path: optional("src/Save/Save.mock@server.luau"),
						},
					},
				});
			});

			it("should not collapse a directory holding the file an active variant replaced", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const storage = await storageOf({ variants: { mock: true } });

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Analytics: {
						$path: optional("src/Inventory/Analytics.mock.luau"),
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

				const { tree: value } = await assemble({
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

				const { tree: value } = await assemble({
					exclude: [abs("**/*.d.ts")],
				});

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({ $path: optional("src/Inventory") });
				expect(value.globIgnorePaths).toBeUndefined();
			});
		});

		it("should keep out of the ignore list whatever a processor says it only reads", async () => {
			await write("src/Inventory/Save.luau", "src/Inventory/Save.proto");

			const { tree: value } = await assemble(
				{ exclude: [abs("**/*.proto")] },
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
			it("should list a pruned file as a sync path", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					variants: { mock: false },
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Inventory/Analytics.mock.luau",
				]);
			});

			it("should never list a path the template mounts, which Rojo has to read", async () => {
				await write(
					"src/Vendor/Lib.luau",
					"src/Save.luau",
					"src/Save.spec.luau"
				);

				const { tree: value } = await assemble({
					exclude: [abs("**/*.spec.luau")],
					template: {
						file: abs("template.project.json"),
						project: {
							name: "game",
							tree: {
								$className: "DataModel",
								ReplicatedStorage: {
									Vendor: { $path: "src/Vendor" },
								},
							},
						},
					},
				});

				expect(value.globIgnorePaths).toEqual(["src/Save.spec.luau"]);
			});

			it("should list excluded and pruned files in path order, translated to sync paths", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau",
					"src/Inventory/Save.spec.ts"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					variants: { mock: false },
					exclude: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Inventory/Analytics.mock.luau",
					"dist/Inventory/Save.spec.luau",
				]);
			});

			it("should list a file excluded anywhere inside an init folder, and what Rojo would read beside its script", async () => {
				await write(
					"src/Moves/init.ts",
					"src/Moves/Punch.spec.ts",
					"src/Moves/Heavy/Slam.spec.ts"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					exclude: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Moves/Heavy/Slam.spec.luau",
					"dist/Moves/Punch.spec.luau",
					"dist/Moves/Heavy",
				]);
			});

			it("should list an unrouted file", async () => {
				await write("src/Hud.ts", "src/Combat.server.ts");

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					routes: { server: "ServerScriptService" },
				});

				expect(value.globIgnorePaths).toEqual(["dist/Hud.luau"]);
			});

			it("should not list a file an active variant replaced, which shares the winner's emitted path", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const { tree: value } = await assemble({
					variants: { mock: true },
				});

				expect(value.globIgnorePaths).toBeUndefined();
			});

			it("should not list a file the template displaced, which its $path may mount", async () => {
				await write("src/Packages/A.luau", "src/Other/B.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "src/Packages" },
						},
					},
				});

				const { tree: value } = await assemble({ template });

				expect(value.globIgnorePaths).toBeUndefined();
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Other
				).toEqual({
					$path: optional("src/Other"),
				});
			});

			it("should union the template's rebased globs without duplicates", async () => {
				await write("src/Foo.luau", "src/Foo.spec.luau");
				const template = templateOf(
					{
						tree: { $className: "DataModel" },
						globIgnorePaths: [
							"**/*.spec.luau",
							"../src/Foo.spec.luau",
						],
					},
					abs("templates/base.project.json")
				);

				const { tree: value } = await assemble({
					template,
					exclude: [abs("src/Foo.spec.luau")],
				});

				expect(value.globIgnorePaths).toEqual([
					"templates/**/*.spec.luau",
					"src/Foo.spec.luau",
				]);
			});
		});
	});
});
