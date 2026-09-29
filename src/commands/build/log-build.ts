import { relativeTo } from "../../base/path.js";
import { BuildSummary } from "../../domain/build/build-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { describeBuild } from "./describe-build.js";
import { describeConfig } from "./describe-config.js";

/** The output file as `build` and `watch` name it, relative to where they run. */
export const outFileLabel = (config: ResolvedConfig, cwd: string): string =>
	relativeTo(cwd, config.outFile);

/** The `--verbose` lines for one config: how it was loaded and, once built, what the build placed. */
export function logBuildDetails(
	logService: LogService,
	cwd: string,
	entry: ConfigEntry,
	summary?: BuildSummary
): void {
	for (const line of [
		...describeConfig(entry, cwd),
		...(summary ? describeBuild(summary, cwd) : []),
	])
		logService.debug(line);
}

/** One config written, or left alone because its bytes wouldn't change. */
export function logWritten(
	logService: LogService,
	cwd: string,
	{ entry, config }: { entry: ConfigEntry; config: ResolvedConfig },
	written: boolean,
	summary: BuildSummary
): void {
	logService.success(
		`${outFileLabel(config, cwd)} · ${written ? "wrote" : "unchanged"}`
	);
	logBuildDetails(logService, cwd, entry, summary);
}
