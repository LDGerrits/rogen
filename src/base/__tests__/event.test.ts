import { jest } from "@jest/globals";
import { Emitter } from "../event.js";
import { DisposableStore } from "../disposable.js";

describe("Emitter and Event", () => {
	it("should notify registered listeners when fired", () => {
		const emitter = new Emitter<string>();
		const listener = jest.fn();

		emitter.event(listener);
		emitter.fire("hello");

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("hello");
	});

	it("should stop notifying listeners after their disposable is disposed", () => {
		const emitter = new Emitter<number>();
		const listener = jest.fn();

		const subscription = emitter.event(listener);

		emitter.fire(1);
		subscription[Symbol.dispose]();
		emitter.fire(2);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(1);
	});

	it("should automatically register the listener's disposable into a provided DisposableStore", () => {
		const emitter = new Emitter<string>();
		const store = new DisposableStore();
		const listener = jest.fn();

		emitter.event(listener, store);

		emitter.fire("first");

		store[Symbol.dispose]();

		emitter.fire("second");

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("first");
	});

	it("should clear all listeners when the Emitter itself is disposed", () => {
		const emitter = new Emitter<void>();
		const listener = jest.fn();

		emitter.event(listener);
		emitter[Symbol.dispose]();

		emitter.fire();

		expect(listener).not.toHaveBeenCalled();
	});

	it("should safely swallow synchronous errors from listeners and continue firing remaining listeners", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const emitter = new Emitter<void>();

		const badListener = () => {
			throw new Error("Poison Pill");
		};
		const goodListener = jest.fn();

		emitter.event(badListener);
		emitter.event(goodListener);

		expect(() => emitter.fire()).not.toThrow();
		expect(goodListener).toHaveBeenCalledTimes(1);
		expect(consoleSpy).toHaveBeenCalledTimes(1);
		expect(consoleSpy).toHaveBeenCalledWith(
			"Error in event listener:",
			expect.any(Error)
		);

		consoleSpy.mockRestore();
	});

	it("should correctly handle sparse array compaction when many listeners are removed", () => {
		const emitter = new Emitter<number>();
		const listeners = Array.from({ length: 5 }).map(() => jest.fn());

		const disposables = listeners.map((l) => emitter.event(l));

		disposables[0][Symbol.dispose]();
		disposables[1][Symbol.dispose]();
		disposables[2][Symbol.dispose]();

		emitter.fire(42);

		expect(listeners[0]).not.toHaveBeenCalled();
		expect(listeners[1]).not.toHaveBeenCalled();
		expect(listeners[2]).not.toHaveBeenCalled();
		expect(listeners[3]).toHaveBeenCalledWith(42);
		expect(listeners[4]).toHaveBeenCalledWith(42);
	});
});
