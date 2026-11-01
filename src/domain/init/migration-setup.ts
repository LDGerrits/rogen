import { Result, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { DEFAULT_CONFIG_FILE, configStem } from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitSummary } from "./init-summary.js";
import { MigratedProject } from "./project-migration.js";
import { ProjectFiles } from "./project-files.js";
import { Setup } from "./setup.js";

interface MigrationChoices {
	readonly projectFilesHint?: string;
}

/** A project another tool set up, carried over into the configs its migration writes, in place of a new project. */
export class MigrationSetup implements Setup<MigrationChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly migrated: MigratedProject,
		private readonly fileSystemService: FileReader
	) {}

	async ask(): Promise<Result<MigrationChoices | undefined, Diagnostic[]>> {
		const hint = await new ProjectFiles(
			this.fileSystemService,
			this.directory.path
		).projectFilesHint();
		return ok(hint ? { projectFilesHint: hint } : {});
	}

	plan(choices: MigrationChoices, builder: InitPlanBuilder): void {
		const { migrated } = this;
		builder.setAction("migrate");
		builder.addSummary("Project", `migrating ${migrated.label}`);
		for (const { fileName, config } of migrated.configs) {
			builder.addSummary(
				"Code",
				`${fileName}: ${InitSummary.code(config.sourcePaths ?? [], config.routes ?? {})}`
			);
			builder.setConfig(config, undefined, fileName);
		}
		for (const move of migrated.moves) builder.addMove(move);
		for (const note of migrated.notes) builder.addNote(note);
		for (const warning of migrated.warnings) builder.addWarning(warning);
		builder.addEdit(...migrated.edits);
		if (choices.projectFilesHint) builder.addEdit(choices.projectFilesHint);
		const [first] = migrated.configs;
		const files = migrated.configs.map(({ fileName }) => fileName);
		builder.addEdit(
			`Edit ${joinedWithAnd(files)}${files.length > 1 ? "," : ""} and leave ${joinedWithAnd(files.map(MigrationSetup.projectFileOf))} alone, since 'rogen write' replaces ${files.length === 1 ? "it" : "them"}. After you add a feature folder, run 'rogen write' so the editor's ${files.length === 1 ? "project file follows" : "project files follow"}.`
		);
		if (first)
			builder.addRun(
				first.fileName === DEFAULT_CONFIG_FILE
					? "rogen serve"
					: `rogen serve ${configStem(first.fileName)}`
			);
	}

	private static projectFileOf(fileName: string): string {
		return projectFileName(configStem(fileName) ?? fileName);
	}
}
