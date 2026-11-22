import path from "path";
import { PathSet, toNative } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { RojoCommandService } from "../runner/rojo-command-service.js";
import { ServerMessage } from "../runner/rojo-server.js";
import {
	SyncbackChange,
	SyncbackRequest,
	SyncbackResult,
	UnplacedInstance,
} from "./syncback.js";
import { SyncbackLayout } from "./syncback-layout.js";

const SYNCBACK_SINCE = "7.7.0";

const LISTED = /^(Writing|Removing) (.+)$/;

const SKIPPED = /Cannot syncback (?<kind>\S+) at (?<instance>.+?), skipping/;
/**
 * Rojo's error for a YAML file it can't write back, which it fails on where it
 * skips JSON and TOML.
 */
const REFUSED_YAML =
	/Failed to syncback (?<instance>.+) because cannot syncback Yaml middleware/;

const ONLY_IN_PROJECT =
	/The child '(?<child>[^']+)' of Instance '(?<parent>[^']+)' is present only in a project file/;

export interface RefusedNode {
	readonly parent: string;
	readonly child: string;
}

const unsyncable = (kind: string): string =>
	`Rojo can't sync back a ${kind} file, so its change stays in the place; copy it by hand`;

const linesOf = (failure: DiagnosticsError): string[] =>
	failure.diagnostics.flatMap(({ message, details }) => [
		message,
		...(details ?? []),
	]);

export class RojoSyncback {
	constructor(
		private readonly request: SyncbackRequest,
		@RojoCommandService private readonly rojoService: RojoCommandService
	) {}

	static listed(
		messages: readonly ServerMessage[],
		dir: string
	): SyncbackChange[] {
		return messages.flatMap(({ text }) => {
			const found = LISTED.exec(text.trim());
			if (!found || found[2].startsWith("to the file system")) return [];
			return [
				{
					kind:
						found[1] === "Writing"
							? ("write" as const)
							: ("remove" as const),
					file: path.resolve(dir, found[2]),
				},
			];
		});
	}

	/**
	 * Whether Rojo renamed a file by only the letter case of its name, where
	 * the file system folds case: it writes the new name over the old file,
	 * then its removal of the old name takes what it wrote.
	 */
	static lostToCase(messages: readonly ServerMessage[]): boolean {
		const listed = RojoSyncback.listed(messages, ".");
		const written = listed
			.filter(({ kind }) => kind === "write")
			.map(({ file }) => file);
		const folded = new PathSet(written);
		return listed.some(
			({ kind, file }) =>
				kind === "remove" && !written.includes(file) && folded.has(file)
		);
	}

	static skipped(messages: readonly ServerMessage[]): UnplacedInstance[] {
		return messages.flatMap(({ text }) => {
			const found = SKIPPED.exec(text)?.groups;
			return found
				? [{ instance: found.instance, reason: unsyncable(found.kind) }]
				: [];
		});
	}

	static refusedYaml(error: Error): UnplacedInstance | undefined {
		if (!(error instanceof DiagnosticsError)) return undefined;
		for (const line of linesOf(error)) {
			const found = REFUSED_YAML.exec(line)?.groups;
			if (found)
				return { instance: found.instance, reason: unsyncable("Yaml") };
		}
		return undefined;
	}

	async plain(dryRun: boolean): Promise<Result<SyncbackResult, Error>> {
		const { project } = this.request;
		const ran = await this.run(project.projectFile, [
			...(dryRun ? ["--dry-run"] : []),
			"--list",
		]);
		if (ran.isErr()) return ran;
		const listed = RojoSyncback.listed(ran.value, project.projectDir);
		return ok({
			project,
			changes: listed.filter(
				({ file }) =>
					!listed.some(
						(other) =>
							other.file !== file &&
							other.file.startsWith(file + path.sep)
					)
			),
			listed,
			unplaced: [],
			compiled: [],
			warnings: [],
		});
	}

	listOn(
		projectFile: string,
		signal: AbortSignal
	): Promise<Result<readonly ServerMessage[], Error>> {
		return this.run(projectFile, ["--list"], signal);
	}

	private async run(
		projectFile: string,
		flags: readonly string[],
		signal?: AbortSignal
	): Promise<Result<readonly ServerMessage[], Error>> {
		const { request } = this;
		const ran = await this.rojoService.run(request.selection, {
			command: "syncback",
			flags: ["--input", request.input, "--non-interactive", ...flags],
			cwd: request.cwd,
			project: request.project,
			projectFile,
			since: SYNCBACK_SINCE,
			signal,
		});
		if (ran.isErr()) return ran;
		if (ran.value.failure) return err(ran.value.failure);
		return ok(ran.value.messages);
	}

	static refusedNode(error: Error): RefusedNode | undefined {
		if (!(error instanceof DiagnosticsError)) return undefined;
		const found = ONLY_IN_PROJECT.exec(linesOf(error).join("\n"))?.groups;
		return found && { parent: found.parent, child: found.child };
	}

	explain(failure: Error, layout: SyncbackLayout): Error {
		const refused = RojoSyncback.refusedNode(failure);
		if (!refused) return failure;
		const files = layout.placed.filter(({ instancePath }) => {
			const at = instancePath.length;
			return (
				instancePath[at - 1] === refused.child &&
				instancePath[at - 2] === refused.parent
			);
		});
		return new DiagnosticsError([
			errorDiagnostic(
				"syncback.removedFromProjectFile",
				{ resource: files[0]?.source ?? this.request.project.file },
				`the place no longer holds ${refused.parent}/${refused.child}, and the tree of the config defines it, which syncback cannot remove. ${files.length === 1 ? `Delete ${toNative(files[0].source)}` : "Remove its node from the tree"}, then run syncback again.`
			),
		]);
	}
}
