import { DeferredPromise } from "../../../base/async.js";
import { WrittenBuild } from "../../build/build.js";
import { configOf } from "../../build/__tests__/fixtures.js";
import { WatchedConfig } from "../watched-config.js";

describe("WatchedConfig", () => {
	const summary = {
		roots: [],
		routes: [],
		variants: [],
		modes: [],
		unrouted: 0,
		replaced: 0,
		displaced: 0,
	};
	const written = (readFiles: string[]) =>
		new WrittenBuild(
			configOf(),
			"wrote",
			{ warnings: [], syncWarnings: undefined },
			summary,
			readFiles
		);

	it("should know what its latest build read, whatever the form of a path", () => {
		const watched = new WatchedConfig();
		watched.finished(written(["C:\\repo\\src\\init.meta.json"]));

		expect(watched.reads("C:/repo/src/init.meta.json")).toBe(true);
		expect(watched.reads("C:/repo/src/other.meta.json")).toBe(false);
	});

	it("should be settled only when no rebuild is queued and the latest did not fail", async () => {
		const watched = new WatchedConfig();
		const gate = new DeferredPromise<void>();
		const queued = watched.queue(() => gate.p);

		expect(watched.settled).toBe(false);
		gate.complete();
		await queued;
		await Promise.resolve();

		expect(watched.settled).toBe(true);
	});

	it("should run queued rebuilds one at a time, in order", async () => {
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
