import { relativeTo } from "../../base/path.js";
import { joinedWithAnd, plural } from "../../base/strings.js";
import { BuildSummary, ConfigBuild } from "../../domain/build/build.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import {
	Diagnostic,
	renderDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** The `extends` chain and skipped variant flags of a config. */
function describeConfig(config: ResolvedConfig, cwd: string): string[] {
	const parents = config.parents.map((file) => relativeTo(cwd, file));
	return [
		...(parents.length > 0 ? [`extends: ${parents.join(" -> ")}`] : []),
		...config.skippedVariants.map(
			(variant) =>
				`variant ${variant} skipped: not declared in this config`
		),
	];
}

/** One line per root dir, route and variant. */
function describeBuild(summary: BuildSummary, cwd: string): string[] {
	const roots = summary.roots.map(
		({ rootDir, files, excluded, mounted, skippedLinks }) =>
			[
				`${relativeTo(cwd, rootDir)}: ${plural(files, "file")}`,
				...(excluded > 0 ? [`${excluded} excluded`] : []),
				...(mounted > 0 ? [`${mounted} mounted`] : []),
				...(skippedLinks > 0
					? [plural(skippedLinks, "skipped link")]
					: []),
			].join(", ")
	);
	const routes = summary.routes.map(
		({ key, target, files }) =>
			`route ${key} -> ${target}: ${plural(files, "file")}`
	);
	const variants = summary.variants.map(({ variant, on, files }) =>
		on
			? `variant ${variant} on: ${plural(files, "file")}`
			: `variant ${variant} off: ${plural(files, "file")} left out`
	);
	const leftOut = [
		...(summary.unrouted > 0 ? [`${summary.unrouted} unrouted`] : []),
		...(summary.replaced > 0
			? [`${summary.replaced} replaced by a file with the same name`]
			: []),
		...(summary.displaced > 0
			? [`${summary.displaced} displaced by the template`]
			: []),
	];
	return [
		...roots,
		...routes,
		...variants,
		...(leftOut.length > 0 ? [`left out: ${leftOut.join(", ")}`] : []),
	];
}

/** How `build` and `watch` tell the user what they built, relative to where they run. */
export class BuildLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** Opens the output: the command and the configs it builds. */
	begin(command: string, configs: readonly ResolvedConfig[]): void {
		this.logService.intro(
			`rogen ${command} · ${configs.map(({ label }) => label).join(", ")}`
		);
	}

	/** The whole output of a build: each config's outcome, warnings and errors, then the closing line. An error an earlier config printed is not printed again; the line says so. */
	report(builds: readonly ConfigBuild[]): void {
		this.begin(
			"build",
			builds.map(({ config }) => config)
		);
		const printedBy = new Map<string, string>();
		for (const build of builds) {
			if (builds.length > 1) this.heading(build.config);
			const errors = build.outcome === "failed" ? build.errors : [];
			const shared = new Set<string>();
			const fresh = errors.filter((error) => {
				const key = renderDiagnostic(error);
				const owner = printedBy.get(key);
				if (owner !== undefined) shared.add(owner);
				else printedBy.set(key, build.config.label);
				return owner === undefined;
			});
			this.outcome(
				build,
				[...build.warnings, ...(build.syncWarnings ?? []), ...fresh],
				build.outcome === "notWritten"
					? `${joinedWithAnd(build.blockedBy.map(({ label }) => label))} failed`
					: errors.length > 0 && fresh.length === 0
						? `same errors as ${joinedWithAnd([...shared])}`
						: undefined
			);
		}
		if (builds.some(({ outcome }) => outcome === "failed"))
			this.logService.closeFrame("build failed.");
		else this.end(builds.length);
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
				this.logService.error(line("not written"));
				this.details(build.config, build.summary);
				break;
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
