import { Result, err, ok } from "../../base/result.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { RogenConfig } from "../config/config.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { DetectedWorkspace } from "./detect-workspace.js";
import { InitDiagnostics } from "./init-diagnostics.js";

export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
}

export interface InitPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
}

export interface InitPlanOptions {
	readonly name: string;
	readonly workspace: DetectedWorkspace;
	readonly projectName: string;
	readonly templateExists: boolean;
}

const SCHEMA_URL = "https://rogen.dev/schema/2/rogen.json";
export const TEMPLATE_FILE = "template.project.json";
const DARKLUA_SYNC_DIR = "dist";

const STARTING_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

const serialize = (value: unknown): string =>
	`${JSON.stringify(value, null, "\t")}\n`;

const configFile = (stem: string, config: RogenConfig): PlannedFile => ({
	fileName: `${stem}${CONFIG_SUFFIX}`,
	content: serialize(config),
});

/** `names` are the positionals after `init`; `cwd` is where the config would be written. */
export function parseInitName(
	names: readonly string[],
	cwd: string
): Result<string, Diagnostic[]> {
	if (names.length > 1) {
		return err([InitDiagnostics.tooManyNames({ resource: cwd })]);
	}
	const [name = DEFAULT_CONFIG_STEM] = names;
	if (name === "." || name === ".." || /[\\/]/.test(name)) {
		return err([InitDiagnostics.invalidName({ resource: cwd }, name)]);
	}
	return ok(name);
}

export function planInit(options: InitPlanOptions): InitPlan {
	const { name, workspace } = options;
	const hasMounts = Object.keys(workspace.packageMounts).length > 0;

	const template: PlannedFile | undefined =
		hasMounts && !options.templateExists
			? {
					fileName: TEMPLATE_FILE,
					content: serialize({
						name: options.projectName,
						tree: {
							$className: "DataModel",
							...workspace.packageMounts,
						},
					} satisfies RojoTree),
				}
			: undefined;

	const starter = (syncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: ["src"],
		routes: STARTING_ROUTES,
		...((hasMounts || options.templateExists) && {
			template: TEMPLATE_FILE,
		}),
		...(syncDir && { syncDir }),
	});

	if (workspace.toolchain === "darklua") {
		const sourceStem =
			name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;
		return {
			template,
			configs: [
				configFile(sourceStem, starter()),
				configFile(name, {
					$schema: SCHEMA_URL,
					extends: `${sourceStem}${CONFIG_SUFFIX}`,
					syncDir: DARKLUA_SYNC_DIR,
				}),
			],
		};
	}

	return {
		template,
		configs: [configFile(name, starter(workspace.outDir))],
	};
}
