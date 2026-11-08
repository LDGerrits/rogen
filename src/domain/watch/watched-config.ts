import { Sequencer } from "../../base/async.js";
import { PathSet } from "../../base/path.js";
import {
	isError,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { LoadedConfig, isFailed } from "../write/write.js";
import { RewriteReport } from "./watch-service.js";

export class WatchedConfig {
	private readonly rewrites = new Sequencer();
	private pending = 0;
	private _latest: LoadedConfig | undefined;
	private readFiles = new PathSet([]);

	reads(file: string): boolean {
		return this.readFiles.has(file);
	}

	queue<T>(rewrite: () => Promise<T>): Promise<T> {
		this.pending++;
		const queued = this.rewrites.queue(rewrite);
		const done = () => {
			this.pending--;
		};
		void queued.then(done, done);
		return queued;
	}

	get latest(): LoadedConfig | undefined {
		return this._latest;
	}

	get failing(): boolean {
		return this.latest !== undefined && isFailed(this.latest);
	}

	get readsKnown(): boolean {
		return this.latest !== undefined && this.pending === 0 && !this.failing;
	}

	/** Moves the latest outcome to `config`, a reload of its config that writes the same, so it still counts as this version's. */
	rebase(config: ResolvedConfig): void {
		if (this._latest && this._latest.config !== config)
			this._latest = this._latest.withConfig(config);
	}

	finished(outcome: LoadedConfig): RewriteReport {
		const before = this.latest?.diagnostics ?? [];
		const unreported = newDiagnostics(before, outcome.diagnostics);
		const fixed = isFailed(outcome)
			? []
			: newDiagnostics(outcome.diagnostics, before).filter(
					(gone) =>
						!unreported.some(
							({ code, resource }) =>
								code === gone.code && resource === gone.resource
						)
				);
		this._latest = outcome;
		if (!isFailed(outcome)) this.readFiles = new PathSet(outcome.readFiles);
		return {
			outcome,
			unreported,
			repeated: outcome.diagnostics.filter(
				(diagnostic) => !unreported.includes(diagnostic)
			),
			fixed,
			repeatedFailure: isFailed(outcome) && !unreported.some(isError),
		};
	}
}
