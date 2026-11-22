import { Command } from "../../../platform/commands/commands.js";
import { HelpPages } from "../help-pages.js";

const commandOf = (metadata: Partial<Command["metadata"]>): Command => ({
	id: "demo",
	handler: { run: () => Promise.reject(new Error("not run")) } as never,
	metadata: {
		summary: "Demo a thing.",
		description: "Demo a thing.",
		...metadata,
	},
});

describe("HelpPages", () => {
	it("should write a required argument in angle brackets in the usage line", () => {
		const command = commandOf({
			args: [{ name: "place", description: "The place to demo." }],
		});

		expect(
			new HelpPages(new Map()).textOf({ kind: "command", command })
		).toContain("rogen demo [OPTIONS] <PLACE>");
	});

	it("should write the usage of a command that declares no arguments", () => {
		const command = commandOf({});

		expect(
			new HelpPages(new Map())
				.textOf({ kind: "command", command })
				.split("\n")
		).toContain("    rogen demo [OPTIONS]");
	});

	it("should give no text for a topic it doesn't have", () => {
		expect(
			new HelpPages(new Map()).textOf({ kind: "topic", name: "nothing" })
		).toBe("");
	});
});
