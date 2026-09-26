import { jest } from "@jest/globals";
import { PlainLogService } from "../plain-log-service.js";

describe("AbstractLogService formatting", () => {
	it("should include an error's cause chain, not just its own message", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const rootCause = new Error("Poison Pill");
		const wrapper = new Error("Error in event listener", {
			cause: rootCause,
		});

		logService.error(wrapper);

		expect(consoleSpy).toHaveBeenCalledTimes(1);
		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];

		expect(loggedMessage).toContain("Error in event listener");
		expect(loggedMessage).toContain("Poison Pill");

		consoleSpy.mockRestore();
	});

	it("should walk multiple levels of nested causes", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const rootCause = new Error("root failure");
		const middle = new Error("middle wrapper", { cause: rootCause });
		const outer = new Error("outer wrapper", { cause: middle });

		logService.error(outer);

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];

		expect(loggedMessage).toContain("outer wrapper");
		expect(loggedMessage).toContain("middle wrapper");
		expect(loggedMessage).toContain("root failure");

		consoleSpy.mockRestore();
	});

	it("should format a non-Error cause via ErrorUtils.fromUnknown", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const wrapper = new Error("wrapper", { cause: "raw string cause" });

		logService.error(wrapper);

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).toContain("raw string cause");

		consoleSpy.mockRestore();
	});

	it("should stop at a circular cause instead of hanging", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		a.cause = b;

		expect(() => logService.error(a)).not.toThrow();

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).toContain("[circular]");

		consoleSpy.mockRestore();
	});

	it("should not append anything for an error with no cause", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		logService.error(new Error("standalone"));

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).not.toContain("Caused by");

		consoleSpy.mockRestore();
	});
});
