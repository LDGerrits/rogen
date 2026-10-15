import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { SyncbackPlan, SyncbackRequest, SyncbackResult } from "./syncback.js";

/** Brings the changes of a place file back into the files of a project, in two steps so a caller can ask before anything is written. */
export interface SyncbackService {
	readonly _serviceBrand: undefined;

	/** What a run would write and remove, found by a dry run of Rojo's syncback. Writes nothing that stays. Fails when the project's files are not built, when Rojo can't read the place, or when it holds a change syncback can't make. */
	plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>>;

	/** Runs the syncback `plan` described, and puts what Rojo had no folder for where routing puts it. */
	apply(
		plan: SyncbackPlan,
		request: SyncbackRequest
	): Promise<Result<SyncbackResult, Error>>;
}

export const SyncbackService =
	createServiceIdentifier<SyncbackService>("syncbackService");
