import { jest } from "@jest/globals";
import { DisposableStore } from "../disposable.js";

describe("DisposableStore", () => {
	it("should dispose all added disposables when the store is disposed", () => {
		const store = new DisposableStore();

		const disposable1 = { [Symbol.dispose]: jest.fn() };
		const disposable2 = { [Symbol.dispose]: jest.fn() };

		store.add(disposable1);
		store.add(disposable2);

		store[Symbol.dispose]();

		expect(disposable1[Symbol.dispose]).toHaveBeenCalledTimes(1);
		expect(disposable2[Symbol.dispose]).toHaveBeenCalledTimes(1);
	});

	it("should immediately dispose any new items added after the store has already been disposed", () => {
		const store = new DisposableStore();
		store[Symbol.dispose]();

		const lateDisposable = { [Symbol.dispose]: jest.fn() };

		store.add(lateDisposable);

		expect(lateDisposable[Symbol.dispose]).toHaveBeenCalledTimes(1);
	});

	it("should safely handle being disposed multiple times", () => {
		const store = new DisposableStore();
		const disposable = { [Symbol.dispose]: jest.fn() };

		store.add(disposable);

		store[Symbol.dispose]();
		store[Symbol.dispose]();
		store[Symbol.dispose]();

		expect(disposable[Symbol.dispose]).toHaveBeenCalledTimes(1);
	});
});
