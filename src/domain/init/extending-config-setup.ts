import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { configFileName } from "../config/config.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

export interface ExtendingConfigChoices {
	readonly name: string;
}

/** An extending config inherits everything from default; its own file is where variants and excludes go. */
export class ExtendingConfigSetup implements Setup<ExtendingConfigChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions
	) {}

	async ask(): Promise<
		Result<ExtendingConfigChoices | undefined, Diagnostic[]>
	> {
		const { directory, questions } = this;
		const given = directory.givenName;
		if (given) {
			const conflicts = directory.checkFree(
				ConfigSet.extendingFilesOf(given)
			);
			if (conflicts.length > 0) return err(conflicts);
		}
		const name =
			given ??
			(await questions.name(directory, {
				message: "Config name",
				description: `Writes <name>.rogen.json, which extends ${ConfigSet.DEFAULT_FILE}.`,
				filesFor: ConfigSet.extendingFilesOf,
			}));
		return ok(name === undefined ? undefined : { name });
	}

	plan({ name }: ExtendingConfigChoices, builder: InitPlanBuilder): void {
		builder.addConfig(name, {
			extends: ConfigSet.reference(ConfigSet.DEFAULT_FILE),
		});
		builder.addRun(
			ConfigSet.watchCommand([name]),
			ConfigSet.serveCommand(name)
		);
		builder.addEdit(
			`Turn variants on or off under "variants", or add "exclude", in ${configFileName(name)}.`
		);
	}
}
