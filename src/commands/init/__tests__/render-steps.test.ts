import { renderSteps } from "../render-steps.js";

const none = { setup: [], run: [], darklua: [], edits: [] };

describe("renderSteps", () => {
	it("should group the long-running commands under one line", () => {
		expect(
			renderSteps({ ...none, run: ["rogen watch", "rojo serve"] })
		).toEqual([
			"Run each in its own terminal:",
			"  rogen watch",
			"  rojo serve",
		]);
	});

	it("should print setup first, then commands, Darklua and edits", () => {
		expect(
			renderSteps({
				setup: ["Edit tsconfig.json."],
				run: ["rogen watch"],
				darklua: ["darklua process src dist"],
				edits: ["Add tags."],
			})
		).toEqual([
			"Edit tsconfig.json.",
			"Run each in its own terminal:",
			"  rogen watch",
			"Have Darklua process your code into the sync dir:",
			"  darklua process src dist",
			"Add tags.",
		]);
	});

	it("should leave out a group with nothing in it", () => {
		expect(renderSteps({ ...none, edits: ["Add tags."] })).toEqual([
			"Add tags.",
		]);
	});
});
