import { DeferredPromise } from "../../../base/async.js";
import { WrittenConfig } from "../../write/write.js";
import { configOf } from "../../write/__tests__/fixtures.js";
import { WatchedConfig } from "../watched-config.js";

describe("WatchedConfig", () => {
	const summary = {
		roots: [],
		routes: [],
		unrouted: 0,
		replaced: 0,
		displaced: 0,
	};
	const written = (readFiles: string[]) =>
		new WrittenConfig(
			configOf(),
			"wrote",
			{ warnings: [], syncWarnings: undefined },
			summary,
			readFiles
		);

	it("should know what its latest write read, whatever the form of a path", () => {
		const watched = new WatchedConfig();
		watched.finished(written(["C:\\repo\\src\\init.meta.json"]));

		expect(watched.reads("C:/repo/src/init.meta.json")).toBe(true);
		expect(watched.reads("C:/repo/src/other.meta.json")).toBe(false);
	});

	it("should know what it reads only when no rewrite is queued and the latest did not fail", async () => {
		const watched = new WatchedConfig();
		const gate = new DeferredPromise<void>();
		const queued = watched.queue(() => gate.p);

		expect(watched.readsKnown).toBe(false);
		gate.complete();
		await queued;
		await Promise.resolve();

		expect(watched.readsKnown).toBe(true);
	});

	it("should run queued rewrites one at a time, in order", async () => {
		const watched = new WatchedConfig();
		const order: number[] = [];

		await Promise.all([
			watched.queue(async () => {
				await Promise.resolve();
				order.push(1);
			}),
			watched.queue(async () => {
				order.push(2);
			}),
		]);

		expect(order).toEqual([1, 2]);
	});
});
