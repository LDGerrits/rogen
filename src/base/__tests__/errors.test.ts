import { jest } from "@jest/globals";
import { onUnexpectedError, setUnexpectedErrorHandler } from "../errors.js";

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
