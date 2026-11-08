import { CancelledError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { WriteService } from "../write/write-service.js";
import { didWrite } from "../write/write.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { RojoCommandService } from "../runner/rojo-command-service.js";
import {
	SyncbackMode,
	SyncbackOptions,
	SyncbackOutcome,
	SyncbackPlan,
	SyncbackRequest,
	SyncbackResult,
	SyncbackRun,
} from "./syncback.js";
import { SyncbackService } from "./syncback-service.js";
import { MirrorPlan } from "./mirror-plan.js";
import { PlanWriter } from "./plan-writer.js";
import { RojoSyncback } from "./rojo-syncback.js";
import { MirrorPlanner } from "./mirror-planner.js";
import { MirrorWorkspace, WorkspaceServices } from "./mirror-workspace.js";

/** The error of a run stopped before it wrote anything. */
function stopped(): CancelledError {
	return new CancelledError(
		"Syncback stopped before it finished, so nothing was written."
	);
}

export class CoreSyncbackService implements SyncbackService {
	declare readonly _serviceBrand: undefined;
	private readonly services: WorkspaceServices;

	constructor(
		configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly writeService: WriteService,
		private readonly rojoService: RojoCommandService,
		environmentService: EnvironmentService,
		processService: ProcessService,
		lifecycleService: LifecycleService
	) {
		this.services = {
			configService,
			fileSystemService,
			writeService,
			rojoService,
			environmentService,
			processService,
			lifecycleService,
		};
	}

	async run(
		selection: ConfigSelection,
		{ input, cwd, mode }: SyncbackOptions
	): Promise<SyncbackRun> {
		const write =
			mode === "dryRun"
				? await this.writeService.check(selection)
				: await this.writeService.write(selection);
		if (write.failure() || selection.requireValid().isErr())
			return { write, outcome: { kind: "notRun" } };
		const project = this.rojoService.choose(selection);
		const outcome = await this.outcomeOf(
			{ selection, project, input, cwd },
			mode
		);
		if (outcome.kind !== "written") return { write, outcome };
		// What syncback added to the config's tree changes the project file.
		const rewritten = await this.writeService.write(selection);
		return {
			write:
				rewritten.failure() || rewritten.outcomes.some(didWrite)
					? rewritten
					: write,
			outcome,
		};
	}

	private async outcomeOf(
		request: SyncbackRequest,
		mode: SyncbackMode
	): Promise<SyncbackOutcome> {
		const failed = (error: Error): SyncbackOutcome => ({
			kind: "failed",
			error,
			configFile: request.project.file,
		});
		if (mode === "dryRun") {
			const planned = await this.plan(request);
			return planned.isErr()
				? failed(planned.error)
				: {
						kind: "planned",
						plan: planned.value,
						warnings: [],
						asked: false,
					};
		}
		if (mode === "apply") {
			const applied = await this.apply(request);
			return applied.isErr()
				? failed(applied.error)
				: {
						kind: "written",
						plan: applied.value,
						warnings: applied.value.warnings,
						asked: false,
					};
		}
		let shown: SyncbackPlan | undefined;
		const applied = await this.apply(request, async (plan) => {
			shown = plan;
			return plan.changes.length > 0 && (await mode.confirm(plan));
		});
		if (applied.isErr()) return failed(applied.error);
		if (applied.value)
			return {
				kind: "written",
				plan: applied.value,
				warnings: applied.value.warnings,
				asked: true,
			};
		const plan = shown as SyncbackPlan;
		return {
			kind: "declined",
			plan,
			warnings: [],
			asked: plan.changes.length > 0,
		};
	}

	/** What a run would write and remove, found by a dry run of Rojo's syncback. Writes nothing that stays. Fails when the project's files can't be written, when Rojo can't read the place, or when it holds a change syncback can't make. */
	async plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>> {
		if (request.project.isAdopted)
			return new RojoSyncback(this.rojoService, request).plain(true);
		const workspace = await MirrorWorkspace.open(this.services, request);
		if (workspace.isErr()) return workspace;
		return workspace.value.hold<SyncbackPlan>((signal) =>
			this.planIn(request, workspace.value, signal)
		);
	}

	/** Runs the syncback, and puts what Rojo had no folder for where routing puts it. Given `confirm`, it plans first and writes the plan only when `confirm` says yes, and nothing, as `undefined`, when it says no; nothing either if the config, the place or a file the plan touches changed meanwhile. The project folder stays held from the plan to the last write. New files are written before old ones are removed. */
	apply(request: SyncbackRequest): Promise<Result<SyncbackResult, Error>>;
	apply(
		request: SyncbackRequest,
		confirm: (plan: SyncbackPlan) => Promise<boolean>
	): Promise<Result<SyncbackResult | undefined, Error>>;
	async apply(
		request: SyncbackRequest,
		confirm?: (plan: SyncbackPlan) => Promise<boolean>
	): Promise<Result<SyncbackResult | undefined, Error>> {
		if (request.project.isAdopted) {
			if (confirm) {
				const planned = await new RojoSyncback(
					this.rojoService,
					request
				).plain(true);
				if (planned.isErr()) return planned;
				if (!(await confirm(planned.value))) return ok(undefined);
			}
			return new RojoSyncback(this.rojoService, request).plain(false);
		}
		const workspace = await MirrorWorkspace.open(this.services, request);
		if (workspace.isErr()) return workspace;
		return workspace.value.hold<SyncbackResult | undefined>(
			async (signal) => {
				const planned = await this.planIn(
					request,
					workspace.value,
					signal
				);
				if (planned.isErr()) return planned;
				const plan = planned.value;
				if (confirm) {
					const confirmed = await confirm(plan);
					if (signal.aborted) return err(stopped());
					if (!confirmed) return ok(undefined);
					if (!(await plan.isCurrent(this.fileSystemService)))
						return err(
							new UsageError(
								"The project or the place changed since the list was made, so nothing was written.",
								"Run syncback again."
							)
						);
				}
				// Once writing starts, a stop no longer undoes the run.
				if (signal.aborted) return err(stopped());
				return ok(
					await new PlanWriter(
						this.fileSystemService,
						this.writeService
					).write(request, plan)
				);
			}
		);
	}

	private async planIn(
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const ran = await workspace.syncback(signal);
		if (signal.aborted) return err(stopped());
		if (ran.isErr()) return ran;
		const settled = await MirrorPlanner.plan(
			this.fileSystemService,
			request,
			workspace,
			ran.value
		);
		return signal.aborted ? err(stopped()) : settled;
	}
}
