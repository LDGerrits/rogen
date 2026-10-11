import path from "path";
import { Result } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import {
	IndexReader,
	IndexService,
	Listing,
} from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import {
	ResolvedConfigSpec,
	mockConfig,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { RojoTree } from "../../rojo/rojo-project.js";
import { SyncTool } from "../build.js";
import {
	BuildService,
	ConfigLocations,
	LocateQuery,
} from "../build-service.js";
import { BuiltConfig, ConfigBuilder } from "../config-builder.js";
import { CoreBuildService } from "../core-build-service.js";
import { Placement } from "../placement.js";
import { Placer } from "../placer.js";
import { RoutedFile } from "../router.js";

export const { syncTools } = new CoreToolchainService(
	new MemoryFileSystemService()
);

export const placeFiles = (
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
) => new Placer(index, config, tools).place();

export const builderOf = (
	fs: FileSystemService,
	index: IndexReader,
	extraTools: readonly SyncTool[] = []
) => new ConfigBuilder(fs, index, [...syncTools, ...extraTools]);

export const buildServiceOf = (
	fs: FileSystemService,
	index: IndexService,
	extraTools: readonly SyncTool[] = []
) => new CoreBuildService(fs, index, [...syncTools, ...extraTools]);

/** Where `targets` land in `config` alone. */
export async function locateIn(
	buildService: BuildService,
	config: ResolvedConfig,
	targets?: LocateQuery
): Promise<Result<ConfigLocations, DiagnosticsError>> {
	const located = await buildService.locate(selectionOf(config), targets);
	return located.map(({ configs: [locations] }) => locations);
}

export const abs = (...segments: string[]): string =>
	path.resolve("/repo", ...segments);

export const configOf = (overrides: ResolvedConfigSpec = {}): ResolvedConfig =>
	mockConfig({
		file: abs("default.rogen.json"),
		rootDirs: [abs("src")],
		routes: { "*": "ReplicatedStorage" },
		outFile: abs("default.project.json"),
		...overrides,
	});

export async function writeFiles(
	fs: MemoryFileSystemService,
	...paths: string[]
): Promise<void> {
	for (const file of paths) await fs.writeFile(abs(file), "");
}

/** What `rootDirs` hold in `fs`, listed. */
export function indexOf(
	fs: MemoryFileSystemService,
	rootDirs: readonly string[]
): Promise<Listing> {
	return new CoreIndexService(fs).list(rootDirs);
}

/** Builds `config` from what `fs` holds in its root dirs, and places it again to show where each file landed. */
export async function buildAndPlace(
	fs: MemoryFileSystemService,
	config: ResolvedConfig
): Promise<Result<BuiltConfig & { placement: Placement }, DiagnosticsError>> {
	const index = await indexOf(fs, config.rootDirs);
	const builder = builderOf(fs, index);
	const built = await builder.build(config);
	return built.map((value) => ({
		...value,
		placement: builder.place(config).unwrap(),
	}));
}

/** Each file as `source -> instance path`, its source relative to `src`, with a copy marked. */
export const placedLines = (files: readonly RoutedFile[]): string[] =>
	files.map(
		(file) =>
			`${file.entry.source.slice(abs("src").length + 1)} -> ${file.instancePath.join("/")}${file.routeMatch === "copy" ? " (copy)" : ""}`
	);

/** The routes the router tests place files by. */
export const ROUTER_ROUTES = {
	ReplicatedFirst: "ReplicatedFirst",
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage/shared",
};

/** Builds and places the files `fs` holds under `rootDirs`, and sums up where each landed. */
export async function routeFiles(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	rootDirs: readonly string[] = [abs("src")]
) {
	return (
		await buildAndPlace(
			fs,
			configOf({
				routes: ROUTER_ROUTES,
				rootDirs: [...rootDirs],
				...overrides,
			})
		)
	).map(({ placement, tree, findings: { warnings } }) => ({
		placement,
		routed: placement.routed,
		files: placement.files,
		leftOut: placement.leftOut,
		globIgnorePaths: tree.globIgnorePaths,
		unrouted: placement.leftOut
			.withStatus("unrouted")
			.map(([source]) => source),
		warnings,
	}));
}

export const FOLDER = { $className: "Folder", $ignoreUnknownInstances: false };

export const optional = (target: string) => ({ optional: target });

/** Builds the files `fs` holds under the config's root dirs, with the sync tools of `extraTools` beside the standard ones. */
export async function assembleResultOf(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	extraTools: readonly SyncTool[] = []
) {
	const config = configOf(overrides);
	const index = await indexOf(fs, config.rootDirs);
	return builderOf(fs, index, extraTools).build(config);
}

/** The project file `assembleResult` builds, checked against Rojo's schema, with the build's warnings. */
export async function assembleFilesOf(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	extraTools: readonly SyncTool[] = []
) {
	const output = (await assembleResultOf(fs, overrides, extraTools)).unwrap();
	expectRojoProject(output.tree);
	return { tree: output.tree, warnings: output.findings.warnings };
}

export const templateOf = (
	project: Partial<RojoTree>,
	file = abs("default.project.json")
) => ({ file, project });
