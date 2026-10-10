import path from "path";
import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";

/** Nothing can be placed without a route. */
function missingRoutes(config: ResolvedConfig): Diagnostic[] {
	return config.routes.size > 0
		? []
		: [
				errorDiagnostic(
					"route.noRoutes",
					{ resource: config.file },
					"no routes declared, so nothing can be placed.\nAdd a \"routes\" map; 'rogen init' writes a starting set."
				),
			];
}

interface Blocker {
	readonly diagnostic: Diagnostic;
	readonly files: readonly string[];
}

/** The configs a run builds together, and the one rule for which of them can't be: one that declares no routes, or several that write one file. */
export class BuildSet {
	private readonly blockers: readonly Blocker[];

	constructor(readonly configs: readonly ResolvedConfig[]) {
		const byOutFile = groupBy(
			configs,
			({ outFile }) => path.resolve(outFile),
			({ file }) => file
		);
		this.blockers = [
			...configs.flatMap((config) =>
				missingRoutes(config).map((diagnostic) => ({
					diagnostic,
					files: [config.file],
				}))
			),
			...[...byOutFile]
				.filter(([, files]) => files.length > 1)
				.map(([outFile, files]) => ({
					diagnostic: errorDiagnostic(
						"output.sameOutFile",
						{ resource: outFile },
						`${files.map((file) => `"${path.basename(file)}"`).join(" and ")} write the same file, ${outFile}. Give each its own "outFile".`
					),
					files,
				})),
		];
	}

	/** The configs of `selection` when every one is valid now and they can be built together; otherwise every error. */
	static of(selection: ConfigSelection): Result<BuildSet, DiagnosticsError> {
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const set = new BuildSet(configs.value);
		return set.diagnostics.length > 0
			? err(new DiagnosticsError([...set.diagnostics]))
			: ok(set);
	}

	/** Each problem once, in the order it is reported. */
	get diagnostics(): readonly Diagnostic[] {
		return this.blockers.map(({ diagnostic }) => diagnostic);
	}

	/** The config files some problem blocks. */
	get blockedFiles(): ReadonlySet<string> {
		return new Set(this.blockers.flatMap(({ files }) => files));
	}

	/** The problems that block the config file `file`; none when it can be built. */
	blocking(file: string): readonly Diagnostic[] {
		return this.blockers
			.filter(({ files }) => files.includes(file))
			.map(({ diagnostic }) => diagnostic);
	}

	configOf(file: string): ResolvedConfig | undefined {
		return this.configs.find((config) => config.file === file);
	}

	/** The configs no problem blocks. */
	get buildable(): ResolvedConfig[] {
		const blocked = this.blockedFiles;
		return this.configs.filter(({ file }) => !blocked.has(file));
	}

	/** Every root directory of every config that can be built, which one listing covers. */
	get rootDirs(): string[] {
		return this.buildable.flatMap(({ rootDirs }) => rootDirs);
	}
}
