import { exitCodeText, wasInterrupted } from "../process-service.js";

describe("wasInterrupted", () => {
	it.each([
		[{ code: 130, signal: null }],
		[{ code: 143, signal: null }],
		[{ code: 0xc000013a, signal: null }],
		[{ code: null, signal: "SIGINT" }],
		[{ code: null, signal: "SIGTERM" }],
	])("should take %j for an interruption", (exit) => {
		expect(wasInterrupted(exit)).toBe(true);
	});

	it.each([
		[{ code: 0, signal: null }],
		[{ code: 1, signal: null }],
		[{ code: null, signal: "SIGKILL" }],
	])("should not take %j for one", (exit) => {
		expect(wasInterrupted(exit)).toBe(false);
	});
});

describe("exitCodeText", () => {
	it("should write a small code as a number", () => {
		expect(exitCodeText(2)).toBe("2");
	});

	it("should write a Windows status code in hex", () => {
		expect(exitCodeText(0xc0000005)).toBe("0xC0000005");
	});
});
