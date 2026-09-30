import { formatJsonFile } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RogenConfig, SCHEMA_URL, configFileName } from "../config/config.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";

/** One kind of thing `init` can add: it asks what it needs, then says what it writes. */
export interface Setup {
	/** Asks its questions; `ok(false)` when the user cancelled. Fails when a file it would write already exists. */
	ask(): Promise<Result<boolean, Diagnostic[]>>;
	/** Adds what it writes and says. Only once `ask` has resolved. */
	plan(builder: InitPlanBuilder): void;
}

/** Collects what the setups write and say, and checks it against the directory once. */
export class InitPlanBuilder {
	private template: PlannedFile | undefined;
	private readonly configs: PlannedFile[] = [];
	private readonly compilerConfigs: PlannedFile[] = [];
	private readonly notes: string[] = [];
	private readonly setup = new Set<string>();
	private readonly run: string[] = [];
	private readonly darklua: string[] = [];
	private readonly edits: string[] = [];

	constructor(private readonly directory: InitDirectory) {}

	setTemplate(file: PlannedFile): void {
		this.template = file;
	}

	/** A config named `<stem>.rogen.json`, written after the ones added before it. */
	addConfig(stem: string, config: RogenConfig): void {
		this.configs.push({
			fileName: configFileName(stem),
			content: formatJsonFile({ $schema: SCHEMA_URL, ...config }),
		});
	}

	/** A compiler's own per-place config, written after every config. */
	addCompilerFile(file: PlannedFile): void {
		this.compilerConfigs.push(file);
	}

	addNote(note: string): void {
		this.notes.push(note);
	}

	/** One-time edits; the same edit from two setups is said once. */
	addSetup(...lines: readonly string[]): void {
		for (const line of lines) this.setup.add(line);
	}

	/** Long-running commands, each for its own terminal. */
	addRun(...commands: readonly string[]): void {
		this.run.push(...commands);
	}

	addDarkluaCommands(...commands: readonly string[]): void {
		this.darklua.push(...commands);
	}

	addEdit(...lines: readonly string[]): void {
		this.edits.push(...lines);
	}

	/** Fails when a config or compiler file it would write already exists. */
	build(): Result<InitPlan, Diagnostic[]> {
		const written = [...this.configs, ...this.compilerConfigs];
		const taken = this.directory.checkFree(
			written.map(({ fileName }) => fileName)
		);
		if (taken.length > 0) return err(taken);

		return ok({
			directory: this.directory.path,
			files: [...(this.template ? [this.template] : []), ...written],
			notes: [...this.notes],
			nextSteps: {
				setup: [...this.setup],
				run: [...this.run],
				darklua: [...this.darklua],
				edits: [...this.edits],
			},
		});
	}
}
