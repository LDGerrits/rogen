import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_FILE,
	RogenConfig,
	configFileContent,
} from "../config/config.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { AgentFile } from "./agent-file.js";
import { AgentHooks } from "./agent-hooks.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";

/** Collects what the setups write and say, and checks it against the directory once. */
export class InitPlanBuilder {
	private config: PlannedFile | undefined;
	private agentFile: PlannedFile | undefined;
	private agentStep: string | undefined;
	private hookFiles: readonly PlannedFile[] = [];
	private readonly directories = new Set<string>();
	private readonly notes: string[] = [];
	private readonly setup = new Set<string>();
	private readonly run: string[] = [];
	private readonly darklua: string[] = [];
	private readonly edits: string[] = [];

	constructor(
		private readonly directory: InitDirectory,
		private readonly asked: boolean
	) {}

	/** The config the project starts with. */
	setConfig(config: RogenConfig): void {
		this.config = {
			fileName: DEFAULT_CONFIG_FILE,
			content: configFileContent(config),
		};
	}

	/** Rogen's rules for agents, written last; the one existing file `init` adds to. */
	addAgentFile(file: AgentFile): void {
		this.agentFile = file.planned;
		this.agentStep = file.nextStep;
	}

	/** The hook's script and the agents' files, written after the agent rules. */
	addAgentHook(hooks: AgentHooks): void {
		this.hookFiles = hooks.files;
		this.addSetup(...hooks.setup);
	}

	/** A source path this run chose, which `write` creates if it isn't there. */
	addDirectory(directory: string): void {
		this.directories.add(directory);
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

	/** Fails when the config it would write already exists. */
	build(): Result<InitPlan, Diagnostic[]> {
		const written = this.config ? [this.config] : [];
		const taken = this.directory.checkFree(
			written.map(({ fileName }) => fileName)
		);
		if (taken.length > 0) return err(taken);

		return ok({
			directory: this.directory.path,
			asked: this.asked,
			files: [
				...written,
				...(this.agentFile ? [this.agentFile] : []),
				...this.hookFiles,
			],
			directories: [...this.directories],
			configs: written.map(({ fileName }) => fileName),
			notes: [...this.notes],
			nextSteps: {
				setup: [...this.setup],
				run: [...this.run],
				darklua: [...this.darklua],
				// Before the edits that always come last.
				edits: [
					...(this.agentStep ? [this.agentStep] : []),
					...this.edits,
				],
			},
		});
	}
}
