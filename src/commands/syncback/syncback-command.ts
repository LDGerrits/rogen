import { defanged, plural } from "../../base/strings.js";
import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { WriteService } from "../../domain/write/write-service.js";
import { didWrite } from "../../domain/write/write.js";
import {
	ProjectArgument,
	singleProjectError,
	ConfigService,
} from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { SyncbackService } from "../../domain/syncback/syncback-service.js";
import {
	SyncbackPlan,
	SyncbackResult,
	placeFileAmong,
} from "../../domain/syncback/syncback.js";
import {
	AbstractCommand,
	ExitCodeError,
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
import {
	LifecycleService,
	exitCodeOfSignal,
} from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { OutcomeLog } from "../write/outcome-log.js";
import {
	SyncbackOutcome,
	compiledDiagnostics,
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
		description: "Plan the run and list it; nothing is written.",
	},
	{
		name: "non-interactive",
		short: "y",
		aliases: ["yes"],
		type: "boolean",
		description:
			"Write and remove without asking. A run without a terminal, or under a coding agent or CI, needs it, or --dry-run.",
	},
] as const satisfies readonly OptionDescriptor[];

/** How a run treats its plan: lists it only, writes it at once, or asks first. */
type SyncbackMode = "dryRun" | "apply" | "ask";

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
						"Writes the project file (not in a dry run), then has Rojo's syncback read a place or model file and write what changed into your source folders, as 'rojo syncback' does for a project file. A folder that routing makes one instance, such as src/Inventory/Server, is read by Rojo as it is; an instance the place added where no folder holds it is put where routing places a file for it, beside the files already there. It removes the files of instances the place no longer holds, so look first with --dry-run.",
					args: ProjectArgument,
					options: SyncbackOptions,
					output: { document: syncbackDocumentShape },
					effects: ["writesFiles", "runsProcesses"],
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"2": "the command line is wrong, or a run with no terminal got neither --non-interactive nor --dry-run",
					},
					examples: [
						"rogen syncback --input game.rbxl --dry-run",
						"rogen syncback -i game.rbxl -y",
						"rogen syncback lobby -i lobby.rbxl --list",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof SyncbackOptions>
		): Promise<Result<void, Error>> {
			const tooMany = singleProjectError("syncback", line.positionals);
			if (tooMany) return err(tooMany);
			const { input, json } = line.options;
			if (input === undefined) {
				const placeFile = placeFileAmong(line.positionals);
				return err(
					new UsageError(
						"--input names the place or model file to bring changes from, and Rojo needs it.",
						placeFile &&
							`'${placeFile}' is a place or model file, not a project: pass it as --input ${placeFile}.`
					)
				);
			}
			const mode: SyncbackMode =
				line.options["dry-run"] === true
					? "dryRun"
					: line.options["non-interactive"] === true
						? "apply"
						: "ask";
			const promptService = accessor.get(PromptService);
			const logService = accessor.get(LogService);
			const lifecycleService = accessor.get(LifecycleService);
			if (!json) logService.reserveStdout();
			if (mode === "ask" && (!promptService.isInteractive || json))
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

			const project = selection.value.requireValid().isErr()
				? undefined
				: rojoService.choose(selection.value);
			const syncbacks = accessor.get(SyncbackService);

			const writeService = accessor.get(WriteService);
			let run =
				mode === "dryRun"
					? await writeService.check(selection.value)
					: await writeService.write(selection.value);

			const request =
				project &&
				({ selection: selection.value, project, input, cwd } as const);
			let outcome: SyncbackOutcome = { kind: "notRun" };
			let listed = false;
			if (!run.failure() && request) {
				const configFile = request.project.file;
				if (mode === "apply") {
					outcome = this.written(
						await syncbacks.apply(request),
						configFile
					);
				} else if (mode === "ask") {
					const applied = await syncbacks.apply(
						request,
						async (plan) => {
							outcome = { kind: "planned", plan, warnings: [] };
							if (plan.changes.length === 0) return false;
							this.listChanges(logService, plan, cwd);
							this.warnLeftOut(logService, plan, cwd);
							listed = true;
							return this.asked(promptService, plan);
						}
					);
					if (applied.isErr())
						outcome = this.failed(applied.error, configFile);
					else if (applied.value)
						outcome = this.written(ok(applied.value), configFile);
				} else {
					const planned = await syncbacks.plan(request);
					outcome = planned.isErr()
						? this.failed(planned.error, configFile)
						: {
								kind: "planned",
								plan: planned.value,
								warnings: [],
							};
				}
				if (outcome.kind === "written") {
					const rewritten = await writeService.write(selection.value);
					if (
						rewritten.failure() ||
						rewritten.outcomes.some(didWrite)
					)
						run = rewritten;
				}
			}
			const failure = run.failure();
			let stopped: Error | undefined;
			if (outcome.kind === "failed") stopped = outcome.error;
			const { signal } = lifecycleService;
			if (stopped && signal !== undefined)
				stopped = new ExitCodeError(exitCodeOfSignal(signal), stopped);

			if (json)
				return this.printJson(
					logService,
					syncbackDocument(
						run.outcomes,
						cwd,
						syncbackEntry(input, outcome, cwd)
					),
					failure ?? stopped
				);
			new OutcomeLog(logService, cwd).report(
				run,
				selection.value.home,
				"syncback",
				mode !== "dryRun"
			);
			if (outcome.kind === "planned" || outcome.kind === "written")
				this.report(
					logService,
					outcome,
					cwd,
					(mode === "dryRun" || line.options.list === true) &&
						!listed,
					mode,
					listed
				);
			if (stopped) return err(stopped);
			return failure ? this.reported(failure) : ok(undefined);
		}

		private written(
			applied: Result<SyncbackResult, Error>,
			configFile: string
		): SyncbackOutcome {
			return applied.isErr()
				? this.failed(applied.error, configFile)
				: {
						kind: "written",
						plan: applied.value,
						warnings: applied.value.warnings,
					};
		}

		private failed(error: Error, configFile: string): SyncbackOutcome {
			return { kind: "failed", error, configFile };
		}

		private async asked(
			promptService: PromptService,
			plan: SyncbackPlan
		): Promise<boolean> {
			const answer = await promptService.confirm({
				message: `Write and remove files (${counts(plan)})?`,
				initialValue: false,
			});
			return answer === true;
		}

		/** Prints what Rojo's `--list` prints: a line for each file and folder, `Writing` or `Removing`, on stdout. */
		private listChanges(
			logService: LogService,
			plan: SyncbackPlan,
			cwd: string
		): void {
			for (const { kind, file } of plan.listed)
				logService.print(
					defanged(
						`${kind === "write" ? "Writing" : "Removing"} ${path.relative(cwd, file)}`
					)
				);
		}

		/** Warns about what the plan leaves out, which a user should see before saying yes to the rest. */
		private warnLeftOut(
			logService: LogService,
			plan: SyncbackPlan,
			cwd: string
		): void {
			for (const { instance, reason } of plan.unplaced)
				logService.diagnostic(
					warningDiagnostic(
						"syncback.unplaced",
						{ resource: plan.project.file },
						`${instance} is in the place and no folder of the project can take it, so it was left out: ${messageRelativeTo(reason, cwd)}.`
					)
				);
			for (const warning of compiledDiagnostics(plan))
				logService.diagnostic(warning);
		}

		private report(
			logService: LogService,
			outcome: Extract<SyncbackOutcome, { plan: SyncbackPlan }>,
			cwd: string,
			list: boolean,
			mode: SyncbackMode,
			warned: boolean
		): void {
			const { plan } = outcome;
			if (list) this.listChanges(logService, plan, cwd);
			if (!warned) this.warnLeftOut(logService, plan, cwd);
			for (const warning of outcome.warnings)
				logService.diagnostic(warning);
			if (outcome.kind === "written")
				logService.info(
					plan.changes.length === 0
						? "Syncback changed nothing."
						: `Syncback wrote ${plural(plan.changes.length, "change")}.`
				);
			else if (mode !== "dryRun") logService.info("Nothing was written.");
			else
				logService.info(
					plan.changes.length === 0
						? "Syncback would change nothing."
						: `Syncback would change ${plural(plan.changes.length, "file")} (${counts(plan)}).`
				);
		}
	}
);
