import path from "path";
import { Darklua } from "../darklua.js";

const directory = path.resolve("/mock/my-game");

describe("Darklua.processCommands", () => {
	it("should process one root dir into the sync dir itself", () => {
		expect(Darklua.processCommands(directory, ["src"], "dist")).toEqual([
			"darklua process src dist",
		]);
	});

	it("should process each of several root dirs to its path under the common root", () => {
		expect(
			Darklua.processCommands(
				directory,
				["src", "places/lobby"],
				"dist/lobby"
			)
		).toEqual([
			"darklua process src dist/lobby/src",
			"darklua process places/lobby dist/lobby/places/lobby",
		]);
	});

	it("should measure from the deepest shared folder", () => {
		expect(
			Darklua.processCommands(directory, ["game/src", "game/lib"], "dist")
		).toEqual([
			"darklua process game/src dist/src",
			"darklua process game/lib dist/lib",
		]);
	});
});
