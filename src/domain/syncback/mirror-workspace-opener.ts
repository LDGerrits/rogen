import { UsageError } from "../../base/errors.js";
import { toNative, toPosix, samePath } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ConfigService, validFile } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ProjectText } from "../rojo/project-text.js";
import { WriteService } from "../write/write-service.js";
import { MirrorWorkspace } from "./mirror-workspace.js";
import { SyncbackRequest } from "./syncback.js";
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackMirror } from "./syncback-mirror.js";
import { MIRROR, SyncbackStaging } from "./syncback-staging.js";

/** Opens the mirror of a project: the project file a write would write, the layout of its places, and the staging folder it syncs back in. */
export class MirrorWorkspaceOpener {
	constructor(
		@ConfigService private readonly configService: ConfigService,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@WriteService private readonly writeService: WriteService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	/** The mirror of the request's project, from the project file a write would write; fails when the project does not build, or when two of its files make instances whose names differ only in case. */
	async open(
		request: SyncbackRequest
	): Promise<Result<MirrorWorkspace, Error>> {
		const { project } = request;
		const { writeService, fileSystemService } = this;
		const dir = project.projectDir;
		const located = await writeService.locate(request.selection);
		if (located.isErr()) return located;
		const here = located.value.configs.find(
			({ config }) => config.id === project.id
		);
		if (!here)
			return err(
				new Error(`${project.label} was not found among the projects.`)
			);
		const fresh = await writeService.projectFileOf(project);
		if (!fresh)
			return err(
				new UsageError(
					`${project.label} does not build, so there is no project file to read; run 'rogen write' to see why.`
				)
			);
		const written = JSON.parse(ProjectText.of(fresh)) as RojoProjectFile;
		const layout = new SyncbackLayout(
			project,
			here.files,
			await this.otherConfigsOf(project)
		);
		const mirror = await SyncbackMirror.of({
			// Rojo crashes on a project file not named default.project.json that names no project.
			written: { ...written, name: written.name ?? project.projectName },
			tree: project.project.getFile().tree,
			dir,
			root: MIRROR,
			placed: layout.placed,
			reads: [
				...project.sourcePaths,
				...(project.compiledPath === undefined
					? []
					: [project.compiledPath]),
			].map(toPosix),
			fileAt: (target) => RojoFile.at(target, project.syncRules),
			isFolder: (target) =>
				fileSystemService.isDirectory(toNative(target)),
			readText: async (target) => {
				const read = await tryWithAsync(() =>
					fileSystemService.readFile(toNative(target))
				);
				return read.isOk() ? read.value : undefined;
			},
		});
		const [clash] = mirror.clashes;
		if (clash)
			return err(
				new UsageError(
					`${clash.map((file) => toNative(file)).join(" and ")} make instances whose names differ only in letter case, which syncback can't tell apart on every system.`,
					"Rename one of them, then run syncback again."
				)
			);
		const staging = this.instantiationService.createInstance(
			SyncbackStaging,
			this.environmentService.pid,
			dir
		);
		return ok(
			this.instantiationService.createInstance(
				MirrorWorkspace,
				request,
				staging,
				written,
				mirror,
				layout
			)
		);
	}

	/** The configs beside `project` in its folder, which together with it are the places of one game. */
	private async otherConfigsOf(
		project: ResolvedConfig
	): Promise<ResolvedConfig[]> {
		const { configService } = this;
		const configs: ResolvedConfig[] = [];
		for (const file of await configService.configsIn(project.projectDir)) {
			if (samePath(file, project.file)) continue;
			const { config } = validFile(await configService.read(file)) ?? {};
			if (config) configs.push(config);
		}
		return configs;
	}
}
