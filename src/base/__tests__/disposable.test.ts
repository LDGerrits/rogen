import { jest } from "@jest/globals";
import {
	DisposableStore,
	AbstractDisposable,
	Disposable,
} from "../disposable.js";

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

describe("AbstractDisposable", () => {
	class TestDisposable extends AbstractDisposable {
		registerChild<T extends Disposable>(child: T): T {
			return this._register(child);
		}
	}

	it("should dispose all registered children when the instance is disposed", () => {
		const instance = new TestDisposable();

		const child1 = { [Symbol.dispose]: jest.fn() };
		const child2 = { [Symbol.dispose]: jest.fn() };

		instance.registerChild(child1);
		instance.registerChild(child2);

		instance[Symbol.dispose]();

		expect(child1[Symbol.dispose]).toHaveBeenCalledTimes(1);
		expect(child2[Symbol.dispose]).toHaveBeenCalledTimes(1);
	});

	it("should throw an error if an instance attempts to register itself", () => {
		const instance = new TestDisposable();

		expect(() => {
			instance.registerChild(instance);
		}).toThrow("Cannot register a disposable on itself!");
	});

	it("should properly clean up children when used with modern 'using' scope blocks", () => {
		const child = { [Symbol.dispose]: jest.fn() };

		{
			using instance = new TestDisposable();
			instance.registerChild(child);
			expect(child[Symbol.dispose]).not.toHaveBeenCalled();
		}

		expect(child[Symbol.dispose]).toHaveBeenCalledTimes(1);
	});

	it("should return the registered object from _register", () => {
		const instance = new TestDisposable();
		const child = { [Symbol.dispose]: jest.fn(), customProp: "test" };

		const returned = instance.registerChild(child);

		expect(returned).toBe(child);
		expect(returned.customProp).toBe("test");
	});
});
