import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { ConfigService } from "../../config/config-service.js";
import { RojoCommandService } from "../../runner/rojo-command-service.js";
import { WriteService } from "../../write/write-service.js";
import { CoreSyncbackService } from "../core-syncback-service.js";
import { SyncbackStaging } from "../syncback-staging.js";

export interface SyncbackFakes {
	readonly configService: ConfigService;
	readonly fileSystemService: FileSystemService;
	readonly writeService: WriteService;
	readonly rojoService: RojoCommandService;
	readonly environmentService: EnvironmentService;
	readonly processService: ProcessService;
	readonly lifecycleService: LifecycleService;
}

const instantiationFor = (fakes: SyncbackFakes) =>
	instantiationOf(
		[ConfigService, fakes.configService],
		[FileSystemService, fakes.fileSystemService],
		[WriteService, fakes.writeService],
		[RojoCommandService, fakes.rojoService],
		[EnvironmentService, fakes.environmentService],
		[ProcessService, fakes.processService],
		[LifecycleService, fakes.lifecycleService]
	);

/** The syncback service over the fakes of a test. */
export const syncbackServiceOf = (fakes: SyncbackFakes): CoreSyncbackService =>
	instantiationFor(fakes).createInstance(CoreSyncbackService);

/** The services of a mirror workspace, with the container that builds what it needs. */
export const workspaceServicesOf = (fakes: SyncbackFakes) => ({
	...fakes,
	instantiationService: instantiationFor(fakes),
});

export const stagingOf = (
	fs: FileSystemService,
	processes: ProcessService,
	lifecycle: LifecycleService,
	pid: number,
	dir: string
): SyncbackStaging =>
	instantiationOf(
		[FileSystemService, fs],
		[ProcessService, processes],
		[LifecycleService, lifecycle]
	).createInstance(SyncbackStaging, pid, dir);
