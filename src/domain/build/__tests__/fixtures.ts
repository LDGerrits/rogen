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
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	ResolvedConfigSpec,
	mockConfig,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { SyncTool } from "../../toolchain/toolchain.js";
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
		file: abs("rogen.json"),
		sourcePaths: [abs("src")],
		routes: { "*": "ReplicatedStorage" },
		...overrides,
	});

export async function writeFiles(
	fs: MemoryFileSystemService,
	...paths: string[]
): Promise<void> {
	for (const file of paths) await fs.writeFile(abs(file), "");
}

export function indexOf(
	fs: MemoryFileSystemService,
	sourcePaths: readonly string[]
): Promise<Listing> {
	return new CoreIndexService(fs).list(sourcePaths);
}

export async function buildAndPlace(
	fs: MemoryFileSystemService,
	config: ResolvedConfig
): Promise<Result<BuiltConfig & { placement: Placement }, DiagnosticsError>> {
	const index = await indexOf(fs, config.sourcePaths);
	const builder = builderOf(fs, index);
	const built = await builder.build(config);
	return built.map((value) => ({
		...value,
		placement: builder.place(config).unwrap(),
	}));
}

export const placedLines = (files: readonly RoutedFile[]): string[] =>
	files.map(
		(file) =>
			`${file.entry.source.slice(abs("src").length + 1)} -> ${file.instancePath.join("/")}${file.routeMatch === "copy" ? " (copy)" : ""}`
	);

export const ROUTER_ROUTES = {
	ReplicatedFirst: "ReplicatedFirst",
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage/shared",
};

export async function routeFiles(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	sourcePaths: readonly string[] = [abs("src")]
) {
	return (
		await buildAndPlace(
			fs,
			configOf({
				routes: ROUTER_ROUTES,
				sourcePaths: [...sourcePaths],
				...overrides,
			})
		)
	).map(({ placement, projectFile, findings: { warnings } }) => ({
		placement,
		routed: placement.routed,
		files: placement.files,
		leftOut: placement.leftOut,
		globIgnorePaths: projectFile.globIgnorePaths,
		unrouted: placement.leftOut
			.withStatus("unrouted")
			.map(([source]) => source),
		warnings,
	}));
}

export const FOLDER = { $className: "Folder", $ignoreUnknownInstances: false };

export const optional = (target: string) => ({ optional: target });

export async function assembleResultOf(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	extraTools: readonly SyncTool[] = []
) {
	const config = configOf(overrides);
	const index = await indexOf(fs, config.sourcePaths);
	return builderOf(fs, index, extraTools).build(config);
}

export const expectBuiltProject = (file: RojoProjectFile): void =>
	expectRojoProject({ name: "project", ...file });

export async function assembleFilesOf(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	extraTools: readonly SyncTool[] = []
) {
	const output = (await assembleResultOf(fs, overrides, extraTools)).unwrap();
	expectBuiltProject(output.projectFile);
	return {
		projectFile: output.projectFile,
		warnings: output.findings.warnings,
	};
}
