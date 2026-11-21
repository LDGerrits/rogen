import path from "path";
import { toPosix } from "../../base/path.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	RenameFix,
	isAbout,
	isError,
	reaches,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
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

	constructor(private readonly located: ConfigLocations) {
		const targets = [
			...located.files.map(({ source }) => source),
			...located.queried,
		];
		const proposing = located.diagnostics.filter((diagnostic) =>
			located.instances.some(({ fixes }) =>
				fixes.some(
					({ code, rename }) =>
						code === diagnostic.code &&
						rename.from === toPosix(diagnostic.resource)
				)
			)
		);
		this.reaching = [
			...new Set([
				...targets.flatMap((target) =>
					located.diagnostics.filter((diagnostic) =>
						this.reaches(diagnostic, target)
					)
				),
				...proposing,
			]),
		];
		this.stops = located.diagnostics.filter(isError);
		this.stoppedBy = this.stops.filter(
			(error) => !this.reaching.includes(error)
		);
		const shown = new Set(
			[
				...located.files,
				...located.instances.flatMap(({ files }) => files),
			].flatMap((location) => this.of(location))
		);
		this.unshown = located.files.some(({ status }) => status === "blocked")
			? []
			: this.stops.filter(
					(error) => !shown.has(error) && !proposing.includes(error)
				);
		this.placingNothing = located.diagnostics.filter(
			({ code }) => code === "scan.noSyncedFiles"
		);
	}

	of(location: FileLocation): Diagnostic[] {
		const asked = this.located.queried.includes(location.source);
		return this.located.diagnostics.filter((diagnostic) =>
			asked
				? this.reaches(diagnostic, location.source)
				: isAbout(diagnostic, location.source) ||
					this.isMetaOf(diagnostic, location.source)
		);
	}

	private reaches(diagnostic: Diagnostic, target: string): boolean {
		const resource = toPosix(diagnostic.resource);
		return (
			reaches(
				diagnostic,
				target,
				this.located.markers.includes(resource)
					? path.posix.dirname(resource)
					: resource
			) || this.isMetaOf(diagnostic, target)
		);
	}

	private isMetaOf(diagnostic: Diagnostic, source: string): boolean {
		const posixSource = toPosix(source);
		const dir = path.posix.dirname(posixSource);
		return scannedFileOf(this.located.config, posixSource)
			.metaFiles.map((name) => path.posix.join(dir, name))
			.includes(toPosix(diagnostic.resource));
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

export interface Diagnosis {
	readonly diagnostics: readonly Diagnostic[];
	readonly stoppedBy: readonly Diagnostic[];
	readonly skipped: readonly SkippedPath[];
}

export function outsideEveryConfig(
	configs: readonly ConfigLocations[]
): string[] {
	const [first, ...others] = configs;
	if (!first) return [];
	return first.files
		.filter(({ status }) => status === "outside")
		.map(({ source }) => source)
		.filter((source) =>
			others.every(({ files }) =>
				files.some(
					(file) =>
						file.source === source && file.status === "outside"
				)
			)
		);
}

export function skippedOutside(
	sources: readonly string[],
	configs: readonly ConfigLocations[]
): SkippedPath[] {
	return sources.flatMap((path) =>
		configs.map(({ config }) => ({
			path,
			reason: "outsideSourcePaths" as const,
			config: toPosix(config.file),
		}))
	);
}

export function skippedByEveryConfig(
	configs: readonly ConfigLocations[]
): SkippedPath[] {
	return skippedOutside(outsideEveryConfig(configs), configs);
}

export function mergeDiagnoses(parts: readonly Diagnosis[]): Diagnosis {
	return {
		diagnostics: uniqueDiagnostics(
			parts.flatMap(({ diagnostics }) => diagnostics)
		),
		stoppedBy: uniqueDiagnostics(
			parts.flatMap(({ stoppedBy }) => stoppedBy)
		),
		skipped: uniqueSkipped(parts.flatMap(({ skipped }) => skipped)),
	};
}

export function uniqueSkipped(skipped: readonly SkippedPath[]): SkippedPath[] {
	const seen = new Set<string>();
	return skipped.filter(({ path, reason, config }) => {
		const key = `${reason}\0${path}\0${config ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function mergeLocations(
	parts: readonly Locations[],
	asked: readonly Asked[]
): Locations {
	const configs = parts.flatMap((part) => part.configs);
	return {
		everyFile: false,
		asked,
		configs,
		errors: uniqueDiagnostics(parts.flatMap((part) => part.errors)),
		skipped: skippedByEveryConfig(configs),
	};
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

	diagnose(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Diagnosis, DiagnosticsError>>;

	askedAbout(query: LocateQuery): Promise<readonly Asked[]>;

	staleProjectFiles(selection: ConfigSelection): Promise<Diagnostic[]>;

	locate(
		selection: ConfigSelection,
		targets?: LocateQuery,
		reader?: FileSystemService
	): Promise<Result<Locations, DiagnosticsError>>;
}

export const WriteService = createDecorator<WriteService>("writeService");
