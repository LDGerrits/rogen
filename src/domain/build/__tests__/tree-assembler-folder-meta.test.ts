import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { RojoNode } from "../../rojo/rojo-project.js";
import { SyncTool } from "../build.js";
import {
	FOLDER,
	abs,
	assembleFilesOf,
	assembleResultOf,
	optional,
	templateOf,
	writeFiles,
} from "./fixtures.js";

describe("TreeAssembler", () => {
	describe("tree", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const assembleResult = (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => assembleResultOf(fs, overrides, extraTools);

		const assemble = (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => assembleFilesOf(fs, overrides, extraTools);

		const storageOf = async (overrides: ResolvedConfigSpec = {}) =>
			(await assemble(overrides)).tree.tree.ReplicatedStorage as RojoNode;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("folder meta", () => {
			const SPLIT = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			};

			const writeMeta = (file: string, meta: Record<string, unknown>) =>
				fs.writeFile(abs(file), JSON.stringify(meta));

			const nodeAt = (tree: RojoNode, ...segments: string[]) =>
				segments.reduce(
					(node, segment) => node[segment] as RojoNode,
					tree
				);

			it("should copy a split folder's meta onto the node in each service", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
				});

				expect(warnings).toEqual([]);
				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Hit: { $path: optional("src/Combat/server/Hit.luau") },
				});
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					)
				).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Aim: { $path: optional("src/Combat/client/Aim.luau") },
				});
			});

			it("should copy nothing onto a collapsed folder or a folder inside it, which Rojo reads itself", async () => {
				await write("src/Bots/Body.luau", "src/Bots/Brain/Think.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("src/Bots/Brain/init.meta.json", {
					className: "Configuration",
				});

				const storage = await storageOf();

				expect(storage.Bots).toEqual({ $path: optional("src/Bots") });
			});

			it("should copy the meta onto a folder a pruned file keeps from collapsing", async () => {
				await write("src/Bots/Body.luau", "src/Bots/Http.mock.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Bots).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Body: { $path: optional("src/Bots/Body.luau") },
				});
			});

			it("should copy nothing onto an init folder", async () => {
				await write("src/Bots/init.luau", "src/Other.server.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ routes: SPLIT });

				expect(storage.Bots).toEqual({ $path: optional("src/Bots") });
			});

			it("should copy nothing onto a node whose $path is a script, and warn with the fix", async () => {
				await write(
					"src/Combat.server.luau",
					"src/Combat/Hit.server.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$path: optional("src/Combat.server.luau"),
					Hit: { $path: optional("src/Combat/Hit.server.luau") },
				});
				expect(warnings).toMatchObject([
					{
						code: "meta.sharedWithScript",
						resource: abs("src/Combat/init.meta.json"),
					},
				]);
				expect(warnings[0].message).toContain("Combat.meta.json");
			});

			it("should name the init folder's own meta when a folder shares its instance with one", async () => {
				await write(
					"src/Combat/Hit.server.luau",
					"src/server/Combat/init.server.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { warnings } = await assemble({ routes: SPLIT });

				expect(warnings).toMatchObject([
					{ code: "meta.sharedWithScript" },
				]);
				expect(warnings[0].message).toContain(
					`${toPosix(abs("src/server/Combat"))}/init.meta.json`
				);
				expect(warnings[0].message).not.toContain("beside the script");
			});

			it("should let the template's $id win without counting the meta's", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							$className: "ServerScriptService",
							Combat: { $className: "Folder", $id: "server" },
						},
					},
				});

				const { tree: value } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat").$id
				).toBe("server");
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					).$id
				).toBe("combat");
			});

			it("should copy nothing from a folder whose files were all pruned", async () => {
				await write("src/Mocks/Http.mock.luau", "src/A.luau");
				await writeMeta("src/Mocks/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Mocks).toBeUndefined();
			});

			it("should copy nothing from a folder whose files lost their instances to a later root dir", async () => {
				await write(
					"core/Combat/server/A.luau",
					"lobby/Combat/server/A.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					...FOLDER,
					A: { $path: optional("lobby/Combat/server/A.luau") },
				});
			});

			it("should copy an id that reaches one node as $id", async () => {
				await write("src/Combat/server/Hit.luau");
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });

				const { tree: value } = await assemble({ routes: SPLIT });

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$id: "combat",
				});
			});

			it("should fail when an id reaches several nodes", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });

				const result = await assembleResult({ routes: SPLIT });

				expect(
					result.isErr() ? result.error.diagnostics : []
				).toMatchObject([
					{
						code: "meta.idOnSeveralNodes",
						resource: abs("src/Combat/init.meta.json"),
					},
				]);
			});

			it("should copy every field, letting the meta's ignoreUnknownInstances replace the container's", async () => {
				await write("src/Combat/server/Hit.luau");
				await writeMeta("src/Combat/init.meta.json", {
					$schema: "https://example.com/meta.json",
					className: "Actor",
					properties: { Archivable: false },
					attributes: { Priority: 1 },
					ignoreUnknownInstances: true,
				});

				const { tree: value } = await assemble({ routes: SPLIT });

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$className: "Actor",
					$properties: { Archivable: false },
					$attributes: { Priority: 1 },
					$ignoreUnknownInstances: true,
					Hit: { $path: optional("src/Combat/server/Hit.luau") },
				});
			});

			it("should let the last root dir with a meta win each node", async () => {
				await write(
					"core/Combat/server/A.luau",
					"core/Combat/client/B.luau",
					"lobby/Combat/server/C.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("lobby/Combat/init.meta.json", {
					attributes: { Lobby: true },
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$className: "Folder",
					$attributes: { Lobby: true },
				});
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					)
				).toMatchObject({ $className: "Actor" });
			});

			it("should keep an earlier root dir's meta when a later folder has none", async () => {
				await write(
					"core/Combat/server/A.luau",
					"lobby/Combat/server/C.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$className: "Actor",
				});
			});

			it("should fail when two metas in one root dir reach one node, naming both", async () => {
				await write(
					"src/server/Combat/A.luau",
					"src/Combat/B.server.luau"
				);
				await writeMeta("src/server/Combat/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const result = await assembleResult({ routes: SPLIT });

				const errors = result.isErr() ? result.error.diagnostics : [];
				expect(errors).toMatchObject([{ code: "meta.sameNode" }]);
				expect(errors[0].message).toContain(
					abs("src/Combat/init.meta.json")
				);
				expect(errors[0].message).toContain(
					abs("src/server/Combat/init.meta.json")
				);
			});

			it("should let the template's fields win on its container, merging properties", async () => {
				await write("src/Gui/client/Hud.luau");
				await writeMeta("src/Gui/init.meta.json", {
					className: "ScreenGui",
					properties: { Enabled: false, ResetOnSpawn: false },
					attributes: { FromMeta: true },
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						StarterPlayer: {
							$className: "StarterPlayer",
							StarterPlayerScripts: {
								$className: "StarterPlayerScripts",
								Gui: {
									$className: "Folder",
									$properties: { Enabled: true },
									$attributes: { FromTemplate: true },
								},
							},
						},
					},
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Gui"
					)
				).toEqual({
					$className: "Folder",
					$properties: { Enabled: true, ResetOnSpawn: false },
					$attributes: { FromTemplate: true },
					Hud: { $path: optional("src/Gui/client/Hud.luau") },
				});
				expect(warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "meta.templateClass",
						resource: abs("src/Gui/init.meta.json"),
						message:
							'the template makes "StarterPlayer/StarterPlayerScripts/Gui" a Folder, so its class is kept over this meta\'s ScreenGui.',
					},
				]);
			});

			it("should not warn about a class the template and the meta agree on", async () => {
				await write("src/Gui/client/Hud.luau");
				await writeMeta("src/Gui/init.meta.json", {
					className: "ScreenGui",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						StarterPlayer: {
							$className: "StarterPlayer",
							StarterPlayerScripts: {
								$className: "StarterPlayerScripts",
								Gui: { $className: "ScreenGui" },
							},
						},
					},
				});

				const { warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(warnings).toEqual([]);
			});

			it("should leave a folder under a template $path out, meta and all", async () => {
				await write("src/Packages/server/A.luau");
				await writeMeta("src/Packages/init.meta.json", {
					className: "Actor",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							Packages: { $path: "Packages" },
						},
					},
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Packages")
				).toEqual({ $path: "Packages" });
				expect(warnings).toMatchObject([
					{
						code: "tree.templateClash",
						resource: abs("src/Packages"),
					},
					{
						code: "meta.templatePath",
						resource: abs("src/Packages/init.meta.json"),
					},
				]);
			});

			it("should still copy meta onto a template node when the template displaced a file in the folder", async () => {
				await write("src/Combat/Save.luau");
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Combat: { Save: { $path: "hand/Save.luau" } },
						},
					},
				});

				const { tree: value } = await assemble({ template });

				expect(
					nodeAt(value.tree, "ReplicatedStorage", "Combat")
				).toEqual({
					$className: "Actor",
					Save: { $path: "hand/Save.luau" },
				});
			});

			it("should warn at each meta in a routing, variant or invisible folder or a root dir", async () => {
				await write(
					"src/Combat/server/A.luau",
					"src/Combat/dev/B.luau",
					"src/Combat/(group)/C.luau"
				);
				for (const dir of [
					"src",
					"src/Combat/server",
					"src/Combat/dev",
					"src/Combat/(group)",
				])
					await writeMeta(`${dir}/init.meta.json`, {
						className: "Actor",
					});

				const { warnings } = await assemble({
					routes: SPLIT,
					variants: { dev: true },
				});

				const nothing = (dir: string, kind: string) => ({
					code: "meta.appliesToNothing",
					resource: abs(`${dir}/init.meta.json`),
					message: `applies to nothing, because ${kind} never becomes an instance. Move the meta into the folder that should get it.`,
				});
				expect(warnings).toMatchObject([
					nothing("src/Combat/(group)", "an invisible folder"),
					nothing("src/Combat/dev", "a variant folder"),
					nothing("src/Combat/server", "a routing folder"),
					nothing("src", "a root dir"),
				]);
			});

			it("should collapse a routing folder an outer route outranks and a Name@key folder, so Rojo applies their meta", async () => {
				await write(
					"src/server/client/A.luau",
					"src/Queue@server/B.luau"
				);
				for (const dir of ["src/server/client", "src/Queue@server"])
					await writeMeta(`${dir}/init.meta.json`, {
						className: "Actor",
					});

				const { warnings, tree: value } = await assemble({
					routes: SPLIT,
				});

				expect(warnings).toEqual([]);
				expect(
					nodeAt(value.tree, "ServerScriptService", "client")
				).toEqual({ $path: optional("src/server/client") });
				expect(
					nodeAt(value.tree, "ServerScriptService", "Queue")
				).toEqual({ $path: optional("src/Queue@server") });
			});

			it("should warn about the name, not the meta, of a folder whose files were all pruned", async () => {
				await write("src/Mocks/Http.mock.luau");
				await writeMeta("src/Mocks/init.meta.json", {
					className: "Actor",
				});

				const { warnings } = await assemble({
					variants: { mock: false },
				});

				expect(warnings.map(({ code }) => code)).toEqual([
					"variant.typo",
				]);
			});
		});
	});
});
