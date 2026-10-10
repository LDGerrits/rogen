import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
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
import { SyncTool } from "../sync-tool.js";
import {
	BuildService,
	ConfigLocations,
	LocateTargets,
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
	targets?: LocateTargets
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
	_store: DisposableStore,
	fs: MemoryFileSystemService,
	rootDirs: readonly string[]
): Promise<Listing> {
	return new CoreIndexService(fs).list(rootDirs);
}

/** Builds `config` from what `fs` holds in its root dirs, and places it again to show where each file landed. */
export async function buildAndPlace(
	store: DisposableStore,
	fs: MemoryFileSystemService,
	config: ResolvedConfig
): Promise<Result<BuiltConfig & { placement: Placement }, DiagnosticsError>> {
	const index = await indexOf(store, fs, config.rootDirs);
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
