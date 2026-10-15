import { PlacedLocation } from "../../build/build-service.js";
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
	folders: readonly string[] = []
) =>
	SyncbackMirror.of({
		written,
		dir: "/repo",
		root: ROOT,
		placed: files,
		reads: ["/repo/src"],
		fileAt: (target) => RojoFile.at(target, SyncRules.DEFAULT),
		isFolder: async (target) => folders.includes(target),
	});

const optional = (target: string) => ({ optional: target });

describe("SyncbackMirror", () => {
	it("should move a node the build made from a file into the mirror, named for its instance", async () => {
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

	it("should move a folder the build mounted whole as one entry", async () => {
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

	it("should keep a plain folder as a node when a child stays, reading the rest from the mirror", async () => {
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
				$path: `${ROOT}/ServerScriptService`,
				Inventory: {
					$className: "Folder",
					$path: `${ROOT}/ServerScriptService/Inventory`,
					Lib: { $path: `${ROOT}/~kept/0/lib` },
				},
			},
		});
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
