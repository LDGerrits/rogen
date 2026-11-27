import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { Result } from "../../base/result.js";
import {
	ConfigSelection,
	ReloadableSelection,
} from "../config/config-service.js";
import { SyncbackOptions, SyncbackRun } from "./syncback.js";

export interface SyncbackService {
	readonly _serviceBrand: undefined;

	prepare(
		refs: readonly string[],
		input: string | undefined
	): Promise<
		Result<{ selection: ReloadableSelection; input: string }, Error>
	>;
	run(
		selection: ConfigSelection,
		options: SyncbackOptions
	): Promise<SyncbackRun>;
}

export const SyncbackService =
	createDecorator<SyncbackService>("syncbackService");
