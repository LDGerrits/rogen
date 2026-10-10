import { jest } from "@jest/globals";
import {
	ErrorUtils,
	failureReason,
	onUnexpectedError,
	setUnexpectedErrorHandler,
} from "../errors.js";

describe("ErrorUtils.isSystemError", () => {
	it("should accept an error carrying an errno code", () => {
		expect(
			ErrorUtils.isSystemError(
				Object.assign(new Error("denied"), { code: "EACCES" })
			)
		).toBe(true);
	});

	it.each([
		new Error("plain"),
		Object.assign(new Error("odd"), { code: "ERR_INVALID_ARG_TYPE_X" }),
		Object.assign(new Error("odd"), { code: "ERR_X" }),
		Object.assign(new Error("odd"), { code: 13 }),
		{ code: "EACCES" },
	])("should not accept %s", (error) => {
		expect(ErrorUtils.isSystemError(error)).toBe(false);
	});
});

describe("ErrorUtils.hasCode", () => {
	it("should match an error whose code is one of those given", () => {
		const error = Object.assign(new Error("gone"), { code: "ENOENT" });

		expect(ErrorUtils.hasCode(error, "ENOENT", "ELOOP")).toBe(true);
		expect(ErrorUtils.hasCode(error, "EACCES")).toBe(false);
	});

	it("should not match a value without a string code", () => {
		expect(ErrorUtils.hasCode(new Error("plain"), "ENOENT")).toBe(false);
		expect(ErrorUtils.hasCode({ code: 2 }, "2")).toBe(false);
		expect(ErrorUtils.hasCode("ENOENT", "ENOENT")).toBe(false);
		expect(ErrorUtils.hasCode(undefined, "ENOENT")).toBe(false);
	});
});

describe("onUnexpectedError / setUnexpectedErrorHandler", () => {
	it("should report through an installed handler instead of the console", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		try {
			onUnexpectedError(new Error("boom"));

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ message: "boom" })
			);
			expect(consoleSpy).not.toHaveBeenCalled();
		} finally {
			setUnexpectedErrorHandler(restore);
			consoleSpy.mockRestore();
		}
	});

	it("should normalize a non-Error value with ErrorUtils before handing it to the handler", () => {
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		try {
			onUnexpectedError("something went wrong");

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ message: "something went wrong" })
			);
		} finally {
			setUnexpectedErrorHandler(restore);
		}
	});

	it("should still surface the error by throwing asynchronously by default, with nothing installed", () => {
		jest.useFakeTimers();

		try {
			const error = new Error("unhandled");
			onUnexpectedError(error);

			expect(() => jest.runAllTimers()).toThrow(error);
		} finally {
			jest.useRealTimers();
		}
	});

	it("should return the previous handler so callers can restore it", () => {
		const first = jest.fn();
		const second = jest.fn();

		const original = setUnexpectedErrorHandler(first);

		try {
			const previous = setUnexpectedErrorHandler(second);
			expect(previous).toBe(first);
		} finally {
			setUnexpectedErrorHandler(original);
		}
	});

	it("should surface a throwing handler asynchronously instead of propagating out of onUnexpectedError", () => {
		jest.useFakeTimers();
		const handlerError = new Error("handler blew up");
		const restore = setUnexpectedErrorHandler(() => {
			throw handlerError;
		});

		try {
			expect(() =>
				onUnexpectedError(new Error("original failure"))
			).not.toThrow();

			expect(() => jest.runAllTimers()).toThrow(handlerError);
		} finally {
			setUnexpectedErrorHandler(restore);
			jest.useRealTimers();
		}
	});
});

describe("failureReason", () => {
	it.each([
		[
			"ENOENT: no such file or directory, open '/x'",
			"no such file or directory",
		],
		["EACCES: permission denied, open '/x'", "permission denied"],
		[
			"EISDIR: illegal operation on a directory, read",
			"illegal operation on a directory",
		],
		[
			"EISDIR: illegal operation on a directory, read '/x'",
			"illegal operation on a directory",
		],
		["disk full", "disk full"],
		["not found, retry", "not found, retry"],
	])("should give the reason of %j without its code", (message, reason) => {
		expect(failureReason(new Error(message))).toBe(reason);
	});
});

describe("ErrorUtils.wrap", () => {
	it("should say what failed and why, without the code, and keep the cause", () => {
		const cause = new Error("EACCES: permission denied, open '/x'");

		const wrapped = ErrorUtils.wrap("Failed to write a.json", cause);

		expect(wrapped.message).toBe(
			"Failed to write a.json: permission denied"
		);
		expect(wrapped.cause).toBe(cause);
	});
});
