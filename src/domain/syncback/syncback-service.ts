import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { SyncbackOptions, SyncbackRun } from "./syncback.js";

/** Brings the changes of a place file back into the files of a project. */
export interface SyncbackService {
	readonly _serviceBrand: undefined;

	/** Writes the project file, or only checks it in a dry run, then runs the syncback on the project the selection names, as the mode says; none when the project has errors. After a syncback that wrote, writes the project file again. */
	run(
		selection: ConfigSelection,
		options: SyncbackOptions
	): Promise<SyncbackRun>;
}

export const SyncbackService =
	createServiceIdentifier<SyncbackService>("syncbackService");
