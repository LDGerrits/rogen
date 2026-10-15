import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { SyncbackProject } from "../syncback-project.js";

const written = (): RojoProjectFile => ({
	name: "Game",
	globIgnorePaths: ["**/*.spec.luau"],
	tree: {
		$className: "DataModel",
		ServerScriptService: {
			$className: "ServerScriptService",
			Combat: {
				$className: "Folder",
				$ignoreUnknownInstances: false,
				Hit: {
					$path: { optional: "/repo/src/Combat/Server/Hit.luau" },
				},
			},
			Inventory: {
				$className: "Folder",
				Bag: {
					$path: { optional: "/repo/src/Inventory/Bag@server.luau" },
				},
			},
		},
		Workspace: { $className: "Workspace", $properties: { Gravity: 1 } },
	},
});

const inputs = {
	dir: "/repo",
	staging: ".rogen-syncback/new",
};

describe("SyncbackProject", () => {
	it("should mount a home's folder as the node, with its generated children gone", () => {
		const { file, mounted } = SyncbackProject.of({
			...inputs,
			written: written(),
			homes: [
				{
					dir: "/repo/src/Combat/Server",
					node: ["ServerScriptService", "Combat"],
				},
			],
		});

		expect(file.tree.ServerScriptService).toMatchObject({
			Combat: { $path: "src/Combat/Server" },
		});
		expect(file.tree.ServerScriptService).not.toHaveProperty("Combat.Hit");
		expect(file.tree.ServerScriptService).not.toHaveProperty(
			"Combat.$className"
		);
		expect(mounted).toEqual([["ServerScriptService", "Combat"]]);
	});

	it("should give every container that holds no folder a staging folder, numbered", () => {
		const { file, staged } = SyncbackProject.of({
			...inputs,
			written: written(),
			homes: [
				{
					dir: "/repo/src/Combat/Server",
					node: ["ServerScriptService", "Combat"],
				},
			],
		});

		expect(staged).toEqual([
			["ServerScriptService", "Inventory"],
			["ServerScriptService"],
		]);
		expect(file.tree.ServerScriptService).toMatchObject({
			$path: ".rogen-syncback/new/1",
			Inventory: { $path: ".rogen-syncback/new/0" },
		});
	});

	it("should leave a node with properties, and a name that is no safe folder name, with no staging", () => {
		const base = written();
		(base.tree.ServerScriptService as Record<string, unknown>)["a/b"] = {
			$className: "Folder",
		};

		const { file } = SyncbackProject.of({
			...inputs,
			written: base,
			homes: [],
		});

		expect(file.tree.Workspace).not.toHaveProperty("$path");
		expect(file.tree.ServerScriptService).not.toHaveProperty([
			"a/b",
			"$path",
		]);
	});

	it("should keep the globs and every other key as written", () => {
		const { file } = SyncbackProject.of({
			...inputs,
			written: written(),
			homes: [],
		});

		expect(file.name).toBe("Game");
		expect(file.globIgnorePaths).toEqual(["**/*.spec.luau"]);
	});

	it("should point the node of a file at its source when a tool wrote what it was", () => {
		const { file } = SyncbackProject.of({
			...inputs,
			written: written(),
			homes: [],
			sources: [
				{
					status: "placed",
					source: "/repo/src/Combat/Server/Hit.luau",
					exists: true,
					instancePath: ["ServerScriptService", "Combat", "Hit"],
					route: "Server",
					routeMatch: "folder",
				},
			],
		});

		expect(file.tree.ServerScriptService).toMatchObject({
			Combat: { Hit: { $path: "src/Combat/Server/Hit.luau" } },
		});
	});

	it("should not change the project it was given", () => {
		const given = written();
		SyncbackProject.of({ ...inputs, written: given, homes: [] });

		expect(given).toEqual(written());
	});
});
