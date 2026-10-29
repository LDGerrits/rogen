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
import { DetectedWorkspace, Language } from "../toolchain/toolchain.js";
import { DirectoryLayout } from "./code-finder.js";
import { DOCS_URL } from "../../platform/product/product-service.js";

const PROJECT_FILE_SUFFIX = ".project.json";

export class InitDirectory {
	private readonly names: PathSet;

	constructor(
		readonly path: string,
		private readonly entries: ReadonlySet<string>,
		readonly workspace: DetectedWorkspace,
		readonly layout: DirectoryLayout,
		/** Whether the file system takes `Src` and `src` for one name, as Windows' and macOS' do. */
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

	/** The `*.project.json` files here other than `except`, which init does not lift. */
	otherProjectFiles(...except: string[]): string[] {
		return [...this.entries]
			.filter(
				(name) =>
					name.endsWith(PROJECT_FILE_SUFFIX) &&
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
							`this config already exists, and init never overwrites or changes one. To change it, edit the .rogen.json and run 'rogen check'; for a new place, copy a config and edit the copy. To add the agent rules or the agent hook to this project, run 'rogen init --agent-rules' or 'rogen init --agent-hook'; to set Rojo up, see ${DOCS_URL}/installation.`
						)
					: errorDiagnostic(
							"init.fileExists",
							{ resource: path.join(this.path, fileName) },
							"this file already exists, and init never overwrites one. Pick another name."
						)
			);
	}

	/** The first that applies: the language's own config, `src`, the only code folder, else `src`. */
	defaultSourcePath(language: Language): string {
		const configured = language.configuredSourcePath();
		if (configured !== undefined) return configured;
		if (this.has(DEFAULT_SOURCE_PATH)) return DEFAULT_SOURCE_PATH;
		const { codeFolders } = this.layout;
		return codeFolders.length === 1 ? codeFolders[0] : DEFAULT_SOURCE_PATH;
	}
}
