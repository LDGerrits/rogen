import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import {
	configLabel,
	findUnrequestedConfigs,
} from "../../domain/config/config-discovery.js";
import {
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	requireValidConfigs,
	resolvedEntries,
} from "../../domain/config/valid-configs.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";

/** A config a command builds, with the entry that describes how it was loaded. */
export interface BuildTarget {
	readonly entry: ConfigEntry;
	readonly config: ResolvedConfig;
}

export interface BeginBuildOptions {
	readonly configService: ConfigService;
	readonly buildService: BuildService;
	readonly fileSystemService: FileSystemService;
	readonly logService: LogService;
	readonly cwd: string;
	/** Names the command in the opening line. */
	readonly command: string;
}

/**
 * What `build` and `watch` do before building anything: refuse broken or
 * unbuildable configs, then open the output and name the configs left out.
 */
export async function beginBuild({
	configService,
	buildService,
	fileSystemService,
	logService,
	cwd,
	command,
}: BeginBuildOptions): Promise<Result<BuildTarget[], Error>> {
	const valid = requireValidConfigs(configService);
	if (valid.isErr()) return valid;

	const skipped = await findUnrequestedConfigs(
		fileSystemService,
		cwd,
		configService.configs.map((entry) => entry.file)
	);
	const upfront = buildService.checkBuildable(valid.value);
	if (upfront.length > 0) return err(new DiagnosticsError(upfront));

	logService.intro(
		`rogen ${command} · ${valid.value.map(({ file }) => configLabel(file)).join(", ")}`
	);
	if (skipped.length > 0) {
		logService.info(`Not building: ${skipped.join(", ")}.`);
	}
	return ok(resolvedEntries(configService));
}
