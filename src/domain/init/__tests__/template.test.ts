import {
	addMissingMounts,
	defaultTemplateChoice,
	handWrittenProjectFiles,
} from "../template.js";

describe("handWrittenProjectFiles", () => {
	it("should list project files that no config beside them writes", () => {
		expect(
			handWrittenProjectFiles(
				new Set([
					"default.project.json",
					"lobby.project.json",
					"lobby.rogen.json",
					"template.project.json",
					"README.md",
				])
			)
		).toEqual(["default.project.json"]);
	});
});

describe("defaultTemplateChoice", () => {
	const outputs = ["default.project.json"];

	it("should copy a hand-written output", () => {
		expect(
			defaultTemplateChoice(new Set(["default.project.json"]), outputs)
		).toEqual({ kind: "copy", from: "default.project.json" });
	});

	it("should start new when only other project files exist", () => {
		expect(
			defaultTemplateChoice(new Set(["base.project.json"]), outputs)
		).toEqual({ kind: "new" });
	});

	it("should start new when template.project.json exists, which is used as it is", () => {
		expect(
			defaultTemplateChoice(
				new Set(["default.project.json", "template.project.json"]),
				outputs
			)
		).toEqual({ kind: "new" });
	});
});

describe("addMissingMounts", () => {
	const mount = (path: string, landing: string) => ({
		path,
		optional: false,
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

	it("should list what it adds in tree order", () => {
		const { added } = addMissingMounts({ tree: {} }, [
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

		const result = addMissingMounts({ tree }, [include, rbxts]);

		expect(result.added).toEqual([]);
		expect(result.skipped).toEqual([
			"include at ReplicatedStorage/rbxts_include",
			"node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts",
		]);
		expect(result.project.tree).toEqual(tree);
	});
});
