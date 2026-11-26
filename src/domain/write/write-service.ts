import path from "path";
import { relativeTo, toPosix } from "../../base/path.js";
import { joinedWithOr } from "../../base/strings.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	RenameFix,
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticIndex } from "../../platform/diagnostics/diagnostic-index.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig, scannedFileOf } from "../config/resolved-config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ConfigSelection } from "../config/config-service.js";
import {
	InstanceReference,
	requireExpression,
	whyNotRequirable,
} from "../roblox/roblox.js";
import {
	WriteRun,
	WriteSet,
	LeftOut,
	LoadedConfig,
	RouteMatch,
	FolderNode,
} from "./write.js";

interface Located {
	readonly source: string;
	readonly exists: boolean;
}

export interface PlacedLocation extends Located {
	readonly status: "placed";
	readonly instancePath: readonly string[];
	readonly route: string;
	readonly routeMatch: RouteMatch;
	readonly routedBy?: string;
	readonly hoisted?: boolean;
	readonly folderNodes?: readonly FolderNode[];
	readonly named?: true;
	readonly code?: "module" | "script";
}

interface UnplacedLocation extends Located {
	readonly status: "outside" | "notInstance" | "missing" | "empty";
	readonly folder?: true;
	readonly instancePath?: readonly string[];
}

interface BlockedLocation extends Located {
	readonly status: "blocked";
	readonly by: Diagnostic;
	readonly own: boolean;
}

export interface MountedLocation extends Located {
	readonly status: "mounted";
	readonly node: readonly string[];
	readonly instancePath?: readonly string[];
}

export interface CompiledLocation extends Located {
	readonly status: "compiled";
	readonly from: string;
	readonly instancePath: readonly string[];
}

export type FileLocation =
	| PlacedLocation
	| MountedLocation
	| CompiledLocation
	| (Exclude<LeftOut, { status: "mounted" }> & Located)
	| UnplacedLocation
	| BlockedLocation;

export function requireExpressionOf(
	location: FileLocation
): string | undefined {
	return location.status === "placed" && location.code === "module"
		? requireExpression(location.instancePath)
		: undefined;
}

export function requireNoteOf(location: FileLocation): string | undefined {
	if (location.status !== "placed" || !location.named) return undefined;
	if (location.code === undefined) return undefined;
	if (location.code === "script")
		return "no require by this path: a script runs on its own and is not a module";
	const expression = requireExpression(location.instancePath);
	if (expression) return `require(${expression})`;
	const reason = whyNotRequirable(location.instancePath);
	return reason && `no require by this path: ${reason}`;
}

export interface InstanceLocation {
	readonly reference: InstanceReference;
	readonly files: readonly (PlacedLocation | MountedLocation)[];
	readonly folders: readonly string[];
	readonly fixes: readonly InstanceFix[];
}

export interface InstanceFix {
	readonly code: string;
	readonly rename: RenameFix["rename"];
}

export interface RaisedDiagnostics {
	readonly diagnostics: readonly Diagnostic[];
	readonly markers: readonly string[];
}

export interface ConfigLocations extends RaisedDiagnostics {
	readonly config: ResolvedConfig;
	readonly files: readonly FileLocation[];
	readonly instances: readonly InstanceLocation[];
	readonly queried: readonly string[];
	readonly projectFile?: RojoProjectFile;
}

export class LocatedDiagnosis {
	readonly reaching: readonly Diagnostic[];
	readonly stops: readonly Diagnostic[];
	readonly stoppedBy: readonly Diagnostic[];
	readonly unshown: readonly Diagnostic[];
	readonly placingNothing: readonly Diagnostic[];

	private readonly index: DiagnosticIndex;
	private readonly queried: ReadonlySet<string>;

	constructor(private readonly located: ConfigLocations) {
		const markers = new Set(located.markers);
		this.index = new DiagnosticIndex(located.diagnostics, (diagnostic) => {
			const resource = toPosix(diagnostic.resource);
			return markers.has(resource)
				? path.posix.dirname(resource)
				: resource;
		});
		this.queried = new Set(located.queried);
		const targets = [
			...located.files.map(({ source }) => source),
			...located.queried,
		];
		const renames = new Set(
			located.instances.flatMap(({ fixes }) =>
				fixes.map(({ code, rename }) => `${code}\0${rename.from}`)
			)
		);
		const proposing = new Set(
			located.diagnostics.filter((diagnostic) =>
				renames.has(
					`${diagnostic.code}\0${toPosix(diagnostic.resource)}`
				)
			)
		);
		const reaching = new Set([
			...targets.flatMap((target) =>
				this.index.reaching(target, this.metaPathsOf(target))
			),
			...proposing,
		]);
		this.reaching = [...reaching];
		this.stops = located.diagnostics.filter(isError);
		this.stoppedBy = this.stops.filter((error) => !reaching.has(error));
		const shown = new Set(
			[
				...located.files,
				...located.instances.flatMap(({ files }) => files),
			].flatMap((location) => this.of(location))
		);
		this.unshown = located.files.some(({ status }) => status === "blocked")
			? []
			: this.stops.filter(
					(error) => !shown.has(error) && !proposing.has(error)
				);
		this.placingNothing = located.diagnostics.filter(
			({ code }) => code === "scan.noSyncedFiles"
		);
	}

	of(location: FileLocation): Diagnostic[] {
		const { source } = location;
		const metaPaths = this.metaPathsOf(source);
		return this.queried.has(source)
			? this.index.reaching(source, metaPaths)
			: this.index.about(source, metaPaths);
	}

	private metaPathsOf(source: string): string[] {
		const posixSource = toPosix(source);
		const dir = path.posix.dirname(posixSource);
		return scannedFileOf(this.located.config, posixSource).metaFiles.map(
			(name) => path.posix.join(dir, name)
		);
	}
}

export class LocatedVerdict {
	readonly diagnoses: readonly LocatedDiagnosis[];
	readonly stops: readonly Diagnostic[];
	readonly errors: readonly Diagnostic[];
	readonly failing: readonly Diagnostic[];
	readonly elsewhere: readonly Diagnostic[];

	constructor({ everyFile, configs, errors }: Locations) {
		this.diagnoses = configs.map(
			(located) => new LocatedDiagnosis(located)
		);
		this.stops = uniqueDiagnostics(
			this.diagnoses.flatMap(({ stops }) => stops)
		);
		const unshown = uniqueDiagnostics(
			this.diagnoses.flatMap(({ unshown }) => unshown)
		);
		const stoppedBy = this.diagnoses.flatMap(({ stoppedBy }) => stoppedBy);
		this.elsewhere = everyFile
			? []
			: unshown.filter((error) => stoppedBy.includes(error));
		this.errors = uniqueDiagnostics([...errors, ...unshown]);
		this.failing = uniqueDiagnostics([
			...errors,
			...this.stops.filter((error) => !this.elsewhere.includes(error)),
		]);
	}
}

export type Asked = { readonly path: string } | { readonly instance: string };

export interface Locations {
	readonly everyFile: boolean;
	readonly asked: readonly Asked[];
	readonly configs: readonly ConfigLocations[];
	readonly errors: readonly Diagnostic[];
	readonly skipped: readonly SkippedPath[];
}

export interface LocateQuery {
	readonly args: readonly string[];
	readonly cwd: string;
}

export interface Skips {
	readonly skipped: readonly SkippedPath[];
	readonly named: readonly string[];
}

export interface Diagnosis extends Skips {
	readonly diagnostics: readonly Diagnostic[];
	readonly stoppedBy: readonly Diagnostic[];
	readonly failing: readonly Diagnostic[];
}

export interface AskedLocations extends Skips {
	readonly locations: Locations;
}

export function skippedNotes(
	{ skipped, named }: Skips,
	cwd: string,
	ask: { readonly command: string; readonly lead: string }
): string[] {
	const configs = named.map((file) => relativeTo(cwd, file));
	return skipped.map((one) => {
		const path = relativeTo(cwd, one.path);
		if (one.reason === "outsideSourcePaths")
			return `note: ${path}: in no source path of ${relativeTo(cwd, one.config!)}, so Rogen leaves it out of the project file.`;
		const readers = one.readers ?? [];
		if (readers.length > 0) {
			const commands = readers.map(
				(file) => `'rogen ${ask.command} ${relativeTo(cwd, file)}'`
			);
			return readers.length === 1
				? `note: ${path}: no config at or above it reads it, but another config lists it in its source paths. ${ask.lead} through that config: ${commands[0]}.`
				: `note: ${path}: no config at or above it reads it, but other configs list it in their source paths. ${ask.lead} through one: ${joinedWithOr(commands)}.`;
		}
		const hint =
			configs.length > 0
				? ` ${ask.lead} through one: rogen ${ask.command} ${joinedWithOr(configs)}.`
				: "";
		return `note: ${path}: no config at or above it reads it.${hint}`;
	});
}

export interface WriteService {
	readonly _serviceBrand: undefined;

	write(
		selection: ConfigSelection,
		options?: { readonly independent?: boolean }
	): Promise<WriteRun>;

	check(
		selection: ConfigSelection,
		reader?: FileSystemService
	): Promise<WriteRun>;

	rewrite(
		set: WriteSet,
		projectFile: string,
		listing: IndexReader,
		previous?: LoadedConfig,
		force?: boolean
	): Promise<LoadedConfig>;

	recheck(
		set: WriteSet,
		projectFile: string,
		listing: IndexReader,
		previous: LoadedConfig,
		changes: readonly FileChange[]
	): Promise<LoadedConfig>;

	diagnose(query: LocateQuery): Promise<Result<Diagnosis, Error>>;

	locateAsked(query: LocateQuery): Promise<Result<AskedLocations, Error>>;

	locate(
		selection: ConfigSelection,
		targets?: LocateQuery,
		reader?: FileSystemService
	): Promise<Result<Locations, DiagnosticsError>>;
}

export const WriteService = createDecorator<WriteService>("writeService");
