import { CancelledError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildRun } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
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
		type: "boolean",
		description:
			"Write the defaults without asking, as a run without a terminal, or under a coding agent or CI, does. --json implies it. A flag below answers its question either way.",
	},
	JsonOption,
	{
		name: "dry-run",
		short: "n",
		type: "boolean",
		description:
			"Plan without writing or building: print the files it would write and the choices it took, then stop.",
	},
	{
		name: "language",
		type: "string",
		placeholder: "id",
		description:
			"The language: luau or roblox-ts. Detected from the folder when not given.",
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
		name: "sync-path",
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
			"With a default.project.json already here: lift its tree into rogen.json (the default), or start a new tree.",
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
			"A route to start with: server, client, shared, replicatedFirst, serverStorage or starterGui; repeat for several, or none. The first three when not given.",
	},
	{
		name: "unmatched",
		type: "string",
		values: ["shared", "leave"],
		description:
			"Where files that match no route go: into the shared route (the default), or nowhere, which Rogen warns about.",
	},
	{
		name: "agent-rules",
		type: "boolean",
		negatable: true,
		description:
			"Whether to add Rogen's rules for coding agents to the agent file. Added when not given. On a folder that has a config, asks for this addition.",
	},
	{
		name: "agent-hook",
		type: "boolean",
		negatable: true,
		description:
			"Whether to add the hook that reports Rogen warnings to the coding agents found. Not added when not given. On a folder that has a config, asks for this addition.",
	},
	{
		name: "rojo-pin",
		type: "boolean",
		negatable: true,
		description:
			"Whether to pin Rojo in rokit.toml. Not pinned when not given. On a folder that has a config, asks for this addition.",
	},
	{
		name: "nested",
		type: "boolean",
		description:
			"Start a project in a folder below another rogen.json, which a run that can't ask refuses otherwise.",
	},
	{
		name: "place-listing",
		type: "string",
		values: ["glob", "folder"],
		description:
			"With a place folder: list every folder beside it in the config's placePaths (the default), or only this one.",
	},
] as const;

/** The flags, as the choices `init` is not to ask about. Their values were checked against `values` when the line was parsed. */
function choicesOf(
	options: CommandLine<typeof InitOptions>["options"]
): InitChoices {
	return {
		nested: options.nested,
		placeListing: options["place-listing"] as InitChoices["placeListing"],
		agentRules: options["agent-rules"],
		rojoPin: options["rojo-pin"],
		agentHook: options["agent-hook"],
		language: options.language,
		darklua: options.darklua,
		sourcePaths: options["source-path"],
		projectFile: options["project-file"] as InitChoices["projectFile"],
		syncPath: options["sync-path"],
		packages: options.package,
		routes: options.route,
		unmatched: options.unmatched as InitChoices["unmatched"],
	};
}

registerCommand(
	class InitCommand extends AbstractCommand<typeof InitOptions> {
		constructor() {
			super({
				id: "init",
				metadata: {
					description:
						"Writes a starting rogen.json, detecting the workspace and asking in a terminal. With a folder below a config, adds it as a place of that config.",
					args: [
						{
							name: "path",
							description:
								"A folder below a rogen.json to add as a place of it: its own rogen.json with the port it is served on, its entry in the config's placePaths when none lists it, and a .code-workspace that lists the config's folder and every place.",
							isOptional: true,
						},
					],
					options: InitOptions,
					output: { document: initDocumentShape },
					effects: ["writesFiles"],
					examples: [
						"rogen init",
						"rogen init --non-interactive",
						"rogen init places/lobby",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			if (line.positionals.length > 1)
				return err(
					new UsageError("init takes one folder, the place to add.")
				);
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			const log = new InitLog(
				logService,
				accessor.get(EnvironmentService).cwd,
				Boolean(line.options["dry-run"])
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

			const dryRun = Boolean(line.options["dry-run"]);
			const reporter: InitReporter = line.options.json
				? new InitJsonLog(logService, plan.directory, dryRun)
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
		): Promise<Result<BuildRun, Error>> {
			if (plan.configs.length === 0) return ok(new BuildRun([]));
			const selection = await accessor
				.get(ConfigService)
				.select(plan.configs);
			if (selection.isErr()) return selection;
			return ok(await accessor.get(BuildService).build(selection.value));
		}
	}
);
