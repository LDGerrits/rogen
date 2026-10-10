import { plural } from "../../base/strings.js";
import {
	Diagnostic,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ConfigBuild } from "./build.js";

/** What one config adds to a run's diagnostics of one kind. */
export interface SharedPart {
	/** The diagnostics no earlier config raised. */
	readonly fresh: readonly Diagnostic[];
	/** The earlier configs that raised every one of them, when it had some and added none; empty otherwise. */
	readonly sameAs: readonly string[];
}

/** The diagnostics of one kind a run's configs raised, so a config that repeats one adds nothing for it. */
export class SharedDiagnostics {
	private readonly raisedBy = new Map<string, string>();

	private constructor(
		/** Whether a diagnostic about a config's own file equals another config's. */
		private readonly sameAcrossConfigs: boolean
	) {}

	static errors(): SharedDiagnostics {
		return new SharedDiagnostics(false);
	}

	/** Configs that read one folder find the same warnings, each filed under its own config. */
	static warnings(): SharedDiagnostics {
		return new SharedDiagnostics(true);
	}

	/** Splits `diagnostics` of the config `label`, whose file is `configFile`, into those no config raised yet and the configs that raised the rest. */
	take(
		label: string,
		configFile: string,
		diagnostics: readonly Diagnostic[]
	): SharedPart {
		const owners = new Set<string>();
		const fresh = diagnostics.filter((diagnostic) => {
			const key = diagnosticKey(
				diagnostic,
				this.sameAcrossConfigs ? configFile : undefined
			);
			const owner = this.raisedBy.get(key);
			if (owner === undefined) this.raisedBy.set(key, label);
			else if (owner !== label) owners.add(owner);
			return owner === undefined;
		});
		return {
			fresh,
			sameAs:
				diagnostics.length > 0 && fresh.length === 0 ? [...owners] : [],
		};
	}
}

/** One build of a run, with what it adds to the run's warnings and errors. */
export interface BuildShare {
	readonly build: ConfigBuild;
	/** Its warnings, then its sync dir's. */
	readonly warnings: SharedPart;
	readonly errors: SharedPart;
}

/** The builds of one run, one per selected config in order, and what the run says: a warning several configs share, or an error a config repeats, is said once, by the first. The output, `--deny-warnings` and `check` all count this way. */
export class BuildRun {
	readonly shares: readonly BuildShare[];

	constructor(readonly builds: readonly ConfigBuild[]) {
		const warnings = SharedDiagnostics.warnings();
		const errors = SharedDiagnostics.errors();
		this.shares = builds.map((build) => ({
			build,
			warnings: warnings.take(build.label, build.file, [
				...build.warnings,
				...(build.syncWarnings ?? []),
			]),
			errors: errors.take(build.label, build.file, build.errors),
		}));
	}

	/** Whether a config failed or didn't load, which writes nothing. */
	get failed(): boolean {
		return this.builds.some(
			({ outcome }) => outcome === "failed" || outcome === "notLoaded"
		);
	}

	/** Every error of every config, repeats included: what the run fails with. */
	get errors(): Diagnostic[] {
		return this.builds.flatMap(({ errors }) => errors);
	}

	/** The warnings the run says, one several configs share counted once: what `--deny-warnings` counts. */
	get warningCount(): number {
		return this.shares.reduce(
			(count, { warnings }) => count + warnings.fresh.length,
			0
		);
	}

	/** Why the run fails: an error, or, when warnings are denied, a warning it says. */
	failure(denyWarnings: boolean): Error | undefined {
		if (this.errors.length > 0) return new DiagnosticsError(this.errors);
		return denyWarnings && this.warningCount > 0
			? new Error(
					`${plural(this.warningCount, "warning")} denied by --deny-warnings.`
				)
			: undefined;
	}

	/** What the run says, config by config: its fresh warnings, then its fresh errors. */
	get diagnostics(): Diagnostic[] {
		return this.shares.flatMap(({ warnings, errors }) => [
			...warnings.fresh,
			...errors.fresh,
		]);
	}
}
