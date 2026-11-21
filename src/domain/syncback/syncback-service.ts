import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { SyncbackOptions, SyncbackRun } from "./syncback.js";

export interface SyncbackService {
	readonly _serviceBrand: undefined;

	run(
		selection: ConfigSelection,
		options: SyncbackOptions
	): Promise<SyncbackRun>;
}

export const SyncbackService =
	createDecorator<SyncbackService>("syncbackService");
