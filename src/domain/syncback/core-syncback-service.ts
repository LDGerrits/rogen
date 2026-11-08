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

/** A plan a dry run lists. */
const listed = (plan: SyncbackPlan): SyncbackOutcome => ({
	kind: "planned",
	plan,
	warnings: [],
	asked: false,
});

/** What a run that confirms does with `plan` when it is not confirmed: declines it, asking only when it changes something; none when it is confirmed. */
async function declined(
	mode: Extract<SyncbackMode, object>,
	plan: SyncbackPlan
): Promise<SyncbackOutcome | undefined> {
	const asked = plan.changes.length > 0;
	if (asked && (await mode.confirm(plan))) return undefined;
	return { kind: "declined", plan, warnings: [], asked };
}

const written = (
	result: SyncbackResult,
	mode: SyncbackMode
): SyncbackOutcome => ({
	kind: "written",
	plan: result,
	warnings: result.warnings,
	asked: mode !== "apply",
});

export class CoreSyncbackService implements SyncbackService {
	declare readonly _serviceBrand: undefined;
	private readonly services: WorkspaceServices;

	constructor(
		configService: ConfigService,
		fileSystemService: FileSystemService,
		writeService: WriteService,
		rojoService: RojoCommandService,
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
				? await this.services.writeService.check(selection)
				: await this.services.writeService.write(selection);
		if (write.failure() || selection.requireValid().isErr())
			return { write, outcome: { kind: "notRun" } };
		const project = this.services.rojoService.choose(selection);
		const outcome = await this.outcomeOf(
			{ selection, project, input, cwd },
			mode
		);
		if (outcome.kind !== "written") return { write, outcome };
		// What syncback added to the config's tree changes the project file.
		const rewritten = await this.services.writeService.write(selection);
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
		const outcome = request.project.isAdopted
			? await this.plainOutcome(request, mode)
			: await this.mirroredOutcome(request, mode);
		return outcome.isErr()
			? {
					kind: "failed",
					error: outcome.error,
					configFile: request.project.file,
				}
			: outcome.value;
	}

	/** A plain Rojo project is planned by Rojo's own dry run, then run as it is. */
	private async plainOutcome(
		request: SyncbackRequest,
		mode: SyncbackMode
	): Promise<Result<SyncbackOutcome, Error>> {
		const rojo = new RojoSyncback(this.services.rojoService, request);
		if (mode !== "apply") {
			const planned = await rojo.plain(true);
			if (planned.isErr()) return planned;
			if (mode === "dryRun") return ok(listed(planned.value));
			const no = await declined(mode, planned.value);
			if (no) return ok(no);
		}
		const result = await rojo.plain(false);
		return result.isErr() ? result : ok(written(result.value, mode));
	}

	/** A Rogen project is planned on a mirror, and its plan written as it was shown, while the project folder stays held. Nothing is written once a shutdown asked to stop, nor when the config, the place or a file the plan touches changed since it was shown. */
	private async mirroredOutcome(
		request: SyncbackRequest,
		mode: SyncbackMode
	): Promise<Result<SyncbackOutcome, Error>> {
		const workspace = await MirrorWorkspace.open(this.services, request);
		if (workspace.isErr()) return workspace;
		return workspace.value.hold<SyncbackOutcome>(async (signal) => {
			const planned = await this.planIn(workspace.value, signal);
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (mode === "dryRun") return ok(listed(plan));
			if (mode !== "apply") {
				const no = await declined(mode, plan);
				if (signal.aborted) return err(stopped());
				if (no) return ok(no);
				if (!(await plan.isCurrent(this.services.fileSystemService)))
					return err(
						new UsageError(
							"The project or the place changed since the list was made, so nothing was written.",
							"Run syncback again."
						)
					);
			}
			// Once writing starts, a stop no longer undoes the run.
			if (signal.aborted) return err(stopped());
			const result = await new PlanWriter(
				this.services.fileSystemService,
				this.services.writeService
			).write(request, plan);
			return ok(written(result, mode));
		});
	}

	private async planIn(
		workspace: MirrorWorkspace,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const ran = await workspace.syncback(signal);
		if (signal.aborted) return err(stopped());
		if (ran.isErr()) return ran;
		const planned = await MirrorPlanner.plan(workspace, ran.value);
		return signal.aborted ? err(stopped()) : planned;
	}
}
