import path from "path";
import { InitPlan, PlannedCommand } from "../init-service.js";
import { InitSummary } from "../init-summary.js";

const planOf = (overrides: Partial<InitPlan> = {}): InitPlan => ({
	directory: path.resolve("/repo"),
	action: "create",
	summary: [],
	moves: [],
	files: [],
	directories: [],
	commands: [],
	configs: [],
	notes: [],
	warnings: [],
	nextSteps: { setup: [], run: [], edits: [] },
	asked: false,
	decided: [],
	gitInit: false,
	...overrides,
});

const commandOf = (command: string): PlannedCommand => ({
	command,
	file: command.split(" ")[0],
	args: command.split(" ").slice(1),
	timeout: 1000,
});

describe("InitSummary", () => {
	it("should say that no file is written", () => {
		expect(InitSummary.lines(planOf())).toEqual(["Files     none"]);
	});

	it("should name git init, the starter tool and the commands it runs after", () => {
		const lines = InitSummary.lines(
			planOf({
				gitInit: true,
				scaffold: {
					command: commandOf("npm create roblox-ts"),
					replaces: [],
				},
				commands: [commandOf("npm run build")],
			})
		);

		expect(lines).toEqual([
			"Git       git init",
			"Files     none",
			"Runs      npm create roblox-ts, npm run build",
		]);
	});
});
