import path from "path";
import { toPosix } from "../../base/path.js";
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
import { InitDecision, InitPlan, PresentItem } from "./init-service.js";

export class InitPlanBuilder {
	private config: PlannedFile | undefined;
	private agentFile: PlannedFile | undefined;
	private agentStep: string | undefined;
	private claudeImport: PlannedFile | undefined;
	private hookFiles: readonly PlannedFile[] = [];
	private toolManifest: PlannedFile | undefined;
	private readonly templateFiles: PlannedFile[] = [];
	private gitInit = false;
	private readonly directories = new Set<string>();
	private readonly notes: string[] = [];
	private readonly warnings: Diagnostic[] = [];
	private liftedFrom: string | undefined;
	private readonly setup = new Set<string>();
	private readonly run: string[] = [];
	private readonly darklua: string[] = [];
	private readonly edits: string[] = [];
	private readonly present: PresentItem[] = [];

	constructor(
		private readonly directory: InitDirectory,
		private readonly asked: boolean,
		private readonly decided: readonly InitDecision[],
		/** The folder the user ran in, which `configs` are relative to. */
		private readonly cwd: string = directory.path
	) {}

	setConfig(config: RogenConfig): void {
		this.config = {
			fileName: DEFAULT_CONFIG_FILE,
			content: configFileContent(config),
		};
	}

	/** `claudeImport`: also write the `CLAUDE.md` that points Claude Code at the agent file. */
	addAgentFile(file: AgentFile, claudeImport = false): void {
		this.agentFile = file.planned;
		this.agentStep = file.nextStep;
		this.claudeImport = claudeImport ? AgentFile.CLAUDE_IMPORT : undefined;
	}

	addAgentHook(hooks: AgentHooks): void {
		this.hookFiles = hooks.files;
		this.addSetup(...hooks.setup);
	}

	addToolManifest(file: PlannedFile): void {
		this.toolManifest = file;
	}

	/** A file of the project's template, which is written after the config. */
	addFile(file: PlannedFile): void {
		this.templateFiles.push(file);
	}

	/** Asks for a `git init` in the folder, which the plan drops where a work tree holds it already. */
	requestGitInit(): void {
		this.gitInit = true;
	}

	addPresent(...items: readonly PresentItem[]): void {
		this.present.push(...items);
	}

	addDirectory(directory: string): void {
		this.directories.add(directory);
	}

	addNote(note: string): void {
		this.notes.push(note);
	}

	/** The project file whose tree went into the config; init leaves it as it was. */
	setLiftedFrom(fileName: string): void {
		this.liftedFrom = fileName;
	}

	addWarning(warning: Diagnostic): void {
		this.warnings.push(warning);
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
			decided: this.decided,
			present: [...this.present],
			gitInit: this.gitInit,
			files: [
				...written,
				...this.templateFiles,
				...(this.agentFile ? [this.agentFile] : []),
				...(this.claudeImport ? [this.claudeImport] : []),
				...this.hookFiles,
				...(this.toolManifest ? [this.toolManifest] : []),
			],
			directories: [...this.directories],
			configs: written.map(({ fileName }) =>
				toPosix(
					path.relative(
						this.cwd,
						path.join(this.directory.path, fileName)
					)
				)
			),
			notes: [...this.notes],
			warnings: [...this.warnings],
			...(this.liftedFrom !== undefined && {
				liftedFrom: this.liftedFrom,
			}),
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
