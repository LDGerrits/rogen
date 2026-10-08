import { switchVariants, variantStates } from "../variant-switch.js";

describe("domain/config/variant-switch", () => {
	const DECLARED = ["mock", "debug", "halloween"];

	it("should leave every declared variant off when nothing turns one on", () => {
		const switches = switchVariants(DECLARED, [], {});

		expect(variantStates(switches)).toEqual({
			mock: false,
			debug: false,
			halloween: false,
		});
	});

	it("should turn on the variants the mode lists, naming the mode as the cause", () => {
		const switches = switchVariants(DECLARED, ["mock", "debug"], {});

		expect(variantStates(switches)).toEqual({
			mock: true,
			debug: true,
			halloween: false,
		});
		expect(switches.get("mock")).toEqual({ on: true, by: "mode" });
	});

	it("should let the command line turn a variant on beyond the mode's", () => {
		const switches = switchVariants(DECLARED, ["mock"], {
			halloween: true,
		});

		expect(switches.get("halloween")).toEqual({ on: true, by: "cli" });
		expect(switches.get("mock")).toEqual({ on: true, by: "mode" });
	});

	it("should let the command line turn off a variant the mode lists", () => {
		const switches = switchVariants(DECLARED, ["mock", "debug"], {
			mock: false,
		});

		expect(variantStates(switches)).toEqual({
			mock: false,
			debug: true,
			halloween: false,
		});
		expect(switches.get("mock")).toEqual({ on: false });
	});

	it("should name the command line as the cause when it repeats what the mode lists", () => {
		const switches = switchVariants(DECLARED, ["mock"], { mock: true });

		expect(switches.get("mock")).toEqual({ on: true, by: "mode" });
	});

	it("should ignore a command line variant that is not declared", () => {
		const switches = switchVariants(DECLARED, [], { ghost: true });

		expect(Object.keys(variantStates(switches))).toEqual(DECLARED);
	});

	it("should keep the order the variants were declared in", () => {
		expect(
			Object.keys(variantStates(switchVariants(["b", "a"], ["a"], {})))
		).toEqual(["b", "a"]);
	});
});
