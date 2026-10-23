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
			"Write the defaults without asking. A run without a terminal, or under a coding agent or CI, does so anyway. --json implies it. A flag below answers its question either way.",
	},
	JsonOption,
	{
		name: "dry-run",
		short: "n",
		type: "boolean",
		description:
			"Plan without writing or building: print the files and choices, then stop.",
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
		name: "darklua",
		type: "boolean",
		negatable: true,
		description:
			"Whether Darklua processes your code before Rojo syncs it. Found from a Darklua config when not given.",
	},
	{
		name: "source-path",
		type: "string",
		multiple: true,
		placeholder: "path",
		description:
			"A folder with your scripts, relative to here; repeat for several. src when not given, or where the code is.",
	},
	{
		name: "compiled-path",
		type: "string",
		placeholder: "path",
		description:
			"With Darklua: the folder it writes into, and Rojo syncs from.",
	},
	{
		name: "project-file",
		type: "string",
		values: ["lift", "new"],
		description:
			"What to do with a default.project.json already here: lift its tree, or start a new one. Lifting writes the tree into default.rogen.json, and is the default.",
	},
	{
		name: "package",
		type: "string",
		multiple: true,
		placeholder: "path",
		description:
			"A package folder to mount as it is; repeat for several, or none for no mounts. The installed ones when not given.",
	},
	{
		name: "route",
		type: "string",
		multiple: true,
		placeholder: "id",
		description:
			"A route to start with; repeat for several, or none. The routes are server, client, shared, replicatedFirst, serverStorage and starterGui. The first three when not given. When a lifted project file mounts a folder of that name, the name stands for the route derived from it, which `Took the defaults` and `--json` write as mount:server.",
	},
	{
		name: "unmatched",
		type: "string",
		values: ["leave", "shared"],
		description:
			'Where files that match no route go: nowhere (the default) or into the shared route. Left out, each file is warned about, naming the routing folders to move it into; in the shared route it goes in as a "*" route. A lifted project file that mounted a whole source path keeps "*", which places what that node held.',
	},
	{
		name: "sample",
		type: "boolean",
		negatable: true,
		description:
			"Whether a new place starts with the Greeter sample. It is three hello-world scripts in src/Greeter, Rojo's Baseplate and lighting in place, which the tree mounts, and a README. Written when not given, in a folder with no code. --no-sample leaves src empty and writes no place.",
	},
	{
		name: "places",
		type: "boolean",
		negatable: true,
		description:
			"Whether a new project is several places. Luau: the code they share in src/common, a first place in src/game, a game.rogen.json at the root for it, and editor settings for luau-lsp; more places by copying that file. roblox-ts: the code they share in projects/common and a first place in projects/game with its own default.rogen.json and tsconfig.json, more by copying that folder. One place when not given, or several where a projects folder exists for roblox-ts.",
	},
	{
		name: "agent-rules",
		type: "boolean",
		negatable: true,
		description:
			"Whether to add Rogen's rules for coding agents to the agent file. Added when not given.",
	},
	{
		name: "agent-hook",
		type: "boolean",
		negatable: true,
		description:
			"Whether to add the hook that reports Rogen warnings to the coding agents found. Not added when not given.",
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
		darklua: options.darklua,
		sourcePaths: options["source-path"],
		projectFile: options["project-file"] as InitChoices["projectFile"],
		compiledPath: options["compiled-path"],
		packages: options.package,
		routes: options.route,
		unmatched: options.unmatched as InitChoices["unmatched"],
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
					summary: "Writes a starting default.rogen.json",
					description:
						"Writes a starting default.rogen.json, detecting the workspace and asking in a terminal. With a folder, starts a project there, as 'rojo init' does. It starts projects and never changes a config that exists: where one is, it fails and writes nothing. To change a config, edit the .rogen.json and run 'rogen check'.",
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
			const built = await this.buildConfigs(accessor, plan);
			if (built.isErr()) return reporter.failed(built.error);
			return reporter.done(plan, built.value);
		}

		private async buildConfigs(
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
