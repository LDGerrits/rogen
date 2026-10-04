import path from "path";
import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { BuildSummary, ConfigBuild } from "../../domain/build/build-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** The `extends` chain and skipped tag flags of a config. */
function describeConfig(config: ResolvedConfig, cwd: string): string[] {
	const parents = config.parents.map((file) => relativeTo(cwd, file));
	return [
		...(parents.length > 0 ? [`extends: ${parents.join(" -> ")}`] : []),
		...config.skippedTags.map(
			(tag) => `tag ${tag} skipped: not declared in this config`
		),
	];
}

/** One line per root dir, route and tag. */
function describeBuild(summary: BuildSummary, cwd: string): string[] {
	const roots = summary.roots.map(
		({ rootDir, files, excluded, skippedLinks }) =>
			[
				`${relativeTo(cwd, rootDir)}: ${plural(files, "file")}`,
				...(excluded > 0 ? [`${excluded} excluded`] : []),
				...(skippedLinks > 0
					? [plural(skippedLinks, "skipped link")]
					: []),
			].join(", ")
	);
	const routes = summary.routes.map(
		({ key, target, files }) =>
			`route ${key} -> ${target}: ${plural(files, "file")}`
	);
	const tags = summary.tags.map(({ tag, on, files }) =>
		on
			? `tag ${tag} on: ${plural(files, "file")}`
			: `tag ${tag} off: ${plural(files, "file")} left out`
	);
	const leftOut = [
		...(summary.unrouted > 0 ? [`${summary.unrouted} unrouted`] : []),
		...(summary.superseded > 0
			? [`${summary.superseded} replaced by a file with the same name`]
			: []),
		...(summary.displaced > 0
			? [`${summary.displaced} displaced by the template`]
			: []),
	];
	return [
		...roots,
		...routes,
		...tags,
		...(leftOut.length > 0 ? [`left out: ${leftOut.join(", ")}`] : []),
	];
}

/** How `build` and `watch` tell the user what they built, relative to where they run. */
export class BuildLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** Opens the output: the command, the configs it builds and the ones it leaves out. */
	begin(
		command: string,
		configs: readonly ResolvedConfig[],
		unselected: readonly string[]
	): void {
		this.logService.intro(
			`rogen ${command} · ${configs.map(({ label }) => label).join(", ")}`
		);
		if (unselected.length > 0) {
			this.logService.info(
				`Not building: ${unselected.map((file) => path.basename(file)).join(", ")}.`
			);
		}
	}

	/** Heads the lines about one config, when a run builds several. */
	heading(config: ResolvedConfig): void {
		this.logService.step(config.label);
	}

	/** One config's line for what the run did to its project file, ending in `note` if given, then `diagnostics`. */
	outcome(
		build: ConfigBuild,
		diagnostics: readonly Diagnostic[],
		note?: string
	): void {
		const line = (outcome: string) =>
			[relativeTo(this.cwd, build.config.outFile), outcome, note]
				.filter((part) => part !== undefined)
				.join(" · ");
		switch (build.outcome) {
			case "wrote":
			case "unchanged":
				this.logService.success(line(build.outcome));
				this.details(build.config, build.summary);
				break;
			case "notWritten":
			case "failed":
				this.logService.error(line("not written"));
				this.details(build.config);
				break;
		}
		this.diagnostics(diagnostics);
	}

	diagnostics(diagnostics: readonly Diagnostic[]): void {
		for (const diagnostic of diagnostics)
			this.logService.diagnostic(diagnostic);
	}

	/** Closes the output of a build that wrote every config. */
	end(configs: number): void {
		this.logService.outro(`Built ${plural(configs, "config")}.`);
	}

	/** The `--verbose` lines for one config: how it was loaded and, once built, what the build placed. */
	private details(config: ResolvedConfig, summary?: BuildSummary): void {
		for (const line of [
			...describeConfig(config, this.cwd),
			...(summary ? describeBuild(summary, this.cwd) : []),
		])
			this.logService.debug(line);
	}
}
