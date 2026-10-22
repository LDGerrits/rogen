import path from "path";
import { failureReason } from "../../base/errors.js";
import { randomUUID } from "crypto";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { configFileNameOf } from "../config/config.js";
import { ProjectText } from "../rojo/project-text.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { OutputFile } from "./build.js";
import { Edited, HandEdits } from "./hand-edits.js";
import { WrittenRecords } from "./written-records.js";

/** The message of a project file edited by hand: what a write would lose, and where it belongs. */
export function editedByHandMessage(
	edited: Edited,
	configFile: string,
	write: string
): string {
	if (edited === "unreadable")
		return `this file was edited by hand and no longer reads as a project file, and ${write} would replace it. Fix it or delete it, since what it holds comes from ${configFile}.`;
	const lost = edited.map((edit) => HandEdits.describe(edit)).join(", ");
	const tree = HandEdits.asTree(edited);
	const keys = HandEdits.asKeys(edited);
	const moves = [
		...(Object.keys(tree).length > 0
			? [`add ${JSON.stringify(tree)} to the "tree" of ${configFile}`]
			: []),
		...(Object.keys(keys).length > 0
			? [`set ${JSON.stringify(keys).slice(1, -1)} in ${configFile}`]
			: []),
	];
	return `this file was edited by hand, and ${write} would lose ${lost}. To keep the edit, ${moves.join(" and ")}, since ${configFile} is what writes this file, and then write it again. To drop the edit instead, run 'rogen build --force'.`;
}

/** Writes a tree to its output through a staging file, so a reader never sees half a project file. */
export class OutputWriter {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly records: WrittenRecords = new WrittenRecords()
	) {}

	static textOf(projectFile: RojoProjectFile): string {
		return ProjectText.of(projectFile);
	}

	/** Fails a project file Rogen wrote whose config is gone, so a deleted config isn't silently kept alive. */
	async orphaned(projectFile: string): Promise<DiagnosticsError | undefined> {
		const last = await this.records.lastWritten(projectFile);
		if (last === undefined) return undefined;
		const onDisk = await tryWithAsync(() =>
			this.fileSystemService.readFile(projectFile)
		);
		if (onDisk.isErr() || WrittenRecords.hashOf(onDisk.value) !== last)
			return undefined;
		const config = configFileNameOf(projectFile);
		return new DiagnosticsError([
			errorDiagnostic(
				"output.configMissing",
				{ resource: projectFile },
				`Rogen wrote this file from ${config}, which is not here now: the config was deleted or renamed. Restore ${config}, or change this file by hand to use it as a plain Rojo project.`
			),
		]);
	}

	/** Writes the file unless that would lose a hand edit, which `force` overrides; `rewrite` writes unchanged bytes so a watcher sees them. */
	async write(
		output: OutputFile,
		tree: RojoProjectFile,
		configFile: string,
		{ rewrite = false, force = false } = {}
	): Promise<Result<boolean, DiagnosticsError>> {
		const projectFile = output.path;
		const content = OutputWriter.textOf(tree);
		const temporary = output.stagingFile(randomUUID());

		let edited: Edited | undefined;
		const written = await tryWithAsync(async (): Promise<boolean> => {
			const onDisk = (await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined;
			if (onDisk === content) {
				await this.records.remember(projectFile, content);
				if (!rewrite) return false;
			} else if (onDisk !== undefined && !force) {
				edited = await HandEdits.editedBy(
					this.records,
					projectFile,
					onDisk,
					content
				);
				if (edited) return false;
			}
			await this.fileSystemService.writeFile(temporary, content);
			await this.fileSystemService.rename(temporary, projectFile, true);
			await this.records.remember(projectFile, content);
			return true;
		});
		if (edited)
			return err(
				new DiagnosticsError([
					errorDiagnostic(
						"output.editedByHand",
						{ resource: projectFile },
						editedByHandMessage(
							edited,
							path.basename(configFile),
							"a build"
						)
					),
				])
			);
		if (written.isOk()) return ok(written.value);

		await this.fileSystemService.delete(temporary).catch(() => undefined);
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"output.writeFailed",
					{ resource: projectFile },
					`the project file could not be written: ${failureReason(written.error)}.`
				),
			])
		);
	}
}
