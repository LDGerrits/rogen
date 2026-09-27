import path from "path";
import { darkluaCommands, terminalSteps } from "../init-steps.js";

const directory = path.resolve("/mock/my-game");

describe("darkluaCommands", () => {
	it("should process one root dir into the sync dir itself", () => {
		expect(darkluaCommands(directory, ["src"], "dist")).toEqual([
			"darklua process src dist",
		]);
	});

	it("should process each of several root dirs to its path under the common root", () => {
		expect(
			darkluaCommands(directory, ["src", "places/lobby"], "dist/lobby")
		).toEqual([
			"darklua process src dist/lobby/src",
			"darklua process places/lobby dist/lobby/places/lobby",
		]);
	});

	it("should measure from the deepest shared folder", () => {
		expect(
			darkluaCommands(directory, ["game/src", "game/lib"], "dist")
		).toEqual([
			"darklua process game/src dist/src",
			"darklua process game/lib dist/lib",
		]);
	});
});

describe("terminalSteps", () => {
	it("should group the commands under one line", () => {
		expect(terminalSteps(["rogen watch", "rojo serve"])).toEqual([
			"Run each in its own terminal:",
			"  rogen watch",
			"  rojo serve",
		]);
	});
});
