import {
	defaultTemplateChoice,
	handWrittenProjectFiles,
} from "../init-template.js";

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
