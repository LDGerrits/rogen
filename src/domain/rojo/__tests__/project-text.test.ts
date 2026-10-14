import fs from "fs";
import path from "path";
import { ProjectText } from "../project-text.js";
import { RojoNode, RojoProjectFile } from "../rojo-project.js";
import { describeWithRojo, makeRojoDir, runRojo } from "./rojo-cli.js";

const SCHEMA = "https://example.com/project.json";

describe("domain/rojo/project-text", () => {
	describe("ProjectText", () => {
		it("should write the schema first and Rojo's keys in Rojo's order", () => {
			const file = {
				globIgnorePaths: ["**/*.spec.luau"],
				emitLegacyScripts: false,
				servePort: 34873,
				tree: { $className: "DataModel" },
				name: "Game",
			} as RojoProjectFile;

			const keys = Object.keys(JSON.parse(ProjectText.of(file, SCHEMA)));

			expect(keys).toEqual([
				"$schema",
				"name",
				"tree",
				"servePort",
				"emitLegacyScripts",
				"globIgnorePaths",
			]);
		});

		it("should indent with two spaces and end without a newline", () => {
			const text = ProjectText.of(
				{ tree: { $className: "DataModel" } },
				SCHEMA
			);

			expect(text).toBe(
				`{\n  "$schema": "${SCHEMA}",\n  "tree": {\n    "$className": "DataModel"\n  }\n}`
			);
		});

		it("should leave the name out when the file has none", () => {
			const text = ProjectText.of({ tree: {} }, SCHEMA);

			expect(text).not.toContain('"name"');
		});

		it("should replace a schema the file carries", () => {
			const text = ProjectText.of(
				{ $schema: "x", tree: {} } as unknown as RojoProjectFile,
				SCHEMA
			);

			expect(text.match(/\$schema/g)).toHaveLength(1);
			expect(text).toContain(SCHEMA);
		});

		it("should write a node's keys around its children in Rojo's order", () => {
			const text = ProjectText.of(
				{
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
				},
				SCHEMA
			);

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
			const text = ProjectText.of(
				{ tree: { "9": {}, "10": {}, b: {}, a: {} } },
				SCHEMA
			);

			expect(
				[...text.matchAll(/^ {4}"([^"]+)": \{\}/gm)].map(
					([, name]) => name
				)
			).toEqual(["10", "9", "a", "b"]);
		});

		it("should write empty objects and lists on one line", () => {
			const text = ProjectText.of(
				{ tree: { Workspace: {} }, globIgnorePaths: [] },
				SCHEMA
			);

			expect(text).toContain('"Workspace": {}');
			expect(text).toContain('"globIgnorePaths": []');
		});

		it("should keep a child that is not a node, and a node key it doesn't know, as they are", () => {
			const text = ProjectText.of(
				{
					tree: {
						Odd: 1,
						$extra: true,
						$properties: "x",
					} as unknown as RojoNode,
				},
				SCHEMA
			);

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
			const text = ProjectText.of(
				{
					extra: 1,
					tree: {},
					servePort: 1,
				} as unknown as RojoProjectFile,
				SCHEMA
			);

			expect(Object.keys(JSON.parse(text))).toEqual([
				"$schema",
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
					ProjectText.of(
						{
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
						},
						SCHEMA
					)
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
