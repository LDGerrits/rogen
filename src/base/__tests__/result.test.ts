import { ok, err, tryWith, tryWithAsync } from "../result.js";

describe("Result", () => {
	it("should handle successful values", () => {
		const result = ok("Success");

		expect(result.isOk()).toBe(true);
		expect(result.isErr()).toBe(false);
		expect(result.unwrap()).toBe("Success");
	});

	it("should handle error values", () => {
		const result = err(new Error("Failure"));

		expect(result.isOk()).toBe(false);
		expect(result.isErr()).toBe(true);
		expect(() => result.unwrap()).toThrow("Failure");
	});

	it("should chain transformations with map", () => {
		const result = ok(10).map((n) => n * 2);
		expect(result.unwrap()).toBe(20);
	});

	it("should chain flatMap operations", () => {
		const result = ok(10).flatMap((n) => ok(n + 5));
		expect(result.unwrap()).toBe(15);
	});

	it("should stop chaining when an error is encountered in flatMap", () => {
		const result = ok(10)
			.flatMap(() => err("Failed"))
			.flatMap(() => ok(100));

		expect(result.isErr()).toBe(true);
		expect(result.unwrapOr(50)).toBe(50);
	});

	it("should catch exceptions with tryWith", () => {
		const result = tryWith(() => {
			throw new Error("Boom");
		});

		expect(result.isErr()).toBe(true);
		expect(result.unwrapOr("default")).toBe("default");
	});

	it("should return the value of an async function with tryWithAsync", async () => {
		const result = await tryWithAsync(async () => "done");

		expect(result.unwrap()).toBe("done");
	});

	it("should turn a rejection into an error with tryWithAsync", async () => {
		const result = await tryWithAsync(() => Promise.reject("nope"));

		expect(result.isErr()).toBe(true);
		expect(result.isErr() && result.error.message).toBe("nope");
	});
});
