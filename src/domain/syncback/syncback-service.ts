import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { SyncbackPlan, SyncbackRequest, SyncbackResult } from "./syncback.js";

/** Brings the changes of a place file back into the files of a project, in two steps so a caller can ask before anything is written. */
export interface SyncbackService {
	readonly _serviceBrand: undefined;

	/** What a run would write and remove, found by a dry run of Rojo's syncback. Writes nothing that stays. Fails when the project's files can't be written, when Rojo can't read the place, or when it holds a change syncback can't make. */
	plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>>;

	/** Runs the syncback, and puts what Rojo had no folder for where routing puts it. Given `confirm`, it plans first and writes the plan only when `confirm` says yes, and nothing, as `undefined`, when it says no; nothing either if the config, the place or a file the plan touches changed meanwhile. The project folder stays held from the plan to the last write. New files are written before old ones are removed. */
	apply(request: SyncbackRequest): Promise<Result<SyncbackResult, Error>>;
	apply(
		request: SyncbackRequest,
		confirm: (plan: SyncbackPlan) => Promise<boolean>
	): Promise<Result<SyncbackResult | undefined, Error>>;
}

export const SyncbackService =
	createServiceIdentifier<SyncbackService>("syncbackService");
