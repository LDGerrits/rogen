import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { configFileName } from "../config/config.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

/** A variant inherits everything from default; its own file is where tags and excludes go. */
export class VariantSetup implements Setup {
	private name: string | undefined;

	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions
	) {}

	async ask(): Promise<Result<boolean, Diagnostic[]>> {
		const { directory, questions } = this;
		const given = directory.givenName;
		if (given) {
			const conflicts = directory.checkFree(
				ConfigSet.variantFilesOf(given)
			);
			if (conflicts.length > 0) return err(conflicts);
		}
		this.name =
			given ??
			(await questions.name(directory, {
				message: "Variant name",
				description: `Writes <name>.rogen.json, which extends ${ConfigSet.DEFAULT_FILE}.`,
				filesFor: ConfigSet.variantFilesOf,
			}));
		return ok(this.name !== undefined);
	}

	plan(builder: InitPlanBuilder): void {
		if (this.name === undefined) {
			throw new Error("A variant is planned only once it was asked.");
		}
		const { name } = this;
		builder.addConfig(name, {
			extends: ConfigSet.reference(ConfigSet.DEFAULT_FILE),
		});
		builder.addRun(
			ConfigSet.watchCommand([name]),
			ConfigSet.serveCommand(name)
		);
		builder.addEdit(
			`Turn tags on or off under "tags", or add "exclude", in ${configFileName(name)}.`
		);
	}
}
