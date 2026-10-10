import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DEFAULT_CONFIG_FILE, configFileName } from "../config/config.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

export interface ExtendingConfigChoices {
	readonly name: string;
}

/** An extending config inherits everything from default; its own file is where variants and excludes go. Like any named config, it gets a synced twin when Darklua processes source-rooted code. */
export class ExtendingConfigSetup implements Setup<ExtendingConfigChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions
	) {}

	async ask(): Promise<
		Result<ExtendingConfigChoices | undefined, Diagnostic[]>
	> {
		const { directory, questions } = this;
		const named = await questions.givenOrAskedName(directory, {
			message: "Config name",
			description: `Writes <name>.rogen.json, which extends ${DEFAULT_CONFIG_FILE}.`,
			filesFor: (candidate) =>
				ConfigSet.in(directory.workspace, candidate).writtenFiles,
		});
		if (named.isErr()) return named;
		const name = named.value;
		return ok(name === undefined ? undefined : { name });
	}

	plan({ name }: ExtendingConfigChoices, builder: InitPlanBuilder): void {
		const configSet = ConfigSet.in(this.directory.workspace, name);
		const { base } = this.directory;
		// A compiler's sync dir is inherited from default; only a synced twin adds one, where default's project syncs from.
		configSet.planConfigs(
			builder,
			{ extends: ConfigSet.reference(DEFAULT_CONFIG_FILE) },
			configSet.sourced
				? ((base?.isOk() ? base.value.syncDir : undefined) ??
						configSet.syncDir)
				: undefined
		);
		builder.addRun(configSet.serveCommand);
		builder.addEdit(
			`Add "exclude" or "modes", or pin a "mode", in ${configFileName(name)}.`
		);
	}
}
