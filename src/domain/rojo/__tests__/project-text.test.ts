import fs from "fs";
import path from "path";
import { ProjectText } from "../project-text.js";
import { RojoNode, RojoProjectFile } from "../rojo-project.js";
import { describeWithRojo, makeRojoDir, runRojo } from "./rojo-cli.js";

describe("domain/rojo/project-text", () => {
	describe("ProjectText", () => {
		it("should write Rojo's keys in Rojo's order", () => {
			const file = {
				globIgnorePaths: ["**/*.spec.luau"],
				emitLegacyScripts: false,
				servePort: 34873,
				tree: { $className: "DataModel" },
				name: "Game",
			} as RojoProjectFile;

			const keys = Object.keys(JSON.parse(ProjectText.of(file)));

			expect(keys).toEqual([
				"name",
				"tree",
				"servePort",
				"emitLegacyScripts",
				"globIgnorePaths",
			]);
		});

		describe("ofConfig", () => {
			const ROGEN = ["sourcePaths", "routes", "projects"];

			const keysOf = (text: string) => Object.keys(JSON.parse(text));

			it("should write Rojo's keys first, then Rogen's in the order given, then any other", () => {
				const text = ProjectText.ofConfig(
					{
						other: 1,
						projects: {},
						routes: {},
						globIgnorePaths: [],
						sourcePaths: ["src"],
						tree: {},
						$schema: "s",
					},
					ROGEN
				);

				expect(keysOf(text)).toEqual([
					"$schema",
					"tree",
					"globIgnorePaths",
					"sourcePaths",
					"routes",
					"projects",
					"other",
				]);
			});

			it("should order each project the same way, without nesting projects", () => {
				const text = ProjectText.ofConfig(
					{
						projects: {
							release: {
								routes: { "*": "ReplicatedStorage" },
								globIgnorePaths: [],
								sourcePaths: ["src"],
								name: "Release",
							},
						},
					},
					ROGEN
				);

				expect(
					keysOf(JSON.stringify(JSON.parse(text).projects.release))
				).toEqual(["name", "globIgnorePaths", "sourcePaths", "routes"]);
			});

			it("should sort the children of the tree and of a project's tree, and leave null where a project removes a node", () => {
				const text = ProjectText.ofConfig(
					{
						tree: {
							b: { $className: "Folder" },
							a: { $className: "Folder" },
						},
						projects: {
							release: {
								tree: { z: null, y: { $className: "Folder" } },
							},
						},
					},
					ROGEN
				);

				const parsed = JSON.parse(text);
				expect(Object.keys(parsed.tree)).toEqual(["a", "b"]);
				expect(Object.keys(parsed.projects.release.tree)).toEqual([
					"y",
					"z",
				]);
				expect(parsed.projects.release.tree.z).toBeNull();
			});

			it("should leave the order of routes and the values of Rogen's keys as they are", () => {
				const text = ProjectText.ofConfig(
					{ routes: { server: "A", "*": "B", client: "C" } },
					ROGEN
				);

				expect(Object.keys(JSON.parse(text).routes)).toEqual([
					"server",
					"*",
					"client",
				]);
			});

			it("should write the same text as a project file when there are no Rogen keys", () => {
				const file = {
					name: "Game",
					tree: { $className: "DataModel" },
					servePort: 1,
				} as RojoProjectFile;

				expect(ProjectText.ofConfig({ ...file }, ROGEN)).toBe(
					ProjectText.of(file)
				);
			});
		});

		it("should indent with two spaces and end without a newline", () => {
			const text = ProjectText.of({ tree: { $className: "DataModel" } });

			expect(text).toBe(
				`{\n  "tree": {\n    "$className": "DataModel"\n  }\n}`
			);
		});

		it("should leave the name out when the file has none", () => {
			const text = ProjectText.of({ tree: {} });

			expect(text).not.toContain('"name"');
		});

		it("should write a node's keys around its children in Rojo's order", () => {
			const text = ProjectText.of({
				tree: {
					$path: "src",
					$ignoreUnknownInstances: false,
					$attributes: { B: 1, A: 2 },
					$properties: { Name: "x" },
					Zeta: {},
					$className: "Folder",
					Alpha: {},
					$id: "id",
				},
			});

			expect(Object.keys(JSON.parse(text).tree)).toEqual([
				"$className",
				"$id",
				"Alpha",
				"Zeta",
				"$properties",
				"$attributes",
				"$ignoreUnknownInstances",
				"$path",
			]);
			expect(Object.keys(JSON.parse(text).tree.$attributes)).toEqual([
				"A",
				"B",
			]);
		});

		it("should sort children as text, so 10 comes before 9", () => {
			const text = ProjectText.of({
				tree: { "9": {}, "10": {}, b: {}, a: {} },
			});

			expect(
				[...text.matchAll(/^ {4}"([^"]+)": \{\}/gm)].map(
					([, name]) => name
				)
			).toEqual(["10", "9", "a", "b"]);
		});

		it("should write empty objects and lists on one line", () => {
			const text = ProjectText.of({
				tree: { Workspace: {} },
				globIgnorePaths: [],
			});

			expect(text).toContain('"Workspace": {}');
			expect(text).toContain('"globIgnorePaths": []');
		});

		it("should keep a child that is not a node, and a node key it doesn't know, as they are", () => {
			const text = ProjectText.of({
				tree: {
					Odd: 1,
					$extra: true,
					$properties: "x",
				} as unknown as RojoNode,
			});

			expect(JSON.parse(text).tree).toEqual({
				Odd: 1,
				$properties: "x",
				$extra: true,
			});
			expect(Object.keys(JSON.parse(text).tree)).toEqual([
				"Odd",
				"$properties",
				"$extra",
			]);
		});

		it("should keep a key Rojo doesn't know after the ones it does", () => {
			const text = ProjectText.of({
				extra: 1,
				tree: {},
				servePort: 1,
			} as unknown as RojoProjectFile);

			expect(Object.keys(JSON.parse(text))).toEqual([
				"tree",
				"servePort",
				"extra",
			]);
		});
	});

	describeWithRojo("against rojo fmt-project", () => {
		it("should write what fmt-project would leave unchanged", () => {
			const dir = makeRojoDir("rogen-fmt-");
			try {
				const file = path.join(dir, "default.project.json");
				fs.writeFileSync(
					file,
					ProjectText.of({
						name: "Game",
						tree: {
							Workspace: { $className: "Workspace" },
							$className: "DataModel",
							ReplicatedStorage: {
								$path: { optional: "src" },
								$className: "ReplicatedStorage",
								Packages: { $path: "Packages" },
							},
							ServerScriptService: {
								$path: "server",
							},
							"10": { $className: "Folder" },
							"9": { $className: "Folder" },
						},
						servePort: 34873,
						emitLegacyScripts: false,
						globIgnorePaths: ["**/*.spec.luau"],
					})
				);
				const before = fs.readFileSync(file, "utf8");

				runRojo(dir, ["fmt-project"]);

				expect(fs.readFileSync(file, "utf8")).toBe(before);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
