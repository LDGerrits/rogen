import { Sequencer } from "../../base/async.js";
import { PathSet } from "../../base/path.js";
import {
	isError,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { LoadedConfig } from "../write/write.js";
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
		return this.latest?.kind === "failed";
	}

	get readsKnown(): boolean {
		return this.pending === 0 && !this.failing;
	}

	finished(outcome: LoadedConfig): RewriteReport {
		const before = this.latest?.diagnostics ?? [];
		const unreported = newDiagnostics(before, outcome.diagnostics);
		const fixed =
			outcome.kind === "failed"
				? []
				: newDiagnostics(outcome.diagnostics, before).filter(
						(gone) =>
							!unreported.some(
								({ code, resource }) =>
									code === gone.code &&
									resource === gone.resource
							)
					);
		this._latest = outcome;
		if (outcome.kind !== "failed")
			this.readFiles = new PathSet(outcome.readFiles);
		return {
			outcome,
			unreported,
			repeated: outcome.diagnostics.filter(
				(diagnostic) => !unreported.includes(diagnostic)
			),
			fixed,
			repeatedFailure:
				outcome.kind === "failed" && !unreported.some(isError),
		};
	}
}
