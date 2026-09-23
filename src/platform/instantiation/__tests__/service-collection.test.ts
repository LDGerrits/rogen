import { createServiceIdentifier } from "../instantiation.js";
import { ServiceCollection } from "../service-collection.js";

interface FooService {
	readonly name: string;
}

const FooService = createServiceIdentifier<FooService>("fooService");
const BarService = createServiceIdentifier<FooService>("barService");

describe("ServiceCollection", () => {
	describe("get", () => {
		it("should return the instance registered for an identifier", () => {
			const services = new ServiceCollection();
			const foo = { name: "foo" };
			services.set(FooService, foo);

			expect(services.get(FooService)).toBe(foo);
		});

		it("should throw for an identifier with no instance", () => {
			const services = new ServiceCollection();

			expect(() => services.get(FooService)).toThrow(/fooService/);
		});

		it("should keep identifiers with the same shape apart", () => {
			const services = new ServiceCollection();
			services.set(FooService, { name: "foo" });

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
