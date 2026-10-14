import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_FILE,
	RogenConfig,
	configFileContent,
} from "../config/config.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";

export class InitPlanBuilder {
	private config: PlannedFile | undefined;
	private agentFile: PlannedFile | undefined;
	private agentStep: string | undefined;
	private hookFiles: readonly PlannedFile[] = [];
	private toolManifest: PlannedFile | undefined;
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

	setConfig(config: RogenConfig): void {
		this.config = {
			fileName: DEFAULT_CONFIG_FILE,
			content: configFileContent(config),
		};
	}

	addAgentFile(file: AgentFile): void {
		this.agentFile = file.planned;
		this.agentStep = file.nextStep;
	}

	addAgentHook(hooks: AgentHooks): void {
		this.hookFiles = hooks.files;
		this.addSetup(...hooks.setup);
	}

	addToolManifest(file: PlannedFile): void {
		this.toolManifest = file;
	}

	addDirectory(directory: string): void {
		this.directories.add(directory);
	}

	addNote(note: string): void {
		this.notes.push(note);
	}

	/** The same edit from two setups is said once. */
	addSetup(...lines: readonly string[]): void {
		for (const line of lines) this.setup.add(line);
	}

	addRun(...commands: readonly string[]): void {
		this.run.push(...commands);
	}

	addDarkluaCommands(...commands: readonly string[]): void {
		this.darklua.push(...commands);
	}

	addEdit(...lines: readonly string[]): void {
		this.edits.push(...lines);
	}

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
				...(this.toolManifest ? [this.toolManifest] : []),
			],
			directories: [...this.directories],
			configs: written.map(({ fileName }) => fileName),
			notes: [...this.notes],
			nextSteps: {
				setup: [...this.setup],
				run: [...this.run],
				darklua: [...this.darklua],
				edits: [
					...(this.agentStep ? [this.agentStep] : []),
					...this.edits,
				],
			},
		});
	}
}
