import { RojoTree } from "../../rojo/rojo-tree.js";
import { templateProject } from "../template.js";
import { abs, configOf } from "./fixtures.js";

const mountedPackages: Partial<RojoTree> = {
	tree: {
		$className: "DataModel",
		ReplicatedStorage: { $className: "ReplicatedStorage", $path: "Packages" },
	},
};

describe("templateProject", () => {
	const templated = (file: string, projectDir: string) =>
		templateProject(
			configOf({ template: { file, project: mountedPackages } }),
			projectDir
		).getTree().tree.ReplicatedStorage;

	it("should start from a bare DataModel without a template", () => {
		const project = templateProject(configOf({ name: "game" }), abs("."));

		expect(project.getTree()).toEqual({
			name: "game",
			tree: { $className: "DataModel" },
		});
	});

	it("should keep a path as written when the template sits in the project's directory", () => {
		expect(
			templated(abs("default.project.json"), abs("."))
		).toMatchObject({ $path: "Packages" });
	});

	it("should rebase a path when the template lives in another directory", () => {
		expect(
			templated(abs("default.project.json"), abs("places/main"))
		).toMatchObject({ $path: "../../Packages" });
		expect(
			templated(abs("places/main/base.project.json"), abs("."))
		).toMatchObject({ $path: "places/main/Packages" });
	});
});
