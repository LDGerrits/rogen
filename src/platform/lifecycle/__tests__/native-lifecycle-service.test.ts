import { jest } from "@jest/globals";
import { NativeLifecycleService } from "../native-lifecycle-service.js";

describe("NativeLifecycleService", () => {
	it("should fire onWillShutdown when the process receives SIGTERM", () => {
		const service = new NativeLifecycleService();
		const listener = jest.fn();
		service.onWillShutdown(listener);

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
		service[Symbol.dispose]();
	});

	it("should stop listening for signals once disposed", () => {
		const before = process.listenerCount("SIGINT");
		const service = new NativeLifecycleService();

		service[Symbol.dispose]();

		expect(process.listenerCount("SIGINT")).toBe(before);
	});
});
