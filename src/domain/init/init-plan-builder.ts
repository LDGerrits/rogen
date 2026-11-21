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
	InitAction,
	InitDecision,
	InitPlan,
	PlannedCommand,
	PlannedScaffold,
	SummaryRow,
} from "./init-service.js";
import { PlannedMove } from "./project-migration.js";

function setUpMarkersLast<T>(
	others: readonly T[],
	setUpMarkers: readonly T[]
): T[] {
	return [...others, ...setUpMarkers];
}

export class InitPlanBuilder {
	private readonly configFiles: {
		file: PlannedFile;
		writesProjectFile: boolean;
	}[] = [];
	private agentFile: PlannedFile | undefined;
	private agentImports: readonly PlannedFile[] = [];
	private hookFiles: readonly PlannedFile[] = [];
	private toolManifest: PlannedFile | undefined;
	private readonly templateFiles: PlannedFile[] = [];
	private readonly moves: PlannedMove[] = [];
	private readonly setAsides: PlannedMove[] = [];
	private gitInit = false;
	private readonly directories = new Set<string>();
	private readonly notes: string[] = [];
	private readonly warnings: Diagnostic[] = [];
	private liftedFrom: string | undefined;
	private action: InitAction = "create";
	private readonly setup = new Set<string>();
	private readonly run: string[] = [];
	private readonly edits: string[] = [];
	private readonly commands: PlannedCommand[] = [];
	private scaffold: PlannedScaffold | undefined;
	private readonly summary: SummaryRow[] = [];

	constructor(
		private readonly directory: InitDirectory,
		private readonly asked: boolean,
		private readonly decided: readonly InitDecision[],
		private readonly cwd: string = directory.path
	) {}

	setConfig(
		config: RogenConfig,
		written?: WrittenTree,
		fileName = DEFAULT_CONFIG_FILE,
		writesProjectFile = true
	): void {
		this.configFiles.push({
			file: { fileName, content: configFileContent(config, written) },
			writesProjectFile: writesProjectFile,
		});
	}

	get configCount(): number {
		return this.configFiles.length;
	}

	addAgentFile(file: AgentFile, imports: readonly PlannedFile[] = []): void {
		this.agentFile = file.planned;
		this.agentImports = imports;
	}

	addAgentHook(hooks: AgentHooks, registering: boolean): void {
		this.hookFiles = hooks.files(registering);
		if (registering) this.addSetup(...hooks.setup);
	}

	addToolManifest(file: PlannedFile): void {
		this.toolManifest = file;
	}

	addFile(file: PlannedFile): void {
		this.templateFiles.push(file);
	}

	addMove(move: PlannedMove): void {
		this.moves.push(move);
	}

	addSetAside(move: PlannedMove): void {
		this.setAsides.push(move);
	}

	addSummary(area: string, text: string): void {
		this.summary.push({ area, text });
	}

	setScaffold(scaffold: PlannedScaffold): void {
		this.scaffold = scaffold;
	}

	addCommand(command: PlannedCommand): void {
		this.commands.push(command);
	}

	requestGitInit(): void {
		this.gitInit = true;
	}

	addDirectory(directory: string): void {
		this.directories.add(directory);
	}

	fromHere(relative: string): string {
		return toPosix(
			path.relative(this.cwd, path.join(this.directory.path, relative))
		);
	}

	addNote(note: string): void {
		this.notes.push(note);
	}

	setLiftedFrom(fileName: string): void {
		this.liftedFrom = fileName;
	}

	addWarning(warning: Diagnostic): void {
		this.warnings.push(warning);
	}

	addSetup(...lines: readonly string[]): void {
		for (const line of lines) this.setup.add(line);
	}

	addRun(...commands: readonly string[]): void {
		this.run.push(...commands);
	}

	setAction(action: InitAction): void {
		this.action = action;
	}

	addEdit(...lines: readonly string[]): void {
		this.edits.push(...lines);
	}

	build(): Result<InitPlan, Diagnostic[]> {
		const written = this.configFiles.map(({ file }) => file);
		const toWrite = this.configFiles
			.filter(({ writesProjectFile }) => writesProjectFile)
			.map(({ file }) => file);
		const moves = setUpMarkersLast(this.moves, this.setAsides);
		const movedAway = new Set(moves.map(({ from }) => from));
		const taken = this.directory.checkFree(
			written
				.map(({ fileName }) => fileName)
				.filter((fileName) => !movedAway.has(fileName))
		);
		if (taken.length > 0) return err(taken);

		return ok({
			directory: this.directory.path,
			action: this.action,
			summary: [...this.summary],
			asked: this.asked,
			decided: this.decided,
			gitInit: this.gitInit,
			...(this.scaffold && { scaffold: this.scaffold }),
			moves,
			files: setUpMarkersLast(
				[
					...this.templateFiles,
					...(this.agentFile ? [this.agentFile] : []),
					...this.agentImports,
					...this.hookFiles,
					...(this.toolManifest ? [this.toolManifest] : []),
				],
				written
			),
			directories: [...this.directories],
			commands: [...this.commands],
			configs: toWrite.map(({ fileName }) =>
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
				...(this.fromHere("") && { directory: this.fromHere("") }),
				setup: [...this.setup],
				run: [...this.run],
				edits: [...this.edits],
			},
		});
	}
}
