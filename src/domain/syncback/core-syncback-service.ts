import path from "path";
import { UsageError, failureReason } from "../../base/errors.js";
import { toPosix, toNative } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import {
	BuildService,
	ConfigLocations,
	PlacedLocation,
} from "../build/build-service.js";
import { SYNCBACK_FILES } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { RojoCommandService } from "../runner/rojo-command-service.js";
import { ServerMessage } from "../runner/sync-server.js";
import { ProjectText } from "../rojo/project-text.js";
import { ReverseRouter } from "./reverse-router.js";
import { StagedUnit, StagedUnits } from "./staged-units.js";
import {
	SyncbackChange,
	SyncbackPlan,
	SyncbackRequest,
	SyncbackResult,
	UnplacedInstance,
} from "./syncback.js";
import { SyncbackService } from "./syncback-service.js";
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackProject } from "./syncback-project.js";

/** The first Rojo release with `syncback`. */
const SYNCBACK_SINCE = "7.7.0";

const TEMPORARY_PROJECT = SYNCBACK_FILES.project;
const STAGING = SYNCBACK_FILES.staging;
const NEW_FOLDER = "new";

const LISTED = /^(Writing|Removing) (.+)$/;

/** A project file Rojo reads, and the folders it writes what no folder of the project holds into. */
interface Prepared {
	readonly layout: SyncbackLayout | undefined;
	readonly project: SyncbackProject | undefined;
	/** Absolute, in the system's own form. */
	readonly file: string;
	readonly dir: string;
	readonly staging: string;
	readonly placed: readonly PlacedLocation[];
}

class CoreSyncbackPlan implements SyncbackPlan {
	constructor(
		readonly project: ResolvedConfig,
		readonly changes: readonly SyncbackChange[],
		readonly unplaced: readonly UnplacedInstance[]
	) {}
}

interface Settled {
	readonly changes: SyncbackChange[];
	readonly unplaced: UnplacedInstance[];
	/** The moves to make, from the staging folder to where routing puts the file. */
	readonly moves: { from: string; to: string; instance: string }[];
	/** What each file moved is expected to be: for the check after. */
	readonly expected: { file: string; instance: readonly string[] }[];
}

export class CoreSyncbackService implements SyncbackService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly buildService: BuildService,
		private readonly rojoService: RojoCommandService
	) {}

	async plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>> {
		const prepared = await this.prepare(request);
		if (prepared.isErr()) return prepared;
		try {
			const { dir } = prepared.value;
			await this.write(prepared.value);
			const ran = await this.run(request, prepared.value, [
				"--dry-run",
				"--list",
			]);
			if (ran.isErr()) return ran;
			const listed = this.listing(ran.value, dir);
			const settled = await this.settle(
				request,
				prepared.value,
				listed,
				false
			);
			return ok(
				new CoreSyncbackPlan(
					request.project,
					settled.changes,
					settled.unplaced
				)
			);
		} finally {
			await this.clean(prepared.value);
		}
	}

	async apply(
		request: SyncbackRequest,
		confirmed?: SyncbackPlan
	): Promise<Result<SyncbackResult, Error>> {
		if (confirmed) {
			const current = await this.plan(request);
			if (current.isErr()) return current;
			if (!CoreSyncbackService.sameRun(current.value, confirmed))
				return err(
					new UsageError(
						"The place file or the sources changed since the list was made, so nothing was written.",
						"Run syncback again."
					)
				);
		}
		const prepared = await this.prepare(request);
		if (prepared.isErr()) return prepared;
		try {
			const { dir } = prepared.value;
			await this.write(prepared.value);
			const ran = await this.run(request, prepared.value, ["--list"]);
			if (ran.isErr()) return ran;
			const direct = this.listing(ran.value, dir).filter(
				(entry) => !this.isStaged(prepared.value, entry.file)
			);
			const settled = await this.settle(
				request,
				prepared.value,
				direct,
				true
			);
			const moved = await this.move(settled);
			const warnings = await this.verify(request, moved.expected);
			return ok({
				project: request.project,
				changes: moved.changes,
				unplaced: moved.unplaced,
				warnings,
			});
		} finally {
			await this.clean(prepared.value);
		}
	}

	private static sameRun(a: SyncbackPlan, b: SyncbackPlan): boolean {
		const key = (plan: SyncbackPlan) =>
			JSON.stringify([
				plan.changes.map(({ kind, file }) => `${kind} ${file}`).sort(),
				plan.unplaced.map(({ instance }) => instance).sort(),
			]);
		return key(a) === key(b);
	}

	/** Moves what Rojo wrote into staging to where routing puts it. A move that fails leaves that instance unplaced, and the rest are made. */
	private async move(settled: Settled): Promise<Settled> {
		const failed = new Set<string>();
		const unplaced = [...settled.unplaced];
		for (const { from, to, instance } of settled.moves) {
			try {
				await this.fileSystemService.createDirectory(path.dirname(to));
				await this.fileSystemService.rename(from, to);
			} catch (error) {
				failed.add(to);
				unplaced.push({
					instance,
					reason: `${to} could not be written: ${failureReason(error as Error)}`,
				});
			}
		}
		return {
			...settled,
			changes: settled.changes.filter(({ file }) => !failed.has(file)),
			unplaced,
			expected: settled.expected.filter(({ file }) => !failed.has(file)),
		};
	}

	private async prepare(
		request: SyncbackRequest
	): Promise<Result<Prepared, Error>> {
		const { project } = request;
		const dir = project.projectDir;
		const base = {
			dir,
			file: path.join(dir, TEMPORARY_PROJECT),
			staging: path.join(dir, STAGING),
		};
		if (project.isAdopted)
			return ok({
				...base,
				file: project.projectFile,
				layout: undefined,
				project: undefined,
				placed: [],
			});
		const located = await this.buildService.locate(request.selection);
		if (located.isErr()) return located;
		const here = located.value.configs.find(
			({ config }) => config.id === project.id
		);
		if (!here)
			return err(
				new Error(`${project.label} was not found among the projects.`)
			);
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(project.projectFile)
		);
		if (text.isErr())
			return err(
				new UsageError(
					`${project.projectFile} could not be read; run 'rogen build' to write it.`
				)
			);
		let written: RojoProjectFile;
		try {
			written = JSON.parse(text.value) as RojoProjectFile;
		} catch {
			return err(
				new UsageError(
					`${project.projectFile} is not valid JSON; run 'rogen build' to write it again.`
				)
			);
		}
		const layout = new SyncbackLayout(project, here.files);
		const placed = here.files.filter(
			(file): file is PlacedLocation => file.status === "placed"
		);
		return ok({
			...base,
			layout,
			placed,
			project: SyncbackProject.of({
				written,
				dir,
				staging: `${STAGING}/${NEW_FOLDER}`,
				homes: layout.homes,
			}),
		});
	}

	private async write(prepared: Prepared): Promise<void> {
		const { project, file, staging } = prepared;
		if (!project) return;
		await this.clean(prepared);
		for (const number of project.staged.keys())
			await this.fileSystemService.createDirectory(
				path.join(staging, NEW_FOLDER, String(number))
			);
		await this.fileSystemService.writeFile(
			file,
			ProjectText.of(project.file)
		);
	}

	private async clean({ project, file, staging }: Prepared): Promise<void> {
		if (!project) return;
		await this.fileSystemService.delete(file).catch(() => undefined);
		await this.fileSystemService
			.delete(staging, true)
			.catch(() => undefined);
	}

	private async run(
		request: SyncbackRequest,
		prepared: Prepared,
		flags: readonly string[]
	): Promise<Result<readonly ServerMessage[], Error>> {
		const ran = await this.rojoService.run(request.selection, {
			command: "syncback",
			flags: ["--input", request.input, "--non-interactive", ...flags],
			cwd: request.cwd,
			project: request.project,
			projectFile: prepared.file,
			since: SYNCBACK_SINCE,
		});
		if (ran.isErr()) return ran;
		if (ran.value.failure)
			return err(this.explain(ran.value.failure, prepared));
		return ok(ran.value.messages);
	}

	/** Rojo's refusal to remove an instance a project file defines, with the file that defines it. */
	private explain(failure: DiagnosticsError, prepared: Prepared): Error {
		const said = failure.diagnostics
			.map(({ message }) => message)
			.join(" ");
		const refused =
			/The child '(?<child>[^']+)' of Instance '(?<parent>[^']+)' is present only in a project file/.exec(
				said
			)?.groups;
		if (!refused) return failure;
		const files = prepared.placed.filter(({ instancePath }) => {
			const at = instancePath.length;
			return (
				instancePath[at - 1] === refused.child &&
				instancePath[at - 2] === refused.parent
			);
		});
		return new DiagnosticsError([
			errorDiagnostic(
				"syncback.removedFromProjectFile",
				{ resource: files[0]?.source ?? prepared.dir },
				`the place no longer holds ${refused.parent}/${refused.child}, and the project file defines it file by file, which syncback cannot remove. ${files.length === 1 ? `Delete ${toNative(files[0].source)}` : files.length > 1 ? `Delete the one of ${files.map(({ source }) => toNative(source)).join(" and ")} that is gone from the place` : "Delete the file that makes it"}, then run syncback again.`
			),
		]);
	}

	/** What Rojo said it writes and removes, in the order it said it, as absolute paths; a folder it lists with a file inside it is left out. */
	private listing(
		messages: readonly ServerMessage[],
		dir: string
	): { kind: "write" | "remove"; file: string }[] {
		const listed = messages.flatMap(({ text }) => {
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
		return listed.filter(
			({ file }) =>
				!listed.some(
					(other) =>
						other.file !== file &&
						other.file.startsWith(file + path.sep)
				)
		);
	}

	private isStaged({ staging }: Prepared, file: string): boolean {
		return file.startsWith(staging + path.sep);
	}

	/** Splits what Rojo wrote or would write into the changes in the project's own folders and the new instances routing places. */
	private async settle(
		request: SyncbackRequest,
		prepared: Prepared,
		listed: readonly { kind: "write" | "remove"; file: string }[],
		moving: boolean
	): Promise<Settled> {
		const changes: SyncbackChange[] = listed.filter(
			({ file }) => !this.isStaged(prepared, file)
		);
		const unplaced: UnplacedInstance[] = [];
		const moves: Settled["moves"] = [];
		const expected: { file: string; instance: readonly string[] }[] = [];
		const { layout, project } = prepared;
		if (!layout || !project) return { changes, unplaced, moves, expected };

		const base = path.join(prepared.staging, NEW_FOLDER);
		const staged = moving
			? await this.walk(base)
			: listed
					.filter(({ file }) => this.isStaged(prepared, file))
					.map(({ file }) => file);
		const paths = staged.map((file) =>
			toPosix(path.relative(base, file)).split("/")
		);
		const { units, strays } = StagedUnits.of(paths, project.staged);
		for (const stray of strays)
			unplaced.push({
				instance: stray,
				reason: "no folder of the project holds its parent",
			});
		const router = new ReverseRouter(layout);
		const taken = new Set<string>();
		for (const unit of units)
			await this.placeUnit(
				unit,
				router,
				base,
				{ changes, unplaced, moves, expected },
				taken
			);
		return { changes, unplaced, moves, expected };
	}

	private async placeUnit(
		unit: StagedUnit,
		router: ReverseRouter,
		base: string,
		out: Settled,
		taken: Set<string>
	): Promise<void> {
		const instance = instanceKey([...unit.parent, unit.name]);
		const placement = router.place(unit);
		if (placement.kind === "conflict") {
			out.unplaced.push({ instance, reason: placement.reason });
			return;
		}
		const { home } = placement;
		const targets = unit.files.map((file) => ({
			file,
			to: path.join(
				toNative(home.dir),
				...router.destination(unit, file, home)
			),
		}));
		for (const { to } of targets) {
			if (taken.has(to) || (await this.fileSystemService.exists(to))) {
				out.unplaced.push({
					instance,
					reason: `${to} is already there`,
				});
				return;
			}
		}
		for (const { file, to } of targets) {
			taken.add(to);
			out.changes.push({ kind: "write", file: to });
			out.moves.push({
				from: path.join(base, String(unit.number), ...file),
				to,
				instance,
			});
		}
		if (!unit.folder && targets.length > 0)
			out.expected.push({
				file: targets[0].to,
				instance: [...unit.parent, unit.name],
			});
	}

	/** The files below `dir`, and the folders with none in them; `depth` 0 is the staging folder and 1 a staged node's, which are not instances. */
	private async walk(dir: string, depth = 0): Promise<string[]> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(dir)
		);
		if (entries.isErr()) return [];
		const found: string[] = [];
		for (const [name, type] of entries.value) {
			const entry = path.join(dir, name);
			if (!isDirectoryType(type)) found.push(entry);
			else {
				const inside = await this.walk(entry, depth + 1);
				found.push(
					...(inside.length > 0 || depth < 1 ? inside : [entry])
				);
			}
		}
		return found;
	}

	/** Builds again and compares: a file syncback placed that lands elsewhere than the place had it is a warning. A sync path holds what a tool wrote, which the build does not place. */
	private async verify(
		request: SyncbackRequest,
		expected: readonly { file: string; instance: readonly string[] }[]
	): Promise<Diagnostic[]> {
		if (expected.length === 0 || request.project.syncPath !== undefined)
			return [];
		const located = await this.buildService.locate(request.selection, {
			args: expected.map(({ file }) => file),
			cwd: request.cwd,
		});
		if (located.isErr()) return [];
		const warnings: Diagnostic[] = [];
		const here: ConfigLocations | undefined = located.value.configs.find(
			({ config }) => config.id === request.project.id
		);
		for (const { file, instance } of expected) {
			const found = here?.files.find(
				(location): location is PlacedLocation =>
					location.status === "placed" &&
					toNative(location.source) === file
			);
			if (found && found.instancePath.join("/") === instance.join("/"))
				continue;
			warnings.push(
				warningDiagnostic(
					"syncback.misplaced",
					{ resource: file },
					found
						? `this file was written for ${instanceKey(instance)}, and lands at ${instanceKey(found.instancePath)}. Move it to where routing puts it at ${instanceKey(instance)}.`
						: `this file was written for ${instanceKey(instance)}, and no instance comes from it. Check the routes of ${request.project.label}.`
				)
			);
		}
		return warnings;
	}
}
