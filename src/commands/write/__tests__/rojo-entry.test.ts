import path from "path";
import { err } from "../../../base/result.js";
import { rojoEntry, serverMessagesJson } from "../rojo-entry.js";

const cwd = path.resolve("/repo");

describe("rojoEntry", () => {
	it("should say Rojo failed, with no project, when it could not start", () => {
		expect(
			rojoEntry(
				{ command: "build", cwd, output: "game.rbxl" },
				err(new Error("no rojo"))
			)
		).toEqual({
			command: "build",
			output: path.join(cwd, "game.rbxl"),
			outcome: "failed",
			project: null,
			messages: [],
			error: expect.objectContaining({
				message: expect.stringContaining("no rojo"),
			}),
		});
	});
});

describe("serverMessagesJson", () => {
	it("should leave out the lines Rogen drops as noise", () => {
		expect(
			serverMessagesJson([
				{ severity: "noise", text: "Port: 34872" },
				{ severity: "unrecognised", text: "Something new" },
			])
		).toEqual([{ severity: "info", text: "Something new" }]);
	});
});
