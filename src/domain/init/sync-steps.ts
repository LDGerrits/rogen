import { DEFAULT_PROJECT_FILE } from "../config/config.js";
import { Darklua, Language } from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** How the code reaches Rojo in the language and Darklua setup a project uses: the sync path it writes, and the commands that build and serve it. */
export class SyncSteps {
	constructor(
		readonly language: Language,
		/** Darklua when it processes the code, else `undefined`. */
		readonly darklua: Darklua | undefined
	) {}

	/** The sync path written for a config: Darklua's output, else the compiler's, else none. */
	get syncPath(): string | undefined {
		return this.darklua
			? this.darklua.defaultSyncPath
			: this.language.compiler?.outDir;
	}

	/** The commands that build and serve the project: a compiler's own, then serving, then what Darklua needs to read `processed` into `syncPath`. */
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
		// A compiler's output doesn't require by string, so Darklua needs no sourcemap of it.
		if (darklua && !language.compiler) {
			builder.addEdit(
				`Darklua reads sourcemap.json, which luau-lsp keeps current from ${DEFAULT_PROJECT_FILE}. Without luau-lsp, run: ${darklua.sourcemapCommand(DEFAULT_PROJECT_FILE)}`
			);
		}
	}
}
