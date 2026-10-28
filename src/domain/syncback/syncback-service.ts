import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { SyncbackPlan, SyncbackRequest, SyncbackResult } from "./syncback.js";

/** Brings the changes of a place file back into the files of a project, in two steps so a caller can ask before anything is written. */
export interface SyncbackService {
	readonly _serviceBrand: undefined;

	/** The first of `names`, the project arguments of a command line, that is a place or model file. */
	placeFileAmong(names: readonly string[]): string | undefined;

	/** What a run would write and remove, found by a dry run of Rojo's syncback. Writes nothing that stays. Fails when the project's files can't be written, when Rojo can't read the place, or when it holds a change syncback can't make. */
	plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>>;

	/** Runs the syncback, and puts what Rojo had no folder for where routing puts it. Given the plan the user was shown, it plans again first and writes nothing if the run would differ. */
	apply(
		request: SyncbackRequest,
		confirmed?: SyncbackPlan
	): Promise<Result<SyncbackResult, Error>>;
}

export const SyncbackService =
	createServiceIdentifier<SyncbackService>("syncbackService");
