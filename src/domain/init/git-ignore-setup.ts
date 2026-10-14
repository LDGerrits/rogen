import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { GitIgnore } from "./git-ignore.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

/** Whether the files Rogen writes go in `.gitignore`, asked unless the folder is in no git repository. */
export class GitIgnoreSetup implements Setup<boolean> {
	constructor(
		private readonly gitIgnore: GitIgnore,
		private readonly inRepo: boolean,
		private readonly questions: InitQuestions
	) {}

	async ask(): Promise<Result<boolean | undefined, Diagnostic[]>> {
		if (!this.inRepo) return ok(false);
		return ok(await this.questions.addGitIgnore());
	}

	plan(add: boolean, builder: InitPlanBuilder): void {
		if (add) builder.addGitIgnore(this.gitIgnore);
	}
}
