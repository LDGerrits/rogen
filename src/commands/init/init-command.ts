import { CancelledError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { WriteRun } from "../../domain/write/write.js";
import { WriteService } from "../../domain/write/write-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	InitChoices,
	InitPlan,
	InitService,
} from "../../domain/init/init-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	InitJsonLog,
	InitLog,
	InitReporter,
	initDocumentShape,
} from "./init-log.js";

const InitOptions = [
	{
		name: "non-interactive",
		short: "y",
		aliases: ["yes"],
		type: "boolean",
		description:
			"Write the defaults without asking. A run without a terminal, or under a coding agent or CI, does so anyway. --json implies it. Any flag still answers its own question.",
	},
	JsonOption,
	{
		name: "dry-run",
		short: "n",
		type: "boolean",
		description:
			"Plan without writing: print the files and choices, then stop.",
	},
	{
		name: "kind",
		type: "string",
		values: ["place", "model", "plugin"],
		description:
			"What a new project is, as Rojo's init names it: a place (the default), a model or a plugin. A model or a plugin starts with Rojo's template of that kind and no routes.",
	},
	{
		name: "skip-git",
		type: "boolean",
		description:
			"Leave git out of a new project: write no .gitignore and run no git init. Otherwise a .gitignore is written where none is, and git init runs where no work tree holds the folder.",
	},
	{
		name: "language",
		type: "string",
		placeholder: "id",
		description:
			"The language: luau or roblox-ts. Detected from the folder when not given. For roblox-ts in a folder with no code, package.json or tsconfig.json, init first runs 'npm create roblox-ts', which needs npm and the network.",
	},
	{
		name: "sample",
		type: "boolean",
		negation: "only",
		description:
			"Leave the Greeter sample out, for an empty src and no place. The sample is three hello-world scripts in src/Greeter, Rojo's Baseplate and lighting in place, which the tree mounts, and a README; a new place in a folder with no code gets it.",
	},
	{
		name: "places",
		type: "boolean",
		negation: "also",
		description:
			"Whether a new project is several places. Luau: the code they share in src/common, a first place in src/game, a game.rogen.json at the root for it, and editor settings for luau-lsp; more places by copying that file. roblox-ts: the code they share in projects/common and a first place in projects/game with its own default.rogen.json and tsconfig.json, more by copying that folder. One place when not given, or several where a projects folder exists for roblox-ts.",
	},
	{
		name: "agent-rules",
		type: "boolean",
		negation: "also",
		description:
			"Whether to add Rogen's rules for coding agents to the agent file. Added when not given, and imported into CLAUDE.md and GEMINI.md. In a project that has a config, it adds them there, and takes no flag that shapes a config.",
	},
	{
		name: "agent-hook",
		type: "boolean",
		description:
			"Add the hook that reports Rogen warnings to the coding agents found. Added only when given, or chosen under Customise. In a project that has a config, it adds it there, and takes no flag that shapes a config.",
	},
] as const;

/** The flags, as the choices `init` is not to ask about. Their values were checked against `values` when the line was parsed. */
function choicesOf(
	options: CommandLine<typeof InitOptions>["options"]
): InitChoices {
	return {
		kind: options.kind as InitChoices["kind"],
		skipGit: options["skip-git"],
		agentRules: options["agent-rules"],
		agentHook: options["agent-hook"],
		language: options.language,
		sample: options.sample,
		places: options.places,
	};
}

registerCommand(
	class InitCommand extends AbstractCommand<typeof InitOptions> {
		constructor() {
			super({
				id: "init",
				metadata: {
					summary: "Starts a project with a default.rogen.json",
					description:
						"Starts a project with a default.rogen.json, as 'rojo init' does. It reads what the folder holds, and asks in a terminal. With a folder, it starts the project there. Beside a hand-written default.project.json, it lifts that tree into default.rogen.json. The source path is the closest folder that holds the code the file mounts. From then on, 'rogen write' writes default.project.json from the config. Where a config exists, init writes nothing, but --agent-rules and --agent-hook still add the agent files. To change a config, edit the .rogen.json and run 'rogen check'.",
					args: [
						{
							name: "path",
							description:
								"The folder to start the project in, made when it is not there.",
							isOptional: true,
						},
					],
					options: InitOptions,
					output: { document: initDocumentShape },
					effects: ["writesFiles"],
					examples: [
						"rogen init",
						"rogen init --non-interactive",
						"rogen init game",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			if (line.positionals.length > 1)
				return err(new UsageError("init takes one folder."));
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			const dryRun = Boolean(line.options["dry-run"]);
			const log = new InitLog(
				logService,
				accessor.get(EnvironmentService).cwd,
				dryRun
			);
			const ask = !line.options["non-interactive"] && !line.options.json;

			if (!line.options.json) log.intro();
			const planned = await initService.plan({
				ask,
				place: line.positionals[0],
				choices: choicesOf(line.options),
			});
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			const reporter: InitReporter = line.options.json
				? new InitJsonLog(
						logService,
						accessor.get(EnvironmentService).cwd,
						plan.directory,
						dryRun
					)
				: log;
			reporter.begin(plan);
			const written = await initService.write(
				plan,
				(item) => reporter.written(item),
				dryRun
			);
			if (written.isErr()) return reporter.failed(written.error);
			if (dryRun) return reporter.planned(plan);
			const run = await this.writeConfigs(accessor, plan);
			if (run.isErr()) return reporter.failed(run.error);
			return reporter.done(plan, run.value);
		}

		private async writeConfigs(
			accessor: ServicesAccessor,
			plan: InitPlan
		): Promise<Result<WriteRun, Error>> {
			if (plan.configs.length === 0) return ok(new WriteRun([]));
			const selection = await accessor
				.get(ConfigService)
				.select(plan.configs);
			if (selection.isErr()) return selection;
			return ok(await accessor.get(WriteService).write(selection.value));
		}
	}
);
