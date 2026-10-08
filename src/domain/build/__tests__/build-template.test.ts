import { RojoTree } from "../../rojo/rojo-project.js";
import { SyncLayout } from "../sync-layout.js";
import { BuildTemplate } from "../build-template.js";
import { abs, configOf, syncTools } from "./fixtures.js";

const mountedPackages: Partial<RojoTree> = {
	tree: {
		$className: "DataModel",
		ReplicatedStorage: {
			$className: "ReplicatedStorage",
			$path: "Packages",
		},
	},
};

const templateOf = (
	spec: Parameters<typeof configOf>[0],
	projectDir = abs(".")
) => {
	const config = configOf({
		outFile: `${projectDir}/default.project.json`,
		...spec,
	});
	return new BuildTemplate(config, new SyncLayout(config, syncTools));
};

describe("BuildTemplate", () => {
	const templated = (file: string, projectDir: string) =>
		templateOf(
			{ template: { file, project: mountedPackages } },
			projectDir
		).getNode(["ReplicatedStorage"]);

	it("should start from a bare DataModel without a template", () => {
		const template = templateOf({ name: "game" });

		expect(template.edit().getTree()).toEqual({
			name: "game",
			tree: { $className: "DataModel" },
		});
	});

	it("should keep a path as written when the template sits in the project's directory", () => {
		expect(templated(abs("default.project.json"), abs("."))).toMatchObject({
			$path: "Packages",
		});
	});

	it("should rebase a path when the template lives in another directory", () => {
		expect(
			templated(abs("default.project.json"), abs("places/main"))
		).toMatchObject({ $path: "../../Packages" });
		expect(
			templated(abs("places/main/base.project.json"), abs("."))
		).toMatchObject({ $path: "places/main/Packages" });
	});

	it("should drop a mounted node whose $path exclude matches", () => {
		const template = templateOf({
			exclude: [abs("Packages")],
			template: {
				file: abs("default.project.json"),
				project: mountedPackages,
			},
		});

		expect(template.getNode(["ReplicatedStorage"])).toBeUndefined();
		expect(template.mounts.paths).toEqual([]);
	});

	describe("globIgnorePaths", () => {
		const project = { tree: {}, globIgnorePaths: ["**/*.spec.luau", 3] };

		it("should keep the globs as written when the template sits in the project's directory", () => {
			expect(
				templateOf({
					template: { file: abs("t.project.json"), project },
				}).globIgnorePaths
			).toEqual(["**/*.spec.luau"]);
		});

		it("should rebase each glob when the template lives in another directory", () => {
			expect(
				templateOf(
					{
						template: {
							file: abs("shared/t.project.json"),
							project,
						},
					},
					abs(".")
				).globIgnorePaths
			).toEqual(["shared/**/*.spec.luau"]);
		});

		it("should have none without a template", () => {
			expect(templateOf({}).globIgnorePaths).toEqual([]);
		});
	});

	describe("displacing", () => {
		const template = templateOf({
			template: {
				file: abs("default.project.json"),
				project: {
					tree: {
						ReplicatedStorage: {
							Vendor: { $path: "vendor" },
							Shared: {},
						},
					},
				},
			},
		});
		const entry = { source: abs("src/Lib.luau"), rootDir: abs("src") };

		it("should name the file's own node, and the file, when the template defines it", () => {
			expect(
				template.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Shared"],
					folderNodes: [],
				})
			).toEqual({
				node: ["ReplicatedStorage", "Shared"],
				source: abs("src/Lib.luau"),
			});
		});

		it("should name a folder of the file that the template gives a $path, and that folder", () => {
			expect(
				template.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Vendor", "Lib"],
					folderNodes: [
						{
							dir: "Vendor",
							instancePath: ["ReplicatedStorage", "Vendor"],
						},
					],
				})
			).toEqual({
				node: ["ReplicatedStorage", "Vendor"],
				source: `${abs("src")}/Vendor`,
			});
		});

		it("should name nothing for a node the template doesn't define", () => {
			expect(
				template.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Other"],
					folderNodes: [],
				})
			).toBeUndefined();
		});
	});

	describe("disablesLegacyScripts", () => {
		const withLegacy = (emitLegacyScripts?: boolean) =>
			templateOf({
				template: {
					file: abs("default.project.json"),
					project: { tree: {}, emitLegacyScripts },
				},
			}).disablesLegacyScripts;

		it("should only be so when the template says it explicitly", () => {
			expect(withLegacy(false)).toBe(true);
			expect(withLegacy(true)).toBe(false);
			expect(withLegacy(undefined)).toBe(false);
			expect(templateOf({}).disablesLegacyScripts).toBe(false);
		});
	});

	describe("toFile", () => {
		it("should keep the template's own fields around the tree it is given", () => {
			const template = templateOf({
				name: "game",
				template: {
					file: abs("default.project.json"),
					project: { tree: {}, servePort: 34872, name: "ignored" },
				},
			});

			expect(template.toFile({ Lighting: {} }, ["a"])).toEqual({
				name: "game",
				servePort: 34872,
				tree: { Lighting: {} },
				globIgnorePaths: ["a"],
			});
		});

		it("should leave globIgnorePaths out when there are none", () => {
			expect(templateOf({}).toFile({}, [])).toEqual({
				name: "repo",
				tree: {},
			});
		});
	});
});
