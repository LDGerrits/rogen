import { Sequencer } from "../../base/async.js";
import { PathSet } from "../../base/path.js";
import {
	isError,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { LoadedBuild } from "../build/build.js";
import { RebuildReport } from "./watch-service.js";

/** What the session knows of one config: its rebuilds, and what the latest of them said. */
export class WatchedConfig {
	private readonly rebuilds = new Sequencer();
	/** Rebuilds queued that haven't finished. */
	private pending = 0;
	private _latest: LoadedBuild | undefined;
	/** The files the latest successful build read, whose updates must rebuild it. */
	private readFiles = new PathSet([]);

	/** Whether the latest successful build read `file`, however its path is written. */
	reads(file: string): boolean {
		return this.readFiles.has(file);
	}

	/** Runs `rebuild` after the ones queued before it, so rebuilds of one config never overlap. */
	queue<T>(rebuild: () => Promise<T>): Promise<T> {
		this.pending++;
		const queued = this.rebuilds.queue(rebuild);
		const done = () => {
			this.pending--;
		};
		void queued.then(done, done);
		return queued;
	}

	/** The latest finished rebuild; `undefined` before the first. */
	get latest(): LoadedBuild | undefined {
		return this._latest;
	}

	get failing(): boolean {
		return this.latest?.outcome === "failed";
	}

	/** Whether what it reads is known: no rebuild is under way and the latest didn't fail. */
	get settled(): boolean {
		return this.pending === 0 && !this.failing;
	}

	/** Records `build` as the latest, and reports what it says that the one before didn't. */
	finished(build: LoadedBuild): RebuildReport {
		const before = this.latest?.diagnostics ?? [];
		const unreported = newDiagnostics(before, build.diagnostics);
		// A failed build stops before it finds warnings, so what it doesn't list isn't fixed.
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
