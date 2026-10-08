import { StarterTemplate } from "../starter-template.js";

const mount = (path: string, landing: string, optional = false) => ({
	path,
	optional,
	landing,
});
const include = mount("include", "ReplicatedStorage/rbxts_include");
const rbxts = mount(
	"node_modules/@rbxts",
	"ReplicatedStorage/rbxts_include/node_modules/@rbxts"
);
const flamework = mount(
	"node_modules/@flamework",
	"ReplicatedStorage/rbxts_include/node_modules/@flamework"
);
const packages = mount("Packages", "ReplicatedStorage/Packages");

const parsed = (project: unknown): StarterTemplate =>
	StarterTemplate.parse(JSON.stringify(project)) as StarterTemplate;

const treeOf = (template: StarterTemplate) =>
	JSON.parse(template.toJson()).tree;

describe("StarterTemplate", () => {
	describe("fromMounts", () => {
		it("should start a project at the DataModel that mounts each folder at its landing", () => {
			const template = StarterTemplate.fromMounts("game", [
				packages,
				mount(
					"ServerPackages",
					"ServerScriptService/ServerPackages",
					true
				),
			]) as StarterTemplate;

			expect(JSON.parse(template.toJson())).toEqual({
				name: "game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: {
						ServerPackages: {
							$path: { optional: "ServerPackages" },
						},
					},
				},
			});
		});

		it("should start nothing when there is nothing to mount", () => {
			expect(StarterTemplate.fromMounts("game", [])).toBeUndefined();
		});
	});

	describe("parse", () => {
		it("should read a project file", () => {
			expect(
				treeOf(parsed({ name: "x", tree: { $className: "DataModel" } }))
			).toEqual({
				$className: "DataModel",
			});
		});

		it.each(["{ nope", "[]", '{ "tree": 5 }'])(
			"should give up on %j",
			(text) => {
				expect(StarterTemplate.parse(text)).toBeUndefined();
			}
		);
	});

	describe("withoutNodesIn", () => {
		const project = {
			name: "x",
			tree: {
				$path: "src",
				ServerScriptService: {
					Server: { $path: "src/server" },
					Kept: { $path: "Packages" },
				},
			},
		};

		it("should drop the nodes that point into the dirs Rogen generates, and say where they were", () => {
			const result = parsed(project).withoutNodesIn(["src"]);

			expect(result?.removed).toEqual([
				{
					path: "src/server",
					instancePath: ["ServerScriptService", "Server"],
				},
			]);
			expect(treeOf(result!.template)).toEqual({
				$path: "src",
				ServerScriptService: { Kept: { $path: "Packages" } },
			});
		});

		it("should not touch what points elsewhere", () => {
			const result = parsed(project).withoutNodesIn(["lib"]);

			expect(result?.removed).toEqual([]);
		});

		it("should give up when a dir is the whole folder", () => {
			expect(parsed(project).withoutNodesIn(["."])).toBeUndefined();
		});
	});

	describe("withMounts", () => {
		it("should list what it adds in tree order", () => {
			const { added } = parsed({ tree: {} }).withMounts([
				include,
				rbxts,
				packages,
				flamework,
			]);

			expect(added).toEqual([
				"include at ReplicatedStorage/rbxts_include",
				"node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				"node_modules/@flamework at ReplicatedStorage/rbxts_include/node_modules/@flamework",
				"Packages at ReplicatedStorage/Packages",
			]);
		});

		it("should skip every mount below a node the template already has there", () => {
			const tree = {
				ReplicatedStorage: { rbxts_include: { $className: "Folder" } },
			};

			const result = parsed({ tree }).withMounts([include, rbxts]);

			expect(result.added).toEqual([]);
			expect(result.skipped).toEqual([
				"include at ReplicatedStorage/rbxts_include",
				"node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts",
			]);
			expect(treeOf(result.template)).toEqual(tree);
		});

		it("should leave a mount alone that the template already mounts, itself or through a parent", () => {
			const template = parsed({
				tree: {
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			});

			const result = template.withMounts([
				packages,
				mount("Packages/sub", "X/Sub"),
			]);

			expect(result.added).toEqual([]);
			expect(result.skipped).toEqual([]);
		});

		it("should not change the template it was called on", () => {
			const template = parsed({ tree: {} });

			template.withMounts([packages]);

			expect(treeOf(template)).toEqual({});
		});
	});
});
