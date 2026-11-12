import {
	CancelledError,
	IoError,
	UsageError,
	failureReason,
} from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { WriteService } from "../write/write-service.js";
import { didWrite } from "../write/write.js";
import { ConfigSelection } from "../config/config-service.js";
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
import { MirrorWorkspace } from "./mirror-workspace.js";
import { MirrorWorkspaceOpener } from "./mirror-workspace-opener.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

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

	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@WriteService private readonly writeService: WriteService,
		@RojoCommandService private readonly rojoService: RojoCommandService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

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
		const rojo = this.instantiationService.createInstance(
			RojoSyncback,
			request
		);
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
		const workspace = await this.instantiationService
			.createInstance(MirrorWorkspaceOpener)
			.open(request);
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
			const result = await this.instantiationService
				.createInstance(PlanWriter)
				.write(request, plan);
			return ok(written(result, mode));
		});
	}

	/** The plan of a run on the mirror; a file the run can't read fails it, or stops it when a shutdown took the mirror away. */
	private async planIn(
		workspace: MirrorWorkspace,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const planned = await tryWithAsync(() =>
			this.planned(workspace, signal)
		);
		if (planned.isOk()) return planned.value;
		return err(
			signal.aborted
				? stopped()
				: new IoError(
						`Syncback could not finish: ${failureReason(planned.error)}.`,
						"Run syncback again."
					)
		);
	}

	private async planned(
		workspace: MirrorWorkspace,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const ran = await workspace.syncback(signal);
		if (signal.aborted) return err(stopped());
		if (ran.isErr()) return ran;
		const planned = await this.instantiationService
			.createInstance(MirrorPlanner, workspace)
			.plan(ran.value);
		return signal.aborted ? err(stopped()) : planned;
	}
}
