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

	get compiledPath(): string | undefined {
		return this.darklua
			? this.darklua.defaultCompiledPath
			: this.language.compiler?.outDir;
	}

	plan(
		builder: InitPlanBuilder,
		directory: string,
		{
			processed,
			compiledPath,
			luauLsp,
		}: {
			readonly processed: readonly string[];
			readonly compiledPath?: string;
			/** Whether luau-lsp is set up here, which keeps `sourcemap.json` current. */
			readonly luauLsp: boolean;
		}
	): void {
		const { darklua, language } = this;
		builder.addRun(
			...(language.compiler
				? [this.compileCommand ?? language.compiler.compileCommand]
				: []),
			...(darklua && compiledPath
				? darklua.processCommands(directory, processed, compiledPath)
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
