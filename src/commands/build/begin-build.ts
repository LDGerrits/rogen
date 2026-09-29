import { Result, err, ok } from "../../base/result.js";
import { checkBuildable } from "../../domain/build/build.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import {
	configLabel,
	findUnrequestedConfigs,
} from "../../domain/config/config-discovery.js";
import {
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

/** A config a command builds, with the entry that describes how it was loaded. */
export interface BuildTarget {
	readonly entry: ConfigEntry;
	readonly config: ResolvedConfig;
}

/**
 * What `build` and `watch` do before building anything: refuse broken or
 * unbuildable configs, then open the output and name the configs left out.
 */
export async function beginBuild(
	accessor: ServicesAccessor,
	command: string
): Promise<Result<BuildTarget[], Error>> {
	const configService = accessor.get(ConfigService);
	const fileSystemService = accessor.get(FileSystemService);
	const environmentService = accessor.get(EnvironmentService);
	const logService = accessor.get(LogService);

	const valid = requireValidConfigs(configService);
	if (valid.isErr()) return valid;

	const skipped = await findUnrequestedConfigs(
		fileSystemService,
		environmentService.cwd,
		configService.configs.map((entry) => entry.file)
	);
	const upfront = checkBuildable(valid.value);
	if (upfront.length > 0) return err(new DiagnosticsError(upfront));

	logService.intro(
		`rogen ${command} · ${valid.value.map(({ file }) => configLabel(file)).join(", ")}`
	);
	if (skipped.length > 0) {
		logService.info(`Not building: ${skipped.join(", ")}.`);
	}
	return ok(
		configService.configs.flatMap((entry) =>
			entry.resolved ? [{ entry, config: entry.resolved }] : []
		)
	);
}
