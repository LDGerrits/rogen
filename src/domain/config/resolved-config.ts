import path from "path";
import {
	commonAncestor,
	contains,
	samePath,
	toPosix,
} from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { ParsedProjectFile, RojoProject } from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import {
	DEFAULT_SOURCE_PATH,
	compilerFileOf,
	projectFileOf,
} from "./config.js";
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

	get compilerFile(): string | undefined {
		const { commonRoot } = this;
		return !this.isAdopted &&
			this.compiledPath !== undefined &&
			commonRoot !== undefined &&
			contains(commonRoot, this.projectDir)
			? compilerFileOf(this.file)
			: undefined;
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

export function compiledPathOf(
	config: Pick<ResolvedConfig, "commonRoot" | "compiledPath" | "projectDir">,
	file: string
): string {
	if (config.compiledPath === undefined) return file;
	return path.join(
		config.compiledPath,
		path.relative(config.commonRoot ?? config.projectDir, file)
	);
}

export function scannedFileOf(
	config: Pick<ResolvedConfig, "compiledPath" | "syncRules">,
	source: string
): RojoFile {
	const reading = config.compiledPath === undefined ? "rojo" : "compiled";
	return RojoFile.at(source, config.syncRules, reading);
}

export interface ResolvedConfigFile {
	readonly config: ResolvedConfig;
}
