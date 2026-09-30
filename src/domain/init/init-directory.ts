import path from "path";
import { contains, normalizeDir, toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_STEM,
	configFileName,
	labelOfDefaultOutFile,
	rootDirOverlap,
} from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { DetectedWorkspace, Language } from "../toolchain/toolchain.js";

/** The template project file `init` starts, which the configs it writes name. */
export const TEMPLATE_FILE = "template.project.json";

const DEFAULT_ROOT_DIR = "src";
const DEFAULT_PROJECT_NAME = "roblox-game";

/** What a place inherits from `default.rogen.json`, with paths relative to the directory. */
export interface BaseConfig {
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** The config `default` extends, which holds the shared source setup of a Darklua repo. */
	readonly parent?: string;
}

/** The directory `init` writes into: what is in it, what the toolchain found there, and which paths could be written. */
export class InitDirectory {
	private defaultConfigRead:
		Promise<Result<BaseConfig, Diagnostic[]>> | undefined;

	constructor(
		/** The absolute path. */
		readonly path: string,
		/** The names of the entries in it. */
		private readonly entries: ReadonlySet<string>,
		readonly workspace: DetectedWorkspace,
		/** The config name given on the command line, if one was. */
		readonly givenName: string | undefined,
		/** The name written when none is asked for: the given one, else `default`. */
		readonly name: string,
		private readonly fileSystemService: FileSystemService,
		private readonly configService: ConfigService
	) {}

	/** The name of the game the project files carry. */
	get projectName(): string {
		return path.basename(this.path) || DEFAULT_PROJECT_NAME;
	}

	has(fileName: string): boolean {
		return this.entries.has(fileName);
	}

	get hasDefaultConfig(): boolean {
		return this.has(configFileName(DEFAULT_CONFIG_STEM));
	}

	/** Project files here that no config beside them writes, other than `template.project.json`. */
	get handWrittenProjectFiles(): string[] {
		return [...this.entries]
			.filter((file) => {
				const label = labelOfDefaultOutFile(file);
				return (
					label !== undefined &&
					file !== TEMPLATE_FILE &&
					!this.has(configFileName(label))
				);
			})
			.sort();
	}

	/** One diagnostic per file in `fileNames` that already exists here. */
	checkFree(fileNames: readonly string[]): Diagnostic[] {
		return fileNames
			.filter((fileName) => this.has(fileName))
			.map((fileName) =>
				errorDiagnostic(
					"init.configExists",
					{ resource: path.join(this.path, fileName) },
					"this config already exists. Delete it to write a new one."
				)
			);
	}

	async readFile(fileName: string): Promise<Result<string, Diagnostic[]>> {
		const file = path.join(this.path, fileName);
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		return text.isOk()
			? text
			: err([
					errorDiagnostic(
						"init.templateUnreadable",
						{ resource: file },
						`couldn't read this file to copy it: ${text.error.message}`
					),
				]);
	}

	/** What a place inherits from `default.rogen.json`, resolved the way a build would, so a place joins a config that builds. Read once. */
	defaultConfig(): Promise<Result<BaseConfig, Diagnostic[]>> {
		this.defaultConfigRead ??= this.readDefaultConfig();
		return this.defaultConfigRead;
	}

	/** The first that applies: the language's own config, `src`, the only code folder, else `src`. */
	defaultRootDir(language: Language): string {
		const configured = language.configuredRootDir();
		if (configured !== undefined) return configured;
		if (this.workspace.hasSrc) return DEFAULT_ROOT_DIR;
		const { codeFolders } = this.workspace;
		return codeFolders.length === 1 ? codeFolders[0] : DEFAULT_ROOT_DIR;
	}

	/** The hint line naming the code folders `rootDir` doesn't cover, or `undefined` when there are none. */
	otherCodeFoldersHint(rootDir: string): string | undefined {
		const [topLevel] = rootDir.split("/");
		const others = this.workspace.codeFolders.filter(
			(folder) => folder !== topLevel
		);
		return others.length > 0
			? `Also found code in: ${others.join(", ")}`
			: undefined;
	}

	/** The first reason `entries` can't be a config's root dirs, decided by the config's own overlap rule. */
	rootDirsProblem(entries: readonly string[]): string | undefined {
		if (entries.length === 0) return "Enter at least one root dir.";
		for (const entry of entries) {
			if (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
				return `Use a path relative to here, not ${entry}.`;
			}
			const normalized = normalizeDir(entry);
			if (normalized === ".." || normalized.startsWith("../")) {
				return `${entry} is outside this folder.`;
			}
		}
		const normalized = entries.map(normalizeDir);
		const absolute = normalized.map((entry) =>
			path.resolve(this.path, entry)
		);
		for (const [index, entry] of normalized.entries()) {
			const overlap = rootDirOverlap(absolute, index);
			if (overlap?.kind === "duplicate")
				return `${entry} is listed twice.`;
			if (overlap?.kind === "nested") {
				const outer = normalized[absolute.indexOf(overlap.outer)];
				return `${entry} is inside ${outer}. List only one of them.`;
			}
		}
		return undefined;
	}

	/** The first reason `folder` can't join `rootDirs` as a place's own code, or `undefined`. */
	placeFolderProblem(
		rootDirs: readonly string[],
		folder: string
	): string | undefined {
		const normalized = normalizeDir(folder);
		const resolved = path.resolve(this.path, normalized);
		const overlapping = rootDirs.find((dir) => {
			const other = path.resolve(this.path, dir);
			return contains(other, resolved) || contains(resolved, other);
		});
		return overlapping === undefined
			? this.rootDirsProblem([...rootDirs, folder])
			: `${normalized} overlaps ${overlapping}, one of default's root dirs. Pick a folder outside it.`;
	}

	private async readDefaultConfig(): Promise<
		Result<BaseConfig, Diagnostic[]>
	> {
		const entry = await this.configService.readConfig(
			path.join(this.path, configFileName(DEFAULT_CONFIG_STEM))
		);
		if (!entry.resolved) return err([...entry.diagnostics]);

		const relative = (absolute: string) =>
			toPosix(path.relative(this.path, absolute));
		const { rootDirs, syncDir } = entry.resolved;
		const [parent] = entry.parents;
		return ok({
			rootDirs: rootDirs.map(relative),
			...(syncDir && { syncDir: relative(syncDir) }),
			...(parent && { parent: relative(parent) }),
		});
	}
}
