import { jest } from "@jest/globals";
import { DisposableStore } from "../../../base/disposable.js";
import { NativeLifecycleService } from "../native-lifecycle-service.js";

describe("NativeLifecycleService", () => {
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should fire onWillShutdown when the process receives SIGTERM", () => {
		const service = store.add(new NativeLifecycleService());
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should leave the signals to the process until something listens", () => {
		const before = process.listenerCount("SIGTERM");

		store.add(new NativeLifecycleService());

		expect(process.listenerCount("SIGTERM")).toBe(before);
	});

	it("should stop listening for signals once disposed", () => {
		const before = process.listenerCount("SIGINT");
		const service = new NativeLifecycleService();
		service.onWillShutdown(() => undefined);

		service[Symbol.dispose]();

		expect(process.listenerCount("SIGINT")).toBe(before);
	});
});
