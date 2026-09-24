import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { RogenConfig } from "../config/config.js";
import { RojoNode, RojoTree } from "../rojo/rojo-tree.js";
import { DetectedWorkspace, PACKAGE_DIRS } from "./detect-workspace.js";

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
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

export const InitDiagnostics = {
	configExists: (location: DiagnosticLocation) =>
		errorDiagnostic(
			"init.configExists",
			location,
			"this config already exists. Delete it to write a new one."
		),
};

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

const mount = (mountPath: string): RojoNode => ({ $path: mountPath });

function packageMounts(workspace: DetectedWorkspace): RojoNode {
	const replicatedStorage: RojoNode = {};
	const serverScriptService: RojoNode = {};

	if (workspace.rbxtsScopes.length > 0) {
		replicatedStorage.rbxts_include = {
			...(workspace.hasInclude && mount("include")),
			node_modules: {
				$className: "Folder",
				...Object.fromEntries(
					workspace.rbxtsScopes.map((scope) => [
						scope,
						mount(`node_modules/${scope}`),
					])
				),
			},
		};
	}

	if (workspace.packageManager) {
		const { shared, server } = PACKAGE_DIRS[workspace.packageManager];
		if (workspace.packageDirs.has(shared)) {
			replicatedStorage.Packages = mount(shared);
		}
		if (workspace.packageDirs.has(server)) {
			serverScriptService.ServerPackages = mount(server);
		}
	}

	return {
		...(Object.keys(replicatedStorage).length > 0 && {
			ReplicatedStorage: replicatedStorage,
		}),
		...(Object.keys(serverScriptService).length > 0 && {
			ServerScriptService: serverScriptService,
		}),
	};
}

const configFile = (stem: string, config: RogenConfig): PlannedFile => ({
	fileName: `${stem}${CONFIG_SUFFIX}`,
	content: serialize(config),
});

/** `names` are the positionals after `init`. */
export function parseInitName(names: readonly string[]): Result<string, Error> {
	if (names.length > 1) {
		return err(new Error("init takes at most one config name."));
	}
	const [name = DEFAULT_CONFIG_STEM] = names;
	if (name === "." || name === ".." || /[\\/]/.test(name)) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it can't contain path separators.`
			)
		);
	}
	return ok(name);
}

export function planInit(
	options: InitPlanOptions
): Result<InitPlan, Diagnostic[]> {
	const plan = buildPlan(options);
	const existing = plan.configs
		.filter(({ fileName }) => options.existingFiles.has(fileName))
		.map(({ fileName }) =>
			InitDiagnostics.configExists({
				resource: path.join(options.directory, fileName),
			})
		);
	return existing.length > 0 ? err(existing) : ok(plan);
}

function buildPlan(options: InitPlanOptions): InitPlan {
	const { name, workspace } = options;
	const mounts = packageMounts(workspace);
	const hasMounts = Object.keys(mounts).length > 0;
	const templateExists = options.existingFiles.has(TEMPLATE_FILE);

	const template: PlannedFile | undefined =
		hasMounts && !templateExists
			? {
					fileName: TEMPLATE_FILE,
					content: serialize({
						name: options.projectName,
						tree: {
							$className: "DataModel",
							...mounts,
						},
					} satisfies RojoTree),
				}
			: undefined;

	const starter = (syncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: ["src"],
		routes: STARTING_ROUTES,
		...((hasMounts || templateExists) && {
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
