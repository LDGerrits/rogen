import { createDecorator } from "../instantiation.js";
import { ServiceCollection } from "../service-collection.js";
import { SyncDescriptor } from "../sync-descriptor.js";

interface FooService {
	readonly name: string;
}

const FooService = createDecorator<FooService>("fooService");
const BarService = createDecorator<FooService>("barService");

describe("ServiceCollection", () => {
	describe("get", () => {
		it("should return the instance registered for an identifier", () => {
			const services = new ServiceCollection();
			const foo = { name: "foo" };
			services.set(FooService, foo);

			expect(services.get(FooService)).toBe(foo);
		});

		it("should return the descriptor registered for an identifier", () => {
			const services = new ServiceCollection();
			const descriptor = new SyncDescriptor(
				class implements FooService {
					readonly name = "foo";
				}
			);
			services.set(FooService, descriptor);

			expect(services.get(FooService)).toBe(descriptor);
		});

		it("should throw for an identifier with nothing registered", () => {
			const services = new ServiceCollection();

			expect(() => services.get(FooService)).toThrow(/fooService/);
		});

		it("should keep identifiers with the same shape apart", () => {
			const services = new ServiceCollection();
			services.set(FooService, { name: "foo" });

			expect(() => services.get(BarService)).toThrow(/barService/);
		});
	});

	describe("has", () => {
		it("should tell a registered identifier from one that is not", () => {
			const services = new ServiceCollection();
			services.set(FooService, { name: "foo" });

			expect(services.has(FooService)).toBe(true);
			expect(services.has(BarService)).toBe(false);
		});
	});

	describe("set", () => {
		it("should replace an earlier instance", () => {
			const services = new ServiceCollection();
			const second = { name: "second" };
			services.set(FooService, { name: "first" });
			services.set(FooService, second);

			expect(services.get(FooService)).toBe(second);
		});
	});
});
