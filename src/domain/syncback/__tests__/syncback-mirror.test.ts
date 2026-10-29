import { PlacedLocation } from "../../write/write-service.js";
import { RojoFile } from "../../rojo/rojo.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { SyncbackMirror } from "../syncback-mirror.js";

const ROOT = ".rogen-syncback/mirror";

const placed = (source: string, ...instancePath: string[]): PlacedLocation => ({
	status: "placed",
	source: `/repo/${source}`,
	exists: true,
	instancePath,
	route: "server",
	routeMatch: "suffix",
});

const mirrorOf = (
	written: RojoProjectFile,
	files: readonly PlacedLocation[],
	folders: readonly string[] = [],
	texts: Readonly<Record<string, string>> = {}
) =>
	SyncbackMirror.of({
		written,
		dir: "/repo",
		root: ROOT,
		placed: files,
		reads: ["/repo/src"],
		fileAt: (target) => RojoFile.at(target, SyncRules.DEFAULT),
		isFolder: async (target) => folders.includes(target),
		readText: async (target) => texts[target],
	});

const optional = (target: string) => ({ optional: target });

describe("SyncbackMirror", () => {
	it("should move a node the write made from a file into the mirror, named for its instance", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					$className: "DataModel",
					ServerScriptService: {
						Inventory: {
							$className: "Folder",
							Bag: {
								$path: optional(
									"src/Inventory/Bag@server.luau"
								),
							},
						},
					},
				},
			},
			[
				placed(
					"src/Inventory/Bag@server.luau",
					"ServerScriptService",
					"Inventory",
					"Bag"
				),
			]
		);

		expect(mirror.file.tree).toEqual({
			$className: "DataModel",
			ServerScriptService: { $path: `${ROOT}/ServerScriptService` },
		});
		expect(mirror.entries).toEqual([
			{
				mirror: "ServerScriptService/Inventory/Bag.luau",
				target: "/repo/src/Inventory/Bag@server.luau",
				kind: "file",
			},
			{
				mirror: "ServerScriptService/Inventory/Bag.meta.json",
				target: "/repo/src/Inventory/Bag@server.meta.json",
				kind: "file",
			},
		]);
		expect(mirror.folders).toEqual([
			"ServerScriptService/Inventory",
			"ServerScriptService",
		]);
	});

	it("should keep the script suffix in the mirror's name", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ServerScriptService: {
						Boot: {
							$path: optional("src/Boot@server.server.luau"),
						},
					},
				},
			},
			[
				placed(
					"src/Boot@server.server.luau",
					"ServerScriptService",
					"Boot"
				),
			]
		);

		expect(mirror.entries[0].mirror).toBe(
			"ServerScriptService/Boot.server.luau"
		);
	});

	it("should keep a node with a class of its own as a node that reads its mirror folder", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					StarterPlayer: {
						$className: "StarterPlayer",
						StarterPlayerScripts: {
							$className: "StarterPlayerScripts",
							Hud: { $path: optional("src/Hud.client.luau") },
						},
					},
				},
			},
			[
				placed(
					"src/Hud.client.luau",
					"StarterPlayer",
					"StarterPlayerScripts",
					"Hud"
				),
			]
		);

		expect(mirror.file.tree).toEqual({
			StarterPlayer: {
				$className: "StarterPlayer",
				$path: `${ROOT}/~kept/0`,
				StarterPlayerScripts: {
					$className: "StarterPlayerScripts",
					$path: `${ROOT}/StarterPlayer/StarterPlayerScripts`,
				},
			},
		});
	});

	it("should point the user's own nodes at a copy in the mirror, so Rojo writes nothing else", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ReplicatedStorage: {
						Packages: { $path: "Packages" },
						Lib: {
							$className: "Folder",
							$path: { optional: "lib/Lib.luau" },
						},
					},
				},
			},
			[],
			["/repo/Packages"]
		);

		expect(mirror.file.tree).toEqual({
			ReplicatedStorage: {
				$path: `${ROOT}/~kept/1`,
				Packages: { $path: `${ROOT}/ReplicatedStorage/Packages` },
				Lib: {
					$className: "Folder",
					$path: { optional: `${ROOT}/~kept/0/Lib.luau` },
				},
			},
		});
		expect(mirror.entries).toEqual([
			{
				mirror: "ReplicatedStorage/Packages",
				target: "/repo/Packages",
				kind: "folder",
			},
			{
				mirror: "~kept/0/Lib.luau",
				target: "/repo/lib/Lib.luau",
				kind: "file",
			},
			{
				mirror: "~kept/0/Lib.meta.json",
				target: "/repo/lib/Lib.meta.json",
				kind: "file",
			},
		]);
	});

	it("should read a node with no $path from an empty folder of its own, where Rojo writes the children Studio adds to it", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Remotes: {
							$className: "Folder",
							Hit: { $className: "RemoteEvent" },
						},
					},
				},
			},
			[]
		);

		expect(mirror.file.tree).toEqual({
			$className: "DataModel",
			ReplicatedStorage: {
				$path: `${ROOT}/~kept/2`,
				Remotes: {
					$className: "Folder",
					$path: `${ROOT}/~kept/1`,
					Hit: {
						$className: "RemoteEvent",
						$path: `${ROOT}/~kept/0`,
					},
				},
			},
		});
		expect(mirror.entries).toEqual([]);
		expect(mirror.nodeFolders).toEqual([
			{
				mirror: "~kept/0",
				node: ["ReplicatedStorage", "Remotes", "Hit"],
			},
			{ mirror: "~kept/1", node: ["ReplicatedStorage", "Remotes"] },
			{ mirror: "~kept/2", node: ["ReplicatedStorage"] },
		]);
		expect(mirror.folders).toEqual(["~kept/0", "~kept/1", "~kept/2"]);
	});

	it.each(["StringValue", "ModuleScript", "LocalizationTable"])(
		"should keep a %s node with no $path as it is, as Rojo drops the property its file would hold from a node with a $path",
		async (className) => {
			const mirror = await mirrorOf(
				{
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							$path: "vendor",
							Version: { $className: className },
						},
					},
				},
				[],
				["/repo/vendor"]
			);

			expect(mirror.file.tree.ReplicatedStorage).toEqual({
				$path: `${ROOT}/ReplicatedStorage`,
				Version: { $className: className },
			});
			expect(mirror.nodeFolders).toEqual([]);
		}
	);

	it("should name the project paths that would share a mirror path on a case-blind system", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ServerScriptService: {
						bag: { $path: optional("src/Server/bag.luau") },
						Bag: { $path: optional("src/Bag@server.luau") },
					},
				},
			},
			[
				placed("src/Server/bag.luau", "ServerScriptService", "bag"),
				placed("src/Bag@server.luau", "ServerScriptService", "Bag"),
			]
		);

		expect(mirror.clashes).toEqual([
			["/repo/src/Server/bag.luau", "/repo/src/Bag@server.luau"],
			[
				"/repo/src/Server/bag.meta.json",
				"/repo/src/Bag@server.meta.json",
			],
		]);
	});

	it("should move a folder the write mounted whole as one entry", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ServerScriptService: {
						Panel: { $path: optional("src/Panel") },
					},
				},
			},
			[
				placed(
					"src/Panel/Row.luau",
					"ServerScriptService",
					"Panel",
					"Row"
				),
			],
			["/repo/src/Panel"]
		);

		expect(mirror.entries).toEqual([
			{
				mirror: "ServerScriptService/Panel",
				target: "/repo/src/Panel",
				kind: "folder",
			},
		]);
	});

	it("should keep a plain folder as a node when a child stays, and read it from a folder no parent reads", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ServerScriptService: {
						Inventory: {
							$className: "Folder",
							Bag: {
								$path: optional(
									"src/Inventory/Bag@server.luau"
								),
							},
							Lib: { $path: "vendor/lib" },
						},
					},
				},
			},
			[
				placed(
					"src/Inventory/Bag@server.luau",
					"ServerScriptService",
					"Inventory",
					"Bag"
				),
			]
		);

		expect(mirror.file.tree).toEqual({
			ServerScriptService: {
				$path: `${ROOT}/~kept/1`,
				Inventory: {
					$className: "Folder",
					$path: `${ROOT}/ServerScriptService/Inventory`,
					Lib: { $path: `${ROOT}/~kept/0/lib` },
				},
			},
		});
	});

	it("should read a folder node that stays from a mirror folder outside the folders its parents read", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ReplicatedStorage: {
						$className: "ReplicatedStorage",
						Shared: {
							$className: "Folder",
							Util: { $path: optional("src/Util.luau") },
							Net: {
								$path: optional("src/Net"),
								Types: {
									$path: optional("src/Net/Types.luau"),
								},
							},
						},
					},
				},
			},
			[
				placed("src/Util.luau", "ReplicatedStorage", "Shared", "Util"),
				placed(
					"src/Net/Types.luau",
					"ReplicatedStorage",
					"Shared",
					"Net",
					"Types"
				),
			],
			["/repo/src/Net"]
		);

		expect(mirror.file.tree).toEqual({
			ReplicatedStorage: {
				$className: "ReplicatedStorage",
				$path: `${ROOT}/~kept/1`,
				Shared: {
					$className: "Folder",
					$path: `${ROOT}/ReplicatedStorage/Shared`,
					Net: { $path: optional(`${ROOT}/~kept/0`) },
				},
			},
		});
		expect(mirror.entries).toContainEqual({
			mirror: "~kept/0",
			target: "/repo/src/Net",
			kind: "folder",
		});
		expect(mirror.entries).toContainEqual({
			mirror: "~kept/0/Types.luau",
			target: "/repo/src/Net/Types.luau",
			kind: "file",
		});
	});

	it("should read a folder a node mounts whole from the folder of its entry, and keep what lies below it out of that folder", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ReplicatedStorage: {
						Net: {
							$path: "src/Net",
							Sub: {
								$className: "Folder",
								A: { $path: optional("src/A.luau") },
								B: { $path: "vendor/B" },
							},
						},
					},
				},
			},
			[placed("src/A.luau", "ReplicatedStorage", "Net", "Sub", "A")],
			["/repo/src/Net"]
		);

		expect(mirror.file.tree).toEqual({
			ReplicatedStorage: {
				$path: `${ROOT}/~kept/2`,
				Net: {
					$path: `${ROOT}/ReplicatedStorage/Net`,
					Sub: {
						$className: "Folder",
						$path: `${ROOT}/~kept/0`,
						B: { $path: `${ROOT}/~kept/1/B` },
					},
				},
			},
		});
	});

	it("should read a root that mounts a folder from a copy in the mirror", async () => {
		const mirror = await mirrorOf(
			{ name: "csv", tree: { $path: "src" } },
			[],
			["/repo/src"]
		);

		expect(mirror.file.tree).toEqual({ $path: `${ROOT}/~kept/0` });
		expect(mirror.entries).toEqual([
			{ mirror: "~kept/0", target: "/repo/src", kind: "folder" },
		]);
	});

	it("should read a root that mounts a file from a copy in the mirror", async () => {
		const mirror = await mirrorOf(
			{ name: "model", tree: { $path: "Model.rbxmx" } },
			[]
		);

		expect(mirror.file.tree).toEqual({
			$path: `${ROOT}/~kept/0/Model.rbxmx`,
		});
	});

	it("should refuse to make a project with a $path outside the mirror", () => {
		expect(() =>
			SyncbackMirror.assertInside(
				{ tree: { $className: "DataModel", A: { $path: "src" } } },
				ROOT
			)
		).toThrow('"src"');
	});

	it("should copy a nested project with what it reads, laid out as on disk", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Nested: { $path: "nested.project.json" },
					},
				},
			},
			[],
			["/repo/lib"],
			{
				"/repo/nested.project.json": JSON.stringify({
					name: "Nested",
					tree: {
						Value: { $path: "string_value.txt" },
						Inner: { $path: "inner/inner.project.json" },
					},
				}),
				"/repo/inner/inner.project.json": JSON.stringify({
					name: "Inner",
					tree: { $path: "../lib" },
				}),
			}
		);

		expect(mirror.file.tree).toEqual({
			$className: "DataModel",
			ReplicatedStorage: {
				$path: `${ROOT}/~kept/1`,
				Nested: { $path: `${ROOT}/~kept/0/nested.project.json` },
			},
		});
		expect(mirror.entries).toEqual(
			expect.arrayContaining([
				{
					mirror: "~kept/0/nested.project.json",
					target: "/repo/nested.project.json",
					kind: "file",
				},
				{
					mirror: "~kept/0/inner/inner.project.json",
					target: "/repo/inner/inner.project.json",
					kind: "file",
				},
				{
					mirror: "~kept/0/string_value.txt",
					target: "/repo/string_value.txt",
					kind: "file",
				},
				{ mirror: "~kept/0/lib", target: "/repo/lib", kind: "folder" },
			])
		);
	});

	it("should give the path in the project of a mirror path, and none for a new one", async () => {
		const mirror = await mirrorOf(
			{
				tree: {
					ServerScriptService: {
						Bag: { $path: optional("src/Bag@server.luau") },
						Panel: { $path: optional("src/Panel") },
					},
				},
			},
			[
				placed("src/Bag@server.luau", "ServerScriptService", "Bag"),
				placed(
					"src/Panel/Row.luau",
					"ServerScriptService",
					"Panel",
					"Row"
				),
			],
			["/repo/src/Panel"]
		);

		expect(mirror.targetOf("ServerScriptService/Bag.luau")).toBe(
			"/repo/src/Bag@server.luau"
		);
		expect(mirror.targetOf("ServerScriptService/Panel/New.luau")).toBe(
			"/repo/src/Panel/New.luau"
		);
		expect(
			mirror.targetOf("ServerScriptService/Mail.luau")
		).toBeUndefined();
	});

	it("should write each sync rule for the mirror files it matched, and leave out the legacy LocalScript rule", async () => {
		const mirror = await mirrorOf(
			{
				syncRules: [
					{
						pattern: "src/Hud.client.luau",
						use: "legacyClientScript",
					},
					{
						pattern: "src/**/*.mock.luau",
						use: "moduleScript",
						suffix: ".mock.luau",
					},
				],
				tree: {},
			},
			[]
		);

		expect(
			mirror.rulesFor(
				[
					{
						mirror: "StarterPlayer/StarterPlayerScripts/Hud.client.luau",
						target: "/repo/src/Hud.client.luau",
					},
					{
						mirror: "ServerScriptService/A.mock.luau",
						target: "/repo/src/A.mock.luau",
					},
				],
				ROOT,
				"/repo"
			)
		).toEqual([
			{
				pattern: `${ROOT}/ServerScriptService/A.mock.luau`,
				use: "moduleScript",
				suffix: ".mock.luau",
			},
		]);
		expect(mirror.file).not.toHaveProperty("syncRules");
	});
});
