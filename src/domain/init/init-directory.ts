import path from "path";
import { PathSet, samePath } from "../../base/path.js";
import { ignoresPathCase } from "../../base/platform.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	isConfigFileName,
} from "../config/config.js";
import { isProjectFileName } from "../rojo/rojo-project.js";
import { DetectedWorkspace, Language } from "../toolchain/toolchain.js";
import { DirectoryLayout } from "./code-finder.js";
import { StartingRoutes } from "./starting-routes.js";

export class InitDirectory {
	private readonly names: PathSet;

	constructor(
		readonly path: string,
		private readonly entries: ReadonlySet<string>,
		readonly workspace: DetectedWorkspace,
		readonly layout: DirectoryLayout,
		readonly tracksProjectFile: boolean,
		caseInsensitive = ignoresPathCase
	) {
		this.names = new PathSet(entries, caseInsensitive);
	}

	has(fileName: string): boolean {
		return this.names.has(fileName);
	}

	get hasConfigs(): boolean {
		return this.configFiles.length > 0;
	}

	get configFiles(): string[] {
		return [...this.entries].filter(isConfigFileName).sort();
	}

	otherProjectFiles(...except: string[]): string[] {
		return [...this.entries]
			.filter(
				(name) =>
					isProjectFileName(name) &&
					!except.some((own) => samePath(name, own))
			)
			.sort();
	}

	get hasHandWrittenProject(): boolean {
		return this.has(DEFAULT_PROJECT_FILE);
	}

	checkFree(fileNames: readonly string[]): Diagnostic[] {
		return fileNames
			.filter((fileName) => this.has(fileName))
			.map((fileName) =>
				isConfigFileName(fileName)
					? errorDiagnostic(
							"init.configExists",
							{ resource: path.join(this.path, fileName) },
							"this config already exists, and init never changes one. Edit it, or add agent files with 'rogen init --agent-rules' or 'rogen init --agent-hook'."
						)
					: errorDiagnostic(
							"init.fileExists",
							{ resource: path.join(this.path, fileName) },
							"this file already exists, and init never overwrites one. Pick another name."
						)
			);
	}

	get holdsCode(): boolean {
		const { codeFolders, rootScripts } = this.layout;
		return codeFolders.length > 0 || rootScripts.length > 0;
	}

	get moduleRoot(): string | undefined {
		const { codeFolders, moduleFolders } = this.layout;
		const root = this.has(DEFAULT_SOURCE_PATH)
			? DEFAULT_SOURCE_PATH
			: codeFolders.length === 1
				? codeFolders[0]
				: undefined;
		return root !== undefined && moduleFolders.includes(root)
			? root
			: undefined;
	}

	get isOneModule(): boolean {
		const { codeFolders, rootScripts } = this.layout;
		return (
			this.moduleRoot !== undefined &&
			codeFolders.length === 1 &&
			rootScripts.length === 0
		);
	}

	defaultSourcePath(language: Language): string {
		const configured = language.configuredSourcePath();
		if (configured !== undefined) return configured;
		if (this.has(DEFAULT_SOURCE_PATH)) return DEFAULT_SOURCE_PATH;
		const { codeFolders } = this.layout;
		return codeFolders.length === 1 && !StartingRoutes.isKey(codeFolders[0])
			? codeFolders[0]
			: DEFAULT_SOURCE_PATH;
	}
}
