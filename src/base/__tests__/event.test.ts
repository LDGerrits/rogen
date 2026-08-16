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
});
