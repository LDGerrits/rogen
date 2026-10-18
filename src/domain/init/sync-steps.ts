import { DEFAULT_PROJECT_FILE } from "../config/config.js";
import { Darklua, Language } from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

export class SyncSteps {
	constructor(
		readonly language: Language,
		readonly darklua: Darklua | undefined,
		/** What compiles the code when the project's own script does, such as the `watch` script of its `package.json`. */
		private readonly compileCommand?: string
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
			luauLsp,
		}: {
			readonly processed: readonly string[];
			readonly syncPath?: string;
			/** Whether luau-lsp is set up here, which keeps `sourcemap.json` current. */
			readonly luauLsp: boolean;
		}
	): void {
		const { darklua, language } = this;
		builder.addRun(
			...(language.compiler
				? [this.compileCommand ?? language.compiler.compileCommand]
				: []),
			...(darklua && syncPath
				? darklua.processCommands(directory, processed, syncPath)
				: []),
			"rogen serve"
		);
		if (darklua && !language.compiler && !luauLsp) {
			builder.addEdit(
				`Darklua reads sourcemap.json. Keep it current from ${DEFAULT_PROJECT_FILE} in a terminal of its own: ${darklua.sourcemapCommand()}`
			);
		}
	}
}
