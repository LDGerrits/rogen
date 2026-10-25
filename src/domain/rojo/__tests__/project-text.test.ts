import fs from "fs";
import path from "path";
import { parseJsonc } from "../../../base/jsonc.js";
import { ProjectText, WrittenTree } from "../project-text.js";
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

		describe("numbers", () => {
			const propertiesOf = (properties: Record<string, unknown>) =>
				ProjectText.of({
					tree: { $className: "Folder", $properties: properties },
				} as RojoProjectFile)
					.replace(/\s+/g, "")
					.replace(/^.*"\$properties":/, "")
					.replace(/\}\}$/, "");

			it.each([
				[{ P: 65 }, '{"P":65.0}'],
				[{ P: [1, 0.5, 3] }, '{"P":[1.0,0.5,3.0]}'],
				[
					{ P: { Vector3: [1, 2, 3] } },
					'{"P":{"Vector3":[1.0,2.0,3.0]}}',
				],
				[{ P: { Int32: 1 } }, '{"P":{"Int32":1}}'],
				[{ P: { Enum: 3 } }, '{"P":{"Enum":3}}'],
				[{ P: { BrickColor: 1 } }, '{"P":{"BrickColor":1}}'],
				[
					{ P: { Color3uint8: [255, 0, 0] } },
					'{"P":{"Color3uint8":[255,0,0]}}',
				],
				[
					{ P: { Vector3int16: [1, 2, 3] } },
					'{"P":{"Vector3int16":[1,2,3]}}',
				],
				[{ P: { UDim: [1, 1] } }, '{"P":{"UDim":[1.0,1]}}'],
				[
					{
						P: {
							UDim2: [
								[1, 1],
								[0, 2],
							],
						},
					},
					'{"P":{"UDim2":[[1.0,1],[0.0,2]]}}',
				],
				[
					{
						P: {
							Rect: [
								[0, 0],
								[1, 1],
							],
						},
					},
					'{"P":{"Rect":[[0.0,0.0],[1.0,1.0]]}}',
				],
				[
					{ P: { Float32: 0.123456789 } },
					'{"P":{"Float32":0.12345679}}',
				],
				[
					{ P: { Float64: 0.123456789 } },
					'{"P":{"Float64":0.123456789}}',
				],
				[{ P: { Float32: 0.1 } }, '{"P":{"Float32":0.1}}'],
				[
					{ P: { Vector3: [1e10, 0.1, 1] } },
					'{"P":{"Vector3":[10000000000.0,0.1,1.0]}}',
				],
				[{ P: { Float64: 1e16 } }, '{"P":{"Float64":1e16}}'],
				[
					{ P: { Float64: 1e15 } },
					'{"P":{"Float64":1000000000000000.0}}',
				],
				[{ P: { Float64: 0.00001 } }, '{"P":{"Float64":0.00001}}'],
				[{ P: { Float64: 1e-6 } }, '{"P":{"Float64":1e-6}}'],
				[{ P: { Float32: 1e13 } }, '{"P":{"Float32":1e13}}'],
				[{ P: { Float32: 1e12 } }, '{"P":{"Float32":1000000000000.0}}'],
				[{ P: { Float32: 1e-6 } }, '{"P":{"Float32":0.000001}}'],
				[{ P: { Float32: 1e-7 } }, '{"P":{"Float32":1e-7}}'],
				[{ P: { Float64: -0 } }, '{"P":{"Float64":-0.0}}'],
				[{ P: "Voxel" }, '{"P":"Voxel"}'],
				[{ P: true }, '{"P":true}'],
			])("should write %j as %s", (properties, expected) => {
				expect(propertiesOf(properties)).toBe(expected);
			});

			it("should write the parts of a CFrame, a sequence and a ray as floats, in Rojo's order", () => {
				expect(
					propertiesOf({
						C: {
							CFrame: {
								orientation: [
									[1, 0, 0],
									[0, 1, 0],
									[0, 0, 1],
								],
								position: [1, 2, 3],
							},
						},
						N: {
							NumberSequence: {
								keypoints: [{ envelope: 0, value: 1, time: 0 }],
							},
						},
						R: { Ray: { direction: [0, 0, 1], origin: [0, 0, 0] } },
						S: {
							ColorSequence: {
								keypoints: [{ color: [1, 1, 1], time: 1 }],
							},
						},
					})
				).toBe(
					'{"C":{"CFrame":{"position":[1.0,2.0,3.0],"orientation":[[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0]]}},' +
						'"N":{"NumberSequence":{"keypoints":[{"time":0.0,"value":1.0,"envelope":0.0}]}},' +
						'"R":{"Ray":{"origin":[0.0,0.0,0.0],"direction":[0.0,0.0,1.0]}},' +
						'"S":{"ColorSequence":{"keypoints":[{"time":1.0,"color":[1.0,1.0,1.0]}]}}}'
				);
			});

			it("should give a Font the cachedFaceId Rojo adds, and keep one it has", () => {
				expect(
					propertiesOf({
						A: {
							Font: {
								style: "Normal",
								weight: "Regular",
								family: "f",
							},
						},
						B: {
							Font: {
								family: "f",
								weight: "Bold",
								style: "Italic",
								cachedFaceId: "rbxassetid://5",
							},
						},
					})
				).toBe(
					'{"A":{"Font":{"family":"f","weight":"Regular","style":"Normal","cachedFaceId":null}},' +
						'"B":{"Font":{"family":"f","weight":"Bold","style":"Italic","cachedFaceId":"rbxassetid://5"}}}'
				);
			});

			it("should type the values of an Attributes property, sorted by name", () => {
				expect(
					propertiesOf({
						Attributes: {
							Vector: { Vector3: [4, 5, 6] },
							Hey: { String: "Grandma" },
						},
					})
				).toBe(
					'{"Attributes":{"Hey":{"String":"Grandma"},"Vector":{"Vector3":[4.0,5.0,6.0]}}}'
				);
			});

			it("should write attributes the same way", () => {
				const text = ProjectText.of({
					tree: {
						$className: "Folder",
						$attributes: {
							Count: 1,
							Typed: { Float32: 0 },
							Name: "x",
						},
					},
				} as RojoProjectFile).replace(/\s+/g, "");

				expect(text).toContain(
					'"$attributes":{"Count":1.0,"Name":"x","Typed":{"Float32":0.0}}'
				);
			});

			it("should not take the name of an Object method for a type", () => {
				expect(propertiesOf({ P: { constructor: 1 } })).toBe(
					'{"P":{"constructor":1}}'
				);
			});

			it("should leave a value of a type it doesn't know as it is", () => {
				expect(propertiesOf({ P: { Mystery: [1, 2] } })).toBe(
					'{"P":{"Mystery":[1,2]}}'
				);
			});
		});

		describe("sync rules", () => {
			it("should write a sync rule's keys in Rojo's order", () => {
				const text = ProjectText.of({
					tree: { $className: "Folder" },
					syncRules: [
						{
							suffix: ".s.luau",
							use: "text",
							exclude: "*.x",
							pattern: "*.t",
						},
					],
				} as RojoProjectFile);

				expect(
					Object.keys(JSON.parse(text).syncRules[0] as object)
				).toEqual(["pattern", "exclude", "use", "suffix"]);
			});

			it("should write syncbackRules in Rojo's order, and the classes of ignoreProperties sorted", () => {
				const text = ProjectText.of({
					tree: { $className: "Folder" },
					syncbackRules: {
						ignoreReferents: true,
						syncUnscriptable: false,
						syncCurrentCamera: true,
						ignoreProperties: { Part: ["Z", "A"], Base: ["Q"] },
						ignorePaths: ["b", "a"],
						ignoreTrees: ["x"],
					},
				} as RojoProjectFile);

				const rules = JSON.parse(text).syncbackRules as Record<
					string,
					unknown
				>;
				expect(Object.keys(rules)).toEqual([
					"ignoreTrees",
					"ignorePaths",
					"ignoreProperties",
					"syncCurrentCamera",
					"syncUnscriptable",
					"ignoreReferents",
				]);
				expect(Object.keys(rules.ignoreProperties as object)).toEqual([
					"Base",
					"Part",
				]);
				expect(
					(rules.ignoreProperties as Record<string, string[]>).Part
				).toEqual(["Z", "A"]);
			});
		});

		describe("ofConfig", () => {
			const ROGEN = ["sourcePaths", "routes", "compiledPath"];

			const keysOf = (text: string) => Object.keys(JSON.parse(text));

			it("should write Rojo's keys first, then the given keys in their order, then any other", () => {
				const text = ProjectText.ofConfig(
					{
						other: 1,
						compiledPath: "out",
						routes: {},
						sourcePaths: ["src"],
						globIgnorePaths: [],
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
					"compiledPath",
					"other",
				]);
			});

			it("should sort the children of the tree", () => {
				const text = ProjectText.ofConfig(
					{
						tree: {
							b: { $className: "Folder" },
							a: { $className: "Folder" },
						},
					},
					ROGEN
				);

				expect(Object.keys(JSON.parse(text).tree)).toEqual(["a", "b"]);
			});

			it("should leave the order of routes and the values of Rogen's keys as they are", () => {
				const text = ProjectText.ofConfig(
					{
						routes: { server: "A", "*": "B", client: "C" },
					},
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
						syncRules: [
							{
								pattern: "*.t",
								exclude: "*.x",
								use: "text",
								suffix: ".s",
							},
						],
						syncbackRules: {
							ignoreTrees: ["x"],
							ignorePaths: ["p", "a"],
							ignoreProperties: { Base: ["Q"], Part: ["Z", "A"] },
							syncCurrentCamera: true,
							syncUnscriptable: false,
							ignoreReferents: true,
						},
					} as RojoProjectFile)
				);
				const before = fs.readFileSync(file, "utf8");

				runRojo(dir, ["fmt-project"]);

				expect(fs.readFileSync(file, "utf8")).toBe(before);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it("should write the numbers of properties and attributes as fmt-project does", () => {
			const properties: Record<string, unknown> = {
				Bare: 65,
				BareFloat: 1.5,
				BareList: [1, 2, 3],
				BareHuge: 1e21,
				BareSmall: 1e-7,
				BareText: "Voxel",
				Axes: { Axes: ["X", "Y"] },
				Bool: { Bool: true },
				BrickColor: { BrickColor: 1 },
				CFrame: {
					CFrame: {
						position: [1, 2, 3],
						orientation: [
							[1, 0, 0],
							[0, 1, 0],
							[0, 0, 1],
						],
					},
				},
				Color3: { Color3: [1, 0.25, 0] },
				Color3uint8: { Color3uint8: [255, 0, 0] },
				ColorSequence: {
					ColorSequence: {
						keypoints: [{ time: 0, color: [1, 1, 1] }],
					},
				},
				Enum: { Enum: 1 },
				Float32: { Float32: 0.123456789 },
				Float32Big: { Float32: 1e13 },
				Float32Small: { Float32: 1e-7 },
				Float64: { Float64: 0.1 },
				Float64Big: { Float64: 123456789012345680 },
				Float64Whole: { Float64: 1e15 },
				Font: {
					Font: {
						family: "rbxasset://f.json",
						weight: "Bold",
						style: "Normal",
					},
				},
				Int32: { Int32: 1 },
				Int64: { Int64: 1 },
				NumberRange: { NumberRange: [0, 1] },
				NumberSequence: {
					NumberSequence: {
						keypoints: [{ time: 0, value: 1, envelope: 0 }],
					},
				},
				Ray: { Ray: { origin: [0, 0, 0], direction: [0, 0, 1] } },
				Rect: {
					Rect: [
						[0, 0],
						[1, 1],
					],
				},
				Region3: {
					Region3: [
						[0, 0, 0],
						[1, 1, 1],
					],
				},
				Region3int16: {
					Region3int16: [
						[0, 0, 0],
						[1, 1, 1],
					],
				},
				Tags: { Tags: ["a"] },
				UDim: { UDim: [0.5, 3] },
				UDim2: {
					UDim2: [
						[1, 1],
						[0.5, 2],
					],
				},
				Vector2: { Vector2: [1, 1] },
				Vector2int16: { Vector2int16: [1, 1] },
				Vector3: { Vector3: [1, 0.1, 1e10] },
				Vector3int16: { Vector3int16: [1, 1, 1] },
				Attributes: {
					Vector: { Vector3: [4, 5, 6] },
					Hey: { String: "Grandma" },
				},
			};
			const dir = makeRojoDir("rogen-fmt-numbers-");
			try {
				const file = path.join(dir, "default.project.json");
				const project = {
					name: "Game",
					tree: {
						$className: "Folder",
						$properties: properties,
						$attributes: {
							Count: 1,
							Fraction: 0.5,
							Name: "x",
							Typed: { Float32: 0 },
							Udim: { UDim: [0, 0] },
						},
					},
				};
				fs.writeFileSync(file, JSON.stringify(project));

				const ran = runRojo(dir, ["fmt-project"]);
				expect(ran.stderr).toBe("");

				expect(ProjectText.of(project as RojoProjectFile)).toBe(
					fs.readFileSync(file, "utf8")
				);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	describe("WrittenTree", () => {
		const source = [
			"{",
			'\t"name": "game",',
			'\t"tree": {',
			'\t\t"$className": "DataModel",',
			"\t\t// the sky",
			'\t\t"Workspace": {',
			'\t\t\t"$properties": { "Gravity": 50, },',
			'\t\t\t"Baseplate": { "$className": "Part", "$properties": { "Size": [512, 20, 512] } }',
			"\t\t},",
			'\t\t"Lighting": { "$properties": { "Brightness": 2 } }',
			"\t}",
			"}",
			"",
		].join("\n");
		const textOf = (tree: unknown) =>
			ProjectText.ofConfig(
				{ name: "game", tree },
				[],
				WrittenTree.of(source)
			);

		it("should print an unchanged tree as it was written, but for the indentation", () => {
			const tree = (parseJsonc(source).value as { tree: unknown }).tree;

			const text = textOf(tree);

			expect(text).toContain('"Gravity": 50, }');
			expect(text).toContain('"Size": [512, 20, 512]');
			expect(text).toContain("// the sky");
			expect(text).not.toContain("\t");
			expect(text).not.toContain("50.0");
		});

		it("should keep the order of the keys, and only print what changed afresh", () => {
			const tree = {
				$className: "DataModel",
				Workspace: {
					$properties: { Gravity: 50 },
					Baseplate: {
						$className: "Part",
						$properties: { Size: [512, 20, 512] },
					},
				},
				Lighting: { $properties: { Brightness: 2 } },
				ReplicatedStorage: {},
			};

			const names = Object.keys(
				JSON.parse(
					textOf(tree)
						.replace(/\/\/.*\n/, "")
						.replace(", }", " }")
				).tree
			);

			expect(names).toEqual([
				"$className",
				"Workspace",
				"Lighting",
				"ReplicatedStorage",
			]);
		});

		it("should drop a node the tree no longer has", () => {
			const tree = {
				$className: "DataModel",
				Lighting: { $properties: { Brightness: 2 } },
			};

			const text = textOf(tree);

			expect(text).not.toContain("Workspace");
			expect(text).toContain('"Brightness": 2 }');
		});

		it("should print a node afresh when the file repeats a key in it", () => {
			const repeated =
				'{"tree": {"$className": "DataModel", "A": {"x": 1}, "A": {"x": 2}}}';

			const text = ProjectText.ofConfig(
				{ tree: { $className: "DataModel", A: { x: 3 } } },
				[],
				WrittenTree.of(repeated)
			);

			expect(text.match(/"A"/g)).toHaveLength(1);
		});

		it("should leave no whitespace on an empty line, and read the indentation from a key, not a comment", () => {
			const text = ProjectText.ofConfig(
				{ tree: { A: { x: 1 } } },
				[],
				WrittenTree.of(
					'{\n/*\n * note\n */\n    "tree": {\n        "A": {\n\n            "x": 1\n        }\n    }\n}\n'
				)
			);

			expect(text).toContain('"A": {\n\n      "x": 1\n    }');
			expect(text).not.toMatch(/[ \t]\n/);
		});

		it("should be undefined for a text that holds no tree", () => {
			expect(WrittenTree.of("{}")).toBeUndefined();
			expect(WrittenTree.of("{")).toBeUndefined();
		});
	});
});
