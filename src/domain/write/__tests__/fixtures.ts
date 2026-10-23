import path from "path";
import { Result, err, ok } from "../../../base/result.js";
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
	WriteService,
	ConfigLocations,
	LocateQuery,
} from "../write-service.js";
import { PreparedConfig, WritePipeline } from "../write-pipeline.js";
import { CoreWriteService } from "../core-write-service.js";
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

export const pipelineOf = (
	fs: FileSystemService,
	index: IndexReader,
	extraTools: readonly SyncTool[] = []
) => new WritePipeline(fs, index, [...syncTools, ...extraTools]);

export const writeServiceOf = (
	fs: FileSystemService,
	index: IndexService,
	extraTools: readonly SyncTool[] = []
) => new CoreWriteService(fs, index, [...syncTools, ...extraTools]);

export async function locateIn(
	writeService: WriteService,
	config: ResolvedConfig,
	targets?: LocateQuery
): Promise<Result<ConfigLocations, DiagnosticsError>> {
	const located = await writeService.locate(selectionOf(config), targets);
	return located.map(({ configs: [locations] }) => locations);
}

export const abs = (...segments: string[]): string =>
	path.resolve("/repo", ...segments);

export const configOf = (overrides: ResolvedConfigSpec = {}): ResolvedConfig =>
	mockConfig({
		file: abs("default.rogen.json"),
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

/** Makes the source paths of a test config folders, since a write of a config none of them exists for fails. */
async function withSourceFolders(
	fs: MemoryFileSystemService,
	config: ResolvedConfig
): Promise<void> {
	for (const sourcePath of config.sourcePaths)
		if (!(await fs.exists(sourcePath)))
			await fs.createDirectory(sourcePath);
}

export async function prepareAndPlace(
	fs: MemoryFileSystemService,
	config: ResolvedConfig
): Promise<
	Result<PreparedConfig & { placement: Placement }, DiagnosticsError>
> {
	await withSourceFolders(fs, config);
	const index = await indexOf(fs, config.sourcePaths);
	const pipeline = pipelineOf(fs, index);
	const prepared = await pipeline.run(config);
	if (prepared.isErr()) return err(prepared.error);
	const placement = (await pipeline.place(config)).unwrap();
	return ok({ ...prepared.value, placement });
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
		await prepareAndPlace(
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
	await withSourceFolders(fs, config);
	const index = await indexOf(fs, config.sourcePaths);
	return pipelineOf(fs, index, extraTools).run(config);
}

export const expectWrittenProject = (file: RojoProjectFile): void =>
	expectRojoProject({ name: "project", ...file });

export async function assembleFilesOf(
	fs: MemoryFileSystemService,
	overrides: ResolvedConfigSpec = {},
	extraTools: readonly SyncTool[] = []
) {
	const output = (await assembleResultOf(fs, overrides, extraTools)).unwrap();
	expectWrittenProject(output.projectFile);
	return {
		projectFile: output.projectFile,
		warnings: output.findings.warnings,
	};
}
