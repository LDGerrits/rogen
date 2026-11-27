import {
	CancelledError,
	IoError,
	UsageError,
	failureReason,
} from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { WriteService } from "../write/write-service.js";
import {
	ConfigSelection,
	ConfigService,
	ReloadableSelection,
	singleProjectError,
} from "../config/config-service.js";
import {
	SyncbackMode,
	SyncbackOptions,
	SyncbackOutcome,
	SyncbackPlan,
	SyncbackRequest,
	SyncbackResult,
	SyncbackRun,
	placeFileAmong,
} from "./syncback.js";
import { leftOutDiagnostics } from "./left-out-diagnostics.js";
import { SyncbackService } from "./syncback-service.js";
import { MirrorPlan } from "./mirror-plan.js";
import { PlanWriter } from "./plan-writer.js";
import { RojoSyncback } from "./rojo-syncback.js";
import { MirrorPlanner } from "./mirror-planner.js";
import { MirrorWorkspace } from "./mirror-workspace.js";
import { MirrorWorkspaceOpener } from "./mirror-workspace-opener.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

function stopped(): CancelledError {
	return new CancelledError(
		"Syncback stopped before it finished, so nothing was written."
	);
}

const leftOut = (plan: SyncbackPlan, cwd: string) => ({
	plan,
	...leftOutDiagnostics(plan, cwd),
});

const listed = (plan: SyncbackPlan, cwd: string): SyncbackOutcome => ({
	kind: "planned",
	...leftOut(plan, cwd),
	warnings: [],
	asked: false,
});

async function declined(
	mode: Extract<SyncbackMode, object>,
	plan: SyncbackPlan,
	cwd: string
): Promise<SyncbackOutcome | undefined> {
	const asked = plan.changes.length > 0;
	const omitted = leftOut(plan, cwd);
	if (
		asked &&
		(await mode.confirm(plan, [...omitted.unplaced, ...omitted.compiled]))
	)
		return undefined;
	return { kind: "declined", ...omitted, warnings: [], asked };
}

const written = (
	result: SyncbackResult,
	mode: SyncbackMode,
	cwd: string
): SyncbackOutcome => ({
	kind: "written",
	...leftOut(result, cwd),
	warnings: result.warnings,
	asked: mode !== "apply",
});

export class CoreSyncbackService implements SyncbackService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ConfigService private readonly configService: ConfigService,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@WriteService private readonly writeService: WriteService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	async prepare(
		refs: readonly string[],
		input: string | undefined
	): Promise<
		Result<{ selection: ReloadableSelection; input: string }, Error>
	> {
		const tooMany = singleProjectError("syncback", refs);
		if (tooMany) return err(tooMany);
		if (input === undefined) {
			const placeFile = placeFileAmong(refs);
			return err(
				new UsageError(
					"--input names the place or model file to bring changes from, and Rojo needs it.",
					placeFile &&
						`'${placeFile}' is a place or model file, not a project: pass it as --input ${placeFile}.`
				)
			);
		}
		const selection = await this.configService.select(refs);
		if (selection.isErr()) return selection;
		return ok({ selection: selection.value, input });
	}

	async run(
		selection: ConfigSelection,
		{ input, cwd, mode }: SyncbackOptions
	): Promise<SyncbackRun> {
		const write =
			mode === "dryRun"
				? await this.writeService.check(selection)
				: await this.writeService.write(selection);
		const valid = selection.requireValid();
		if (write.failure() || valid.isErr())
			return {
				write,
				outcome: { kind: "notRun" },
				changed: write.changed,
			};
		const [project] = valid.value;
		const outcome = await this.outcomeOf(
			{ selection, project, input, cwd },
			mode
		);
		if (outcome.kind !== "written")
			return { write, outcome, changed: write.changed };
		const afterSyncback = await this.writeService.write(selection);
		const final =
			afterSyncback.failure() || afterSyncback.changed
				? afterSyncback
				: write;
		return {
			write: final,
			outcome,
			changed: final.changed || outcome.plan.changes.length > 0,
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
			if (mode === "dryRun")
				return ok(listed(planned.value, request.cwd));
			const no = await declined(mode, planned.value, request.cwd);
			if (no) return ok(no);
		}
		const result = await rojo.plain(false);
		return result.isErr()
			? result
			: ok(written(result.value, mode, request.cwd));
	}

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
			if (mode === "dryRun") return ok(listed(plan, request.cwd));
			if (mode !== "apply") {
				const no = await declined(mode, plan, request.cwd);
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
			return this.writeUnlessStopped(request, plan, mode, signal);
		});
	}

	private async writeUnlessStopped(
		request: SyncbackRequest,
		plan: MirrorPlan,
		mode: SyncbackMode,
		signal: AbortSignal
	): Promise<Result<SyncbackOutcome, Error>> {
		if (signal.aborted) return err(stopped());
		const result = await this.instantiationService
			.createInstance(PlanWriter)
			.write(request, plan);
		return ok(written(result, mode, request.cwd));
	}

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
