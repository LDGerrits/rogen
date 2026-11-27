import path from "path";
import { LogService } from "../../../platform/log/log-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	FailedConfig,
	SyncWarnings,
	WriteRun,
	WrittenConfig,
} from "../../../domain/write/write.js";
import {
	InitPlan,
	InitWritten,
	PlannedCommand,
} from "../../../domain/init/init-service.js";
import { InitJsonLog, InitLog } from "../init-log.js";

const cwd = path.resolve("/repo");

const planOf = (overrides: Partial<InitPlan> = {}): InitPlan => ({
	directory: cwd,
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
	args: [],
	timeout: 1000,
});

const textLog = (dryRun = false) => {
	const logService = new MockLogService();
	const log = instantiationOf([LogService, logService]).createInstance(
		InitLog,
		cwd,
		dryRun
	);
	return { logService, log };
};

const jsonLog = (dryRun = false) => {
	const logService = new MockLogService();
	const log = instantiationOf([LogService, logService]).createInstance(
		InitJsonLog,
		cwd,
		cwd,
		dryRun
	);
	return { logService, log };
};

const writtenLines = (items: readonly InitWritten[], dryRun = false) => {
	const { logService, log } = textLog(dryRun);
	log.begin(planOf());
	for (const item of items) log.written(item);
	return logService.lines;
};

const writtenJson = (items: readonly InitWritten[], dryRun = false) => {
	const { logService, log } = jsonLog(dryRun);
	log.begin(planOf());
	for (const item of items) log.written(item);
	log.planned(planOf());
	return logService.json();
};

const wroteConfig = () =>
	new WrittenConfig(
		mockConfig(),
		"wrote",
		{ warnings: [], sync: SyncWarnings.known([]) },
		{ roots: [], routes: [], unrouted: 0, replaced: 0, displaced: 0 },
		[]
	);

describe("InitLog", () => {
	it("should name every default it took, and point to the help for the flags", () => {
		const { logService, log } = textLog();

		log.begin(
			planOf({
				decided: [
					{ question: "places", value: true, flag: "--places" },
					{ question: "places", value: false, flag: "--no-places" },
					{ question: "sample", value: true, flag: "--sample" },
					{ question: "sample", value: false, flag: "--no-sample" },
					{ question: "skipGit", value: true, flag: "--skip-git" },
					{ question: "skipGit", value: false, flag: "--git" },
					{
						question: "agentRules",
						value: true,
						flag: "--agent-rules",
					},
					{
						question: "agentRules",
						value: false,
						flag: "--no-agent-rules",
					},
					{
						question: "agentHook",
						value: true,
						flag: "--agent-hook",
					},
					{
						question: "agentHook",
						value: false,
						flag: "--no-agent-hook",
					},
				],
			})
		);

		expect(logService.texts("info")).toEqual([
			"Defaults: several places, one place, the Greeter sample, no sample, no git, a git repository, agent rules, no agent rules, the agent hook, no agent hook. See 'rogen init --help' to change them.",
		]);
	});

	it("should report git, folders, renames and additions as done", () => {
		expect(
			writtenLines([
				{ kind: "git" },
				{ kind: "directory", directory: "src" },
				{
					kind: "move",
					move: {
						from: "a.json",
						to: "b.json",
						reason: "since Rojo reads b",
					},
				},
				{
					kind: "file",
					file: {
						fileName: ".gitignore",
						content: "",
						addition: "x",
					},
				},
			])
		).toEqual([
			"success: Initialised a git repository.",
			"success: Created src/.",
			"success: Renamed a.json to b.json, since Rojo reads b.",
			"success: Added x to .gitignore.",
		]);
	});

	it("should report git, renames and additions as planned in a dry run", () => {
		expect(
			writtenLines(
				[
					{ kind: "git" },
					{ kind: "move", move: { from: "a.json", to: "b.json" } },
					{
						kind: "file",
						file: {
							fileName: ".gitignore",
							content: "",
							addition: "x",
						},
					},
				],
				true
			)
		).toEqual([
			"success: Would initialise a git repository.",
			"success: Would rename a.json to b.json.",
			"success: Would add x to .gitignore.",
		]);
	});

	it("should not list a file it wrote, but list one it would write", () => {
		const file = {
			kind: "file" as const,
			file: { fileName: "a.json", content: "" },
		};

		expect(writtenLines([file])).toEqual([]);
		expect(writtenLines([file], true)).toEqual([
			"success: Would create a.json.",
		]);

		const { logService, log } = textLog(true);
		log.begin(planOf({ directory: path.join(cwd, "lobby") }));
		log.written(file);
		expect(logService.lines).toEqual([
			"success: Would create lobby/a.json.",
		]);
	});

	it("should name the commands left to run after one fails", () => {
		expect(
			writtenLines([
				{
					kind: "command",
					command: commandOf("npm i"),
					failed: "exit 1",
				},
				{
					kind: "command",
					command: commandOf("npm i"),
					failed: "exit 1",
					skipped: [commandOf("npm run build")],
				},
			])
		).toEqual([
			"warn: npm i failed (exit 1). Run it yourself: npm i.",
			"warn: npm i failed (exit 1). Run these yourself: npm i, then npm run build.",
		]);
	});

	it("should count renames in a dry run's outro", () => {
		const { logService, log } = textLog(true);

		log.planned(planOf({ moves: [{ from: "a", to: "b" }] }));

		expect(logService.texts("outro")).toEqual([
			"Would write 0 files and make 1 rename. Nothing was written.",
		]);
	});

	it("should say the lifted project is untouched when the project file fails", () => {
		const { logService, log } = textLog();
		const run = new WriteRun([
			new FailedConfig(mockConfig(), [
				errorDiagnostic("E", { resource: "/repo/x" }, "Broken."),
			]),
		]);

		const result = log.done(
			planOf({ liftedFrom: "default.project.json" }),
			run,
			false
		);

		expect(result.isErr()).toBe(true);
		expect(logService.texts("outro")).toEqual([
			"Wrote 0 files, but writing the project file failed. default.project.json is as it was, so Rojo still reads it. Fix default.rogen.json and run 'rogen write'.",
		]);
	});

	it("should name each config that failed to write", () => {
		const { logService, log } = textLog();
		const failed = (file: string) =>
			new FailedConfig(mockConfig({ file }), [
				errorDiagnostic("E", { resource: file }, "Broken."),
			]);

		log.done(
			planOf(),
			new WriteRun([
				failed("/repo/lobby.rogen.json"),
				failed("/repo/match.rogen.json"),
			]),
			false
		);

		expect(logService.texts("outro")).toEqual([
			"Wrote 0 files, but writing the project file failed. Fix lobby.rogen.json and match.rogen.json and run 'rogen write'.",
		]);
	});

	it("should list next steps without a run step or a Studio step when there is nothing to run", () => {
		const { logService, log } = textLog();

		log.done(
			planOf({
				nextSteps: { setup: ["npm i"], run: [], edits: ["Edit a."] },
			}),
			new WriteRun([]),
			false
		);

		expect(logService.lines).toEqual([
			"step: Next steps",
			"info: npm i",
			"info: Edit a.",
			"outro: Wrote 0 files.",
		]);
	});

	it("should leave out the next steps when there are none", () => {
		const { logService, log } = textLog();

		log.done(planOf(), new WriteRun([]), false);

		expect(logService.lines).toEqual(["outro: Wrote 0 files."]);
	});

	it("should leave out the Studio step when nothing serves", () => {
		const { logService, log } = textLog();

		log.done(
			planOf({
				nextSteps: {
					setup: [],
					run: ["rogen build", "npm run watch"],
					edits: [],
				},
			}),
			new WriteRun([]),
			false
		);

		expect(logService.texts("info")).toEqual([
			"Run each in its own terminal:",
			"  rogen build",
			"  npm run watch",
		]);
	});
});

describe("InitJsonLog", () => {
	it("should record git, folders, commands and moves as done", () => {
		expect(
			writtenJson([
				{ kind: "git" },
				{ kind: "directory", directory: "src" },
				{ kind: "command", command: commandOf("npm i") },
				{ kind: "move", move: { from: "a", to: "b" } },
			])
		).toEqual({
			changed: true,
			moves: [
				{
					from: path.join(cwd, "a"),
					to: path.join(cwd, "b"),
					outcome: "moved",
				},
			],
			files: [],
			directories: [path.join(cwd, "src")],
			git: "initialised",
			commands: [{ command: "npm i", outcome: "ran" }],
			notes: [],
			nextSteps: { setup: [], run: [], edits: [] },
		});
	});

	it("should count a command that ran as a change", () => {
		expect(
			writtenJson([{ kind: "command", command: commandOf("npm i") }])
		).toMatchObject({ changed: true });
	});

	it("should record git and commands as planned in a dry run", () => {
		expect(
			writtenJson(
				[
					{ kind: "git" },
					{ kind: "command", command: commandOf("npm i") },
				],
				true
			)
		).toMatchObject({
			changed: false,
			dryRun: true,
			git: "wouldInitialise",
			commands: [{ command: "npm i", outcome: "wouldRun" }],
		});
	});

	it("should record a failed git and a failed command with the ones it skipped", () => {
		expect(
			writtenJson([
				{ kind: "git", failed: "no git" },
				{
					kind: "command",
					command: commandOf("npm i"),
					failed: "exit 1",
					skipped: [commandOf("npm run build")],
				},
			])
		).toMatchObject({
			changed: false,
			git: "failed",
			commands: [
				{ command: "npm i", outcome: "failed", error: "exit 1" },
				{ command: "npm run build", outcome: "skipped" },
			],
		});
	});

	it("should list the plan's warnings", () => {
		const { logService, log } = jsonLog(true);

		log.planned(
			planOf({
				warnings: [
					warningDiagnostic("W", { resource: "/repo/x" }, "Careful."),
				],
			})
		);

		expect(logService.json()).toMatchObject({
			warnings: [{ code: "W", message: "Careful." }],
		});
	});

	it("should count a written project file as a change", () => {
		const { logService, log } = jsonLog();

		log.done(planOf(), new WriteRun([wroteConfig()]));

		expect(logService.json()).toMatchObject({
			changed: true,
			projects: [{ outcome: "wrote" }],
		});
	});
});
