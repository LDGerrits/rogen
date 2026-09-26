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
import { RojoNode, RojoPath, RojoTree } from "../rojo/rojo-tree.js";
import {
	DEFAULT_OUT_DIR,
	DetectedWorkspace,
	Language,
	PACKAGE_DIRS,
	RBXTS_SCOPES,
} from "./detect-workspace.js";

export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
}

export interface InitPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	readonly nextSteps: readonly string[];
}

export interface TemplateMount {
	readonly path: string;
	readonly optional: boolean;
}

export interface MountCandidate {
	readonly path: string;
	readonly installed: boolean;
}

export interface InitChoices {
	readonly name: string;
	readonly language: Language;
	readonly darklua: boolean;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	readonly mounts: readonly TemplateMount[];
}

export interface InitPlanOptions {
	readonly choices: InitChoices;
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

const INCLUDE_DIR = "include";
const SCOPE_PARENT = "node_modules/";

const rojoPath = ({ path: mountPath, optional }: TemplateMount): RojoPath =>
	optional ? { optional: mountPath } : mountPath;

const mountNode = (mount: TemplateMount): RojoNode => ({
	$path: rojoPath(mount),
});

export function syncDirFor(
	language: Language,
	darklua: boolean,
	workspace: DetectedWorkspace
): string | undefined {
	if (darklua) return DARKLUA_SYNC_DIR;
	return language === "roblox-ts"
		? (workspace.outDir ?? DEFAULT_OUT_DIR)
		: undefined;
}

export const sourceStemOf = (name: string): string =>
	name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;

const hasSourceConfig = (language: Language, darklua: boolean): boolean =>
	language === "luau" && darklua;

/** Every config file `init` writes for `name`. */
export function configFileNames(
	name: string,
	language: Language,
	darklua: boolean
): string[] {
	const stems = hasSourceConfig(language, darklua)
		? [sourceStemOf(name), name]
		: [name];
	return stems.map((stem) => `${stem}${CONFIG_SUFFIX}`);
}

/** Everything a template could mount, found or not. */
export function mountCandidates(
	workspace: DetectedWorkspace
): readonly MountCandidate[] {
	const { shared, server } =
		PACKAGE_DIRS[workspace.packageManager ?? "wally"];
	return [
		{ path: INCLUDE_DIR, installed: workspace.hasInclude },
		...RBXTS_SCOPES.map((scope) => ({
			path: `${SCOPE_PARENT}${scope}`,
			installed: workspace.rbxtsScopes.includes(scope),
		})),
		...[shared, server].map((dir) => ({
			path: dir,
			installed:
				workspace.packageManager !== undefined &&
				workspace.packageDirs.has(dir),
		})),
	];
}

export function defaultInitChoices(
	workspace: DetectedWorkspace,
	name: string
): InitChoices {
	const candidates = mountCandidates(workspace);
	const hasScopes = workspace.rbxtsScopes.length > 0;
	const syncDir = syncDirFor(
		workspace.language,
		workspace.darklua,
		workspace
	);
	return {
		name,
		language: workspace.language,
		darklua: workspace.darklua,
		rootDirs: ["src"],
		...(syncDir && { syncDir }),
		mounts: candidates
			.filter(
				({ path: mountPath, installed }) =>
					installed && (mountPath !== INCLUDE_DIR || hasScopes)
			)
			.map(({ path: mountPath }) => ({
				path: mountPath,
				optional: false,
			})),
	};
}

function templateTree(mounts: readonly TemplateMount[]): RojoNode {
	const replicatedStorage: RojoNode = {};
	const serverScriptService: RojoNode = {};

	const include = mounts.find(({ path }) => path === INCLUDE_DIR);
	const scopes = mounts.filter(({ path }) => path.startsWith(SCOPE_PARENT));
	if (include || scopes.length > 0) {
		replicatedStorage.rbxts_include = {
			...(include && mountNode(include)),
			...(scopes.length > 0 && {
				node_modules: {
					$className: "Folder",
					...Object.fromEntries(
						scopes.map((scope) => [
							scope.path.slice(SCOPE_PARENT.length),
							mountNode(scope),
						])
					),
				},
			}),
		};
	}

	const dirs = Object.values(PACKAGE_DIRS);
	const shared = mounts.find(({ path }) =>
		dirs.some((dir) => dir.shared === path)
	);
	const server = mounts.find(({ path }) =>
		dirs.some((dir) => dir.server === path)
	);
	if (shared) replicatedStorage.Packages = mountNode(shared);
	if (server) serverScriptService.ServerPackages = mountNode(server);

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
	if (name.trim() === "") {
		return err(new Error("A config name can't be empty."));
	}
	if (name === "." || name === ".." || /[\\/]/.test(name)) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it can't contain path separators.`
			)
		);
	}
	return ok(name);
}

/** One diagnostic per file in `fileNames` that already exists in `directory`. */
export const existingFileDiagnostics = (
	fileNames: readonly string[],
	directory: string,
	existingFiles: ReadonlySet<string>
): Diagnostic[] =>
	fileNames
		.filter((fileName) => existingFiles.has(fileName))
		.map((fileName) =>
			InitDiagnostics.configExists({
				resource: path.join(directory, fileName),
			})
		);

export function planInit(
	options: InitPlanOptions
): Result<InitPlan, Diagnostic[]> {
	const plan = buildPlan(options);
	const existing = existingFileDiagnostics(
		plan.configs.map(({ fileName }) => fileName),
		options.directory,
		options.existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
}

function nextSteps({
	name,
	language,
	darklua,
	rootDirs,
	syncDir,
}: InitChoices): string[] {
	const steps = [
		...(language === "roblox-ts" ? ["rbxtsc -w"] : []),
		name === DEFAULT_CONFIG_STEM ? "rogen watch" : `rogen watch ${name}`,
		`rojo serve ${name}.project.json`,
	];
	if (darklua && syncDir) {
		steps.push(
			`Darklua must process each root dir into ${syncDir} (darklua process ${rootDirs[0]} ${syncDir}).`
		);
	}
	steps.push(
		`Add your own routes under "routes" in ${name}${CONFIG_SUFFIX}.`
	);
	return steps;
}

function buildPlan(options: InitPlanOptions): InitPlan {
	const { name, language, darklua, rootDirs, syncDir, mounts } =
		options.choices;
	const tree = templateTree(mounts);
	const hasMounts = Object.keys(tree).length > 0;
	const templateExists = options.existingFiles.has(TEMPLATE_FILE);

	const template: PlannedFile | undefined =
		hasMounts && !templateExists
			? {
					fileName: TEMPLATE_FILE,
					content: serialize({
						name: options.projectName,
						tree: {
							$className: "DataModel",
							...tree,
						},
					} satisfies RojoTree),
				}
			: undefined;

	const starter = (starterSyncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: [...rootDirs],
		routes: STARTING_ROUTES,
		...((hasMounts || templateExists) && {
			template: TEMPLATE_FILE,
		}),
		...(starterSyncDir && { syncDir: starterSyncDir }),
	});

	const steps = nextSteps(options.choices);

	if (hasSourceConfig(language, darklua)) {
		const sourceStem = sourceStemOf(name);
		return {
			template,
			nextSteps: steps,
			configs: [
				configFile(sourceStem, starter()),
				configFile(name, {
					$schema: SCHEMA_URL,
					extends: `${sourceStem}${CONFIG_SUFFIX}`,
					...(syncDir && { syncDir }),
				}),
			],
		};
	}

	return {
		template,
		configs: [configFile(name, starter(syncDir))],
		nextSteps: steps,
	};
}
