import { Sequencer } from "../../base/async.js";
import { PathSet } from "../../base/path.js";
import {
	isError,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { LoadedConfig } from "../write/write.js";
import { RebuildReport } from "./watch-service.js";

export class WatchedConfig {
	private readonly rebuilds = new Sequencer();
	private pending = 0;
	private _latest: LoadedConfig | undefined;
	private readFiles = new PathSet([]);

	reads(file: string): boolean {
		return this.readFiles.has(file);
	}

	queue<T>(rebuild: () => Promise<T>): Promise<T> {
		this.pending++;
		const queued = this.rebuilds.queue(rebuild);
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
		return this.latest?.outcome === "failed";
	}

	get readsKnown(): boolean {
		return this.pending === 0 && !this.failing;
	}

	finished(build: LoadedConfig): RebuildReport {
		const before = this.latest?.diagnostics ?? [];
		const unreported = newDiagnostics(before, build.diagnostics);
		const fixed =
			build.outcome === "failed"
				? []
				: newDiagnostics(build.diagnostics, before).filter(
						(gone) =>
							!unreported.some(
								({ code, resource }) =>
									code === gone.code &&
									resource === gone.resource
							)
					);
		this._latest = build;
		if (build.outcome !== "failed")
			this.readFiles = new PathSet(build.readFiles);
		return {
			build,
			unreported,
			repeated: build.diagnostics.filter(
				(diagnostic) => !unreported.includes(diagnostic)
			),
			fixed,
			repeatedFailure:
				build.outcome === "failed" && !unreported.some(isError),
		};
	}
}
