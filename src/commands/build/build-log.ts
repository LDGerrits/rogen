import path from "path";
import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { BuildSummary } from "../../domain/build/build-service.js";
import {
	ConfigEntry,
	ResolvedEntry,
} from "../../domain/config/config-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** The `extends` chain and skipped tag flags of a config. */
function describeConfig(entry: ConfigEntry, cwd: string): string[] {
	const parents = entry.parents.map((file) => relativeTo(cwd, file));
	return [
		...(parents.length > 0 ? [`extends: ${parents.join(" -> ")}`] : []),
		...entry.skippedTags.map(
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
		targets: readonly ResolvedEntry[],
		unselected: readonly string[]
	): void {
		this.logService.intro(
			`rogen ${command} · ${targets.map(({ config }) => config.label).join(", ")}`
		);
		if (unselected.length > 0) {
			this.logService.info(
				`Not building: ${unselected.map((file) => path.basename(file)).join(", ")}.`
			);
		}
	}

	/** Heads the lines about one config, when a run builds several. */
	heading({ config }: ResolvedEntry): void {
		this.logService.step(config.label);
	}

	/** One config written, or left alone because its bytes wouldn't change, then what its build warned about. */
	written(
		{ entry, config }: ResolvedEntry,
		written: boolean,
		summary: BuildSummary,
		diagnostics: readonly Diagnostic[]
	): void {
		this.logService.success(
			`${relativeTo(this.cwd, config.outFile)} · ${written ? "wrote" : "unchanged"}`
		);
		this.details(entry, summary);
		this.diagnostics(diagnostics);
	}

	/** One config that wasn't written, then why; no diagnostics means they were all reported before. */
	notWritten(
		{ entry, config }: ResolvedEntry,
		diagnostics: readonly Diagnostic[]
	): void {
		const repeated = diagnostics.length === 0;
		this.logService.error(
			`${relativeTo(this.cwd, config.outFile)} · not written${repeated ? " · same errors as before" : ""}`
		);
		this.details(entry);
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
	private details(entry: ConfigEntry, summary?: BuildSummary): void {
		for (const line of [
			...describeConfig(entry, this.cwd),
			...(summary ? describeBuild(summary, this.cwd) : []),
		])
			this.logService.debug(line);
	}
}
