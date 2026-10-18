import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_FILE,
	RogenConfig,
	configFileContent,
} from "../config/config.js";
import { WrittenTree } from "../rojo/project-text.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { InitDirectory } from "./init-directory.js";
import {
	InitDecision,
	InitPlan,
	PlannedCommand,
	PlannedScaffold,
	PresentItem,
} from "./init-service.js";

export class InitPlanBuilder {
	private config: PlannedFile | undefined;
	private edited: PlannedFile | undefined;
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
	private readonly edits: string[] = [];
	private readonly present: PresentItem[] = [];
	private readonly commands: PlannedCommand[] = [];
	private scaffold: PlannedScaffold | undefined;

	constructor(
		private readonly directory: InitDirectory,
		private readonly asked: boolean,
		private readonly decided: readonly InitDecision[],
		/** The folder the user ran in, which `configs` are relative to. */
		private readonly cwd: string = directory.path
	) {}

	/** `written`: the tree of the project file the config was lifted from. */
	setConfig(config: RogenConfig, written?: WrittenTree): void {
		this.config = {
			fileName: DEFAULT_CONFIG_FILE,
			content: configFileContent(config, written),
		};
	}

	/** The config of the folder with changes made to it, which is built after it is written. */
	editConfig(file: PlannedFile): void {
		this.edited = file;
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

	/** The tool that writes the project's own files first. */
	setScaffold(scaffold: PlannedScaffold): void {
		this.scaffold = scaffold;
	}

	/** A program to run after the files are written, after those added before it. */
	addCommand(command: PlannedCommand): void {
		this.commands.push(command);
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

	addEdit(...lines: readonly string[]): void {
		this.edits.push(...lines);
	}

	build(): Result<InitPlan, Diagnostic[]> {
		const written = this.config ? [this.config] : [];
		const built = this.edited ? [...written, this.edited] : written;
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
			...(this.scaffold && { scaffold: this.scaffold }),
			files: [
				...built,
				...this.templateFiles,
				...(this.agentFile ? [this.agentFile] : []),
				...(this.claudeImport ? [this.claudeImport] : []),
				...this.hookFiles,
				...(this.toolManifest ? [this.toolManifest] : []),
			],
			directories: [...this.directories],
			commands: [...this.commands],
			configs: built.map(({ fileName }) =>
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
				edits: [
					...(this.agentStep ? [this.agentStep] : []),
					...this.edits,
				],
			},
		});
	}
}
