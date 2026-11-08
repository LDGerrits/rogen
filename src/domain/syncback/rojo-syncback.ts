import path from "path";
import { UsageError } from "../../base/errors.js";
import { toNative } from "../../base/path.js";
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

/** The first Rojo release with `syncback`. */
const SYNCBACK_SINCE = "7.7.0";

const LISTED = /^(Writing|Removing) (.+)$/;

/** Rojo's warning for an instance whose kind of file it can't write back. */
const SKIPPED = /Cannot syncback (?<kind>\S+) at (?<instance>.+?), skipping/;
/** Rojo's error for a YAML file it can't write back, which it fails on where it skips JSON and TOML. */
const REFUSED_YAML =
	/Failed to syncback (?<instance>.+) because cannot syncback Yaml middleware/;

/** Why an instance whose kind of file Rojo can't write back is left out. */
const unsyncable = (kind: string): string =>
	`Rojo can't sync back a ${kind} file, so its change stays in the place; copy it by hand`;

/** Every line Rojo's failure said. */
const linesOf = (failure: DiagnosticsError): string[] =>
	failure.diagnostics.flatMap(({ message, details }) => [
		message,
		...(details ?? []),
	]);

/** Rojo's own syncback for one request: how it is run, and what it says. */
export class RojoSyncback {
	constructor(
		private readonly rojoService: RojoCommandService,
		private readonly request: SyncbackRequest
	) {}

	/** Every line Rojo listed, in its order, as an absolute path. */
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

	/** The instances Rojo said it skipped, as it can't write back their kind of file. */
	static skipped(messages: readonly ServerMessage[]): UnplacedInstance[] {
		return messages.flatMap(({ text }) => {
			const found = SKIPPED.exec(text)?.groups;
			return found
				? [{ instance: found.instance, reason: unsyncable(found.kind) }]
				: [];
		});
	}

	/** The instance whose YAML file Rojo's syncback stopped on, with why it is left out. */
	static refusedYaml(error: Error): UnplacedInstance | undefined {
		if (!(error instanceof DiagnosticsError)) return undefined;
		for (const line of linesOf(error)) {
			const found = REFUSED_YAML.exec(line)?.groups;
			if (found)
				return { instance: found.instance, reason: unsyncable("Yaml") };
		}
		return undefined;
	}

	/** A plain Rojo project is given to Rojo as it is: what it lists, its changes without a folder it lists with a file inside it. */
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

	/** Lists what Rojo's syncback does to the project file at `projectFile`, which mounts the mirror `layout` was made for. */
	listOn(
		projectFile: string,
		layout: SyncbackLayout,
		signal: AbortSignal
	): Promise<Result<readonly ServerMessage[], Error>> {
		return this.run(projectFile, ["--list"], layout, signal);
	}

	private async run(
		projectFile: string,
		flags: readonly string[],
		layout?: SyncbackLayout,
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
		if (ran.value.failure)
			return err(this.explain(ran.value.failure, layout));
		return ok(ran.value.messages);
	}

	/** Rojo's refusal to remove an instance a node of the config's tree defines, with the file that makes it when there is one. */
	private explain(
		failure: DiagnosticsError | UsageError,
		layout: SyncbackLayout | undefined
	): Error {
		if (failure instanceof UsageError) return failure;
		const said = linesOf(failure).join("\n");
		const refused =
			/The child '(?<child>[^']+)' of Instance '(?<parent>[^']+)' is present only in a project file/.exec(
				said
			)?.groups;
		if (!refused || !layout) return failure;
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
