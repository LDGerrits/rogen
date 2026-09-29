import { DEFAULT_CONFIG_STEM } from "../config/config-discovery.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";

export type { PlannedFile };

/** What to do after `init`, grouped so a plan can be combined with its places'. */
export interface NextSteps {
	/** One-time edits before anything runs. */
	readonly setup: readonly string[];
	/** Long-running commands, one terminal each. */
	readonly run: readonly string[];
	/** Commands that have Darklua process the code into the sync dir. */
	readonly darklua: readonly string[];
	/** Pointers to what to change in the written files. */
	readonly edits: readonly string[];
}

/** Everything `init` writes and says, decided before anything is written. */
export interface InitPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	/** A compiler's own per-place config, written after the configs. */
	readonly compilerConfigs: readonly PlannedFile[];
	/** Lines printed before the files are written. */
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
}

/** Every file the plan writes, in the order it writes them. */
export const plannedFiles = (plan: InitPlan): readonly PlannedFile[] => [
	...(plan.template ? [plan.template] : []),
	...plan.configs,
	...plan.compilerConfigs,
];

export const watchCommand = (names: readonly string[]): string =>
	names.length === 1 && names[0] === DEFAULT_CONFIG_STEM
		? "rogen watch"
		: `rogen watch ${names.join(" ")}`;

export const tagsStep = (language: Language, configName: string): string =>
	`Add tags under "tags" in ${configName} to swap in variants like Analytics.mock.${language.extension}.`;
