import { NullLogService } from "../../log/null-log-service.js";
import { AbstractWatcher } from "../abstract-watcher.js";

class RecordingWatcher extends AbstractWatcher {
	readonly started: (readonly string[])[] = [];

	protected async startWatching(paths: readonly string[]): Promise<void> {
		this.started.push(paths);
	}

	protected async stopWatching(): Promise<void> {}
}

describe("AbstractWatcher", () => {
	it("should not start watching once it is disposed", async () => {
		const watcher = new RecordingWatcher(new NullLogService());

		watcher[Symbol.dispose]();
		await watcher.watch(["/repo/src"]);

		expect(watcher.started).toEqual([]);
	});

	it("should not start a watch that was queued before it was disposed", async () => {
		const watcher = new RecordingWatcher(new NullLogService());

		const watching = watcher.watch(["/repo/src"]);
		watcher[Symbol.dispose]();
		await watching;

		expect(watcher.started).toEqual([]);
	});
});
