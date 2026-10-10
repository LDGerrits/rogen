import { jest } from "@jest/globals";
import { Emitter, NullEvent } from "../event.js";
import { DisposableStore } from "../disposable.js";
import { setUnexpectedErrorHandler } from "../errors.js";

describe("Emitter and Event", () => {
	it("should notify registered listeners when fired", () => {
		const emitter = new Emitter<string>();
		const listener = jest.fn();

		emitter.event(listener);
		emitter.fire("hello");

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("hello");
	});

	it("should not tell a listener added while an event is delivered about that event", () => {
		const emitter = new Emitter<number>();
		const late = jest.fn();

		emitter.event(() => {
			emitter.event(late);
		});
		emitter.fire(1);

		expect(late).not.toHaveBeenCalled();
		emitter.fire(2);
		expect(late).toHaveBeenCalledWith(2);
	});

	it("should skip a listener disposed while an event is delivered", () => {
		const emitter = new Emitter<number>();
		const second = jest.fn();
		const subscriptions: { [Symbol.dispose](): void }[] = [];

		emitter.event(() => subscriptions[0][Symbol.dispose]());
		subscriptions.push(emitter.event(second));
		emitter.fire(1);

		expect(second).not.toHaveBeenCalled();
	});

	it("should keep one function subscribed twice as two subscriptions", () => {
		const emitter = new Emitter<number>();
		const listener = jest.fn();

		const first = emitter.event(listener);
		emitter.event(listener);
		emitter.fire(1);
		expect(listener).toHaveBeenCalledTimes(2);

		first[Symbol.dispose]();
		emitter.fire(2);
		expect(listener).toHaveBeenCalledTimes(3);
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

	it("should hand back a subscription that does nothing once the emitter is disposed", () => {
		const emitter = new Emitter<number>();
		const listener = jest.fn();
		emitter[Symbol.dispose]();

		const subscription = emitter.event(listener);
		emitter.fire(1);

		expect(listener).not.toHaveBeenCalled();
		expect(() => subscription[Symbol.dispose]()).not.toThrow();
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
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		const emitter = new Emitter<void>();

		const badListener = () => {
			throw new Error("Poison Pill");
		};
		const goodListener = jest.fn();

		try {
			emitter.event(badListener);
			emitter.event(goodListener);

			expect(() => emitter.fire()).not.toThrow();
			expect(goodListener).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Error in event listener",
					cause: expect.objectContaining({
						message: "Poison Pill",
					}),
				})
			);
			expect(consoleSpy).not.toHaveBeenCalled();
		} finally {
			setUnexpectedErrorHandler(restore);
			consoleSpy.mockRestore();
		}
	});

	it("should route a rejecting promise returned from a listener through the unexpected error handler", async () => {
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		const emitter = new Emitter<void>();
		const rejection = new Error("async failure");

		try {
			emitter.event(() => Promise.reject(rejection));
			emitter.fire();

			await Promise.resolve();
			await Promise.resolve();

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Unhandled promise rejection in event listener",
					cause: rejection,
				})
			);
		} finally {
			setUnexpectedErrorHandler(restore);
		}
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

describe("NullEvent", () => {
	it("should never tell a listener anything, and hand back something to dispose", () => {
		const listener = jest.fn();

		const subscription = NullEvent(listener);

		expect(listener).not.toHaveBeenCalled();
		expect(() => subscription[Symbol.dispose]()).not.toThrow();
	});
});
