import { DEFAULT_PROJECT_FILE } from "../config/config.js";
import { Darklua, Language } from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

export class SyncSteps {
	constructor(
		readonly language: Language,
		readonly darklua: Darklua | undefined
	) {}

	get syncPath(): string | undefined {
		return this.darklua
			? this.darklua.defaultSyncPath
			: this.language.compiler?.outDir;
	}

	plan(
		builder: InitPlanBuilder,
		directory: string,
		{
			processed,
			syncPath,
		}: {
			readonly processed: readonly string[];
			readonly syncPath?: string;
		}
	): void {
		const { darklua, language } = this;
		builder.addRun(
			...(language.compiler ? [language.compiler.compileCommand] : []),
			"rogen serve"
		);
		if (darklua && syncPath) {
			builder.addDarkluaCommands(
				...darklua.processCommands(directory, processed, syncPath)
			);
		}
		if (darklua && !language.compiler) {
			builder.addEdit(
				`Darklua reads sourcemap.json, which luau-lsp keeps current from ${DEFAULT_PROJECT_FILE}. Without luau-lsp, run: ${darklua.sourcemapCommand(DEFAULT_PROJECT_FILE)}`
			);
		}
	}
}
