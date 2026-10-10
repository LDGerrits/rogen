import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DEFAULT_CONFIG_FILE, configFileName } from "../config/config.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

export interface ExtendingConfigChoices {
	readonly name: string;
}

/** An extending config inherits everything from default; its own file is where variants and excludes go. Like any named config, it gets a synced twin when Darklua processes source-rooted code (ADR-0016). */
export class ExtendingConfigSetup implements Setup<ExtendingConfigChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions
	) {}

	private configSetOf(name: string): ConfigSet {
		const { workspace } = this.directory;
		return new ConfigSet(
			name,
			workspace.language,
			workspace.detectedDarklua
		);
	}

	/** The configs it writes and their project files, none of which may exist. */
	private filesOf(name: string): string[] {
		const configSet = this.configSetOf(name);
		return [...configSet.configFiles, ...configSet.outputFiles];
	}

	async ask(): Promise<
		Result<ExtendingConfigChoices | undefined, Diagnostic[]>
	> {
		const { directory, questions } = this;
		const given = directory.givenName;
		if (given) {
			const conflicts = directory.checkFree(this.filesOf(given));
			if (conflicts.length > 0) return err(conflicts);
		}
		const name =
			given ??
			(await questions.name(directory, {
				message: "Config name",
				description: `Writes <name>.rogen.json, which extends ${DEFAULT_CONFIG_FILE}.`,
				filesFor: (candidate) => this.filesOf(candidate),
			}));
		return ok(name === undefined ? undefined : { name });
	}

	plan({ name }: ExtendingConfigChoices, builder: InitPlanBuilder): void {
		const configSet = this.configSetOf(name);
		// A compiler's sync dir is inherited from default; only a synced twin adds one.
		configSet.planConfigs(
			builder,
			{ extends: ConfigSet.reference(DEFAULT_CONFIG_FILE) },
			configSet.sourced ? configSet.syncDir : undefined
		);
		builder.addRun(configSet.serveCommand);
		builder.addEdit(
			`Add "exclude" or "modes", or pin a "mode", in ${configFileName(name)}.`
		);
	}
}
