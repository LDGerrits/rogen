import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import {
	ConfigArguments,
	ConfigService,
} from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { SyncbackService } from "../../domain/syncback/syncback-service.js";
import { SyncbackPlan } from "../../domain/syncback/syncback.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import {
	warningDiagnostic,
	messageRelativeTo,
} from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { BuildLog } from "../build/build-log.js";
import {
	SyncbackOutcome,
	syncbackDocument,
	syncbackDocumentShape,
	syncbackEntry,
} from "./syncback-document.js";

const InputOption = {
	name: "input",
	short: "i",
	type: "string",
	placeholder: "file",
	description:
		"The place or model file (.rbxl, .rbxlx, .rbxm, .rbxmx) to bring changes from. Rojo needs it.",
} as const satisfies OptionDescriptor;

const SyncbackOptions = [
	JsonOption,
	InputOption,
	{
		name: "list",
		short: "l",
		type: "boolean",
		description:
			"List the files that are written and removed, as Rojo's syncback does. A run that asks first, or that is a dry run, lists them anyway.",
	},
	{
		name: "dry-run",
		short: "n",
		type: "boolean",
		description:
			"Plan the run and list it without changing a source file. The project files are still written.",
	},
	{
		name: "non-interactive",
		short: "y",
		type: "boolean",
		description:
			"Write and remove without asking. A run without a terminal needs it, or --dry-run.",
	},
] as const satisfies readonly OptionDescriptor[];

const counts = (plan: SyncbackPlan): string => {
	const written = plan.changes.filter(({ kind }) => kind === "write").length;
	const removed = plan.changes.length - written;
	return [
		written > 0 ? `${written} to write` : undefined,
		removed > 0 ? `${removed} to remove` : undefined,
	]
		.filter((part) => part !== undefined)
		.join(", ");
};

registerCommand(
	class SyncbackCommand extends AbstractCommand<typeof SyncbackOptions> {
		constructor() {
			super({
				id: "syncback",
				metadata: {
					summary:
						"Brings a place file's changes back into the source files",
					description:
						"Writes the project files, then has Rojo's syncback read a place or model file and write what changed into your source folders, as 'rojo syncback' does for a project file. A folder that routing makes one instance, such as src/Inventory/Server, is read by Rojo as it is; an instance the place added where no folder holds it is put where routing places a file for it, beside the files already there. It removes the files of instances the place no longer holds, so look first with --dry-run.",
					args: ConfigArguments,
					options: SyncbackOptions,
					output: { document: syncbackDocumentShape },
					effects: ["writesFiles", "runsProcesses"],
					examples: [
						"rogen syncback --input game.rbxl --dry-run",
						"rogen syncback -i game.rbxl -y",
						"rogen syncback places/lobby -i lobby.rbxl --list",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof SyncbackOptions>
		): Promise<Result<void, Error>> {
			const { input, json } = line.options;
			if (input === undefined)
				return err(
					new UsageError(
						"--input names the place or model file to bring changes from, and Rojo needs it."
					)
				);
			const dryRun = line.options["dry-run"] === true;
			const yes = line.options["non-interactive"] === true;
			const promptService = accessor.get(PromptService);
			const logService = accessor.get(LogService);
			if (!dryRun && !yes && (!promptService.isInteractive || json))
				return err(
					new UsageError(
						"syncback writes and removes files, and this run can't ask.",
						"Pass -y/--non-interactive to write without asking, or --dry-run to list what it would do."
					)
				);
			const cwd = accessor.get(EnvironmentService).cwd;
			const rojoService = accessor.get(RojoCommandService);

			const selection = await accessor
				.get(ConfigService)
				.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const chosen = selection.value.requireValid().isErr()
				? undefined
				: rojoService.choose(selection.value, "syncback");
			if (chosen?.isErr()) return chosen;
			const project = chosen?.isOk() ? chosen.value : undefined;

			const buildService = accessor.get(BuildService);
			let build = await buildService.build(selection.value);
			const failure = build.failure();

			const syncbacks = accessor.get(SyncbackService);
			const request =
				project &&
				({ selection: selection.value, project, input, cwd } as const);
			const planned =
				failure || !request ? undefined : await syncbacks.plan(request);

			let outcome: SyncbackOutcome =
				planned === undefined
					? { kind: "notRun" }
					: planned.isErr()
						? { kind: "failed", error: planned.error }
						: {
								kind: "planned",
								plan: planned.value,
								warnings: [],
							};
			let stopped: Error | undefined;
			if (planned?.isOk() && request && !dryRun) {
				const plan = planned.value;
				const go =
					plan.changes.length > 0 &&
					(yes ||
						(await this.asked(
							promptService,
							logService,
							plan,
							cwd
						)));
				if (go) {
					const applied = await syncbacks.apply(plan, request);
					outcome = applied.isErr()
						? { kind: "failed", error: applied.error }
						: {
								kind: "written",
								plan: applied.value,
								warnings: applied.value.warnings,
							};
					if (applied.isOk())
						build = await buildService.build(selection.value);
				}
			}
			if (outcome.kind === "failed") stopped = outcome.error;

			if (json)
				return this.printJson(
					logService,
					syncbackDocument(
						build.builds,
						syncbackEntry(input, outcome)
					),
					failure ?? stopped
				);
			new BuildLog(logService, cwd).report(
				build,
				selection.value.home,
				"syncback"
			);
			if (outcome.kind === "planned" || outcome.kind === "written")
				this.report(
					logService,
					outcome,
					cwd,
					dryRun || line.options.list === true || !yes
				);
			if (stopped) return err(stopped);
			return failure ? this.reported(failure) : ok(undefined);
		}

		private async asked(
			promptService: PromptService,
			logService: LogService,
			plan: SyncbackPlan,
			cwd: string
		): Promise<boolean> {
			this.listChanges(logService, plan, cwd);
			const answer = await promptService.confirm({
				message: `Write and remove files (${counts(plan)})?`,
				initialValue: false,
			});
			return answer === true;
		}

		private listChanges(
			logService: LogService,
			plan: SyncbackPlan,
			cwd: string
		): void {
			for (const { kind, file } of plan.changes)
				logService.info(
					`${kind === "write" ? "write " : "remove"} ${path.relative(cwd, file)}`
				);
		}

		private report(
			logService: LogService,
			outcome: Extract<SyncbackOutcome, { plan: SyncbackPlan }>,
			cwd: string,
			list: boolean
		): void {
			const { plan } = outcome;
			if (list) this.listChanges(logService, plan, cwd);
			for (const { instance, reason } of plan.unplaced)
				logService.diagnostic(
					warningDiagnostic(
						"syncback.unplaced",
						{ resource: plan.project.file },
						`${instance} is in the place and no folder of the project can take it, so it was left out: ${messageRelativeTo(reason, cwd)}.`
					)
				);
			for (const warning of outcome.warnings)
				logService.diagnostic(warning);
			logService.info(
				outcome.kind === "written"
					? `Syncback ${plan.changes.length === 0 ? "changed nothing" : `wrote ${plan.changes.length} ${plan.changes.length === 1 ? "change" : "changes"}`}.`
					: plan.changes.length === 0
						? "Syncback would change nothing."
						: `Syncback would change ${plan.changes.length} ${plan.changes.length === 1 ? "file" : "files"} (${counts(plan)}).`
			);
		}
	}
);
