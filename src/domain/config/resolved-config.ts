import path from "path";
import {
	commonAncestor,
	containsPosix,
	samePath,
	toPosix,
} from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { ParsedProjectFile, RojoProject } from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DEFAULT_SOURCE_PATH, projectFileOf } from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";
import { RoutePatterns } from "./route-patterns.js";

interface ResolvedConfigFields {
	readonly file: string;
	readonly projectName: string;
	readonly project: RojoProject<ParsedProjectFile>;
	readonly sourcePaths: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly ignored: readonly string[];
	readonly compiledPath?: string;
	readonly warnings: readonly Diagnostic[];
}

export class ResolvedConfig {
	readonly file: string;
	readonly projectName: string;
	readonly project: RojoProject<ParsedProjectFile>;
	readonly sourcePaths: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly ignored: readonly string[];
	readonly compiledPath?: string;
	readonly warnings: readonly Diagnostic[];
	readonly keys: DeclaredKeys;
	readonly patterns: RoutePatterns;
	readonly syncRules: SyncRules;
	readonly compiled: CompiledPath;

	constructor(fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.projectName = fields.projectName;
		this.project = fields.project;
		this.sourcePaths = fields.sourcePaths;
		this.routes = fields.routes;
		this.ignored = fields.ignored;
		this.compiledPath = fields.compiledPath;
		this.warnings = fields.warnings;
		this.keys = new DeclaredKeys(fields.routes.keys());
		this.patterns = new RoutePatterns(fields.routes);
		this.syncRules = SyncRules.following(
			SyncRules.read(fields.project.syncRules).rules,
			toPosix(this.projectDir)
		);
		this.compiled = CompiledPath.from(this);
	}

	get label(): string {
		return this.projectName;
	}

	get id(): string {
		return this.file;
	}

	get projectDir(): string {
		return path.dirname(this.file);
	}

	get projectFile(): string {
		return projectFileOf(this.file);
	}

	get usesDefaultSourcePath(): boolean {
		return (
			this.sourcePaths.length === 1 &&
			samePath(
				this.sourcePaths[0],
				path.join(this.projectDir, DEFAULT_SOURCE_PATH)
			)
		);
	}

	get isAdopted(): boolean {
		return samePath(this.file, this.projectFile);
	}

	get indexedPaths(): readonly string[] {
		return this.routes.size > 0
			? this.sourcePaths
			: [path.join(this.projectDir, DEFAULT_SOURCE_PATH)];
	}

	get commonRoot(): string | undefined {
		return this.sourcePaths.length > 0
			? commonAncestor(this.sourcePaths)
			: undefined;
	}
}

export type CompiledPathFields = Pick<
	ResolvedConfig,
	"commonRoot" | "compiledPath" | "projectDir" | "syncRules"
>;

export class CompiledPath {
	constructor(
		readonly folder: string | undefined,
		readonly root: string,
		readonly projectDir: string,
		private readonly syncRules: SyncRules
	) {}

	static from(fields: CompiledPathFields): CompiledPath {
		return new CompiledPath(
			fields.compiledPath,
			fields.commonRoot ?? fields.projectDir,
			fields.projectDir,
			fields.syncRules
		);
	}

	of(source: string): string {
		if (this.folder === undefined) return source;
		return path.join(this.folder, path.relative(this.root, source));
	}

	sourceOf(compiled: string): string {
		if (this.folder === undefined) return compiled;
		return path.join(this.root, path.relative(this.folder, compiled));
	}

	glob(projectGlob: string): string {
		if (this.folder === undefined) return projectGlob;
		const root = toPosix(this.root);
		const dir = toPosix(this.projectDir);
		const absolute = path.posix.join(dir, projectGlob);
		if (!containsPosix(root, absolute)) return projectGlob;
		return path.posix.relative(
			dir,
			path.posix.join(
				toPosix(this.folder),
				path.posix.relative(root, absolute)
			)
		);
	}

	fileAt(target: string): RojoFile {
		return RojoFile.at(toPosix(target), this.syncRules);
	}

	fileOf(source: string): RojoFile {
		const reading = this.folder === undefined ? "rojo" : "compiled";
		return RojoFile.at(source, this.syncRules, reading);
	}
}

export interface ResolvedConfigFile {
	readonly config: ResolvedConfig;
}
