import { jest } from "@jest/globals";
import { onUnexpectedError, setUnexpectedErrorHandler } from "../errors.js";

describe("onUnexpectedError / setUnexpectedErrorHandler", () => {
	it("should report through an installed handler instead of the console", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		onUnexpectedError(new Error("boom"));

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ message: "boom" })
		);
		expect(consoleSpy).not.toHaveBeenCalled();

		setUnexpectedErrorHandler(restore);
		consoleSpy.mockRestore();
	});

	it("should normalize a non-Error value with ErrorUtils before handing it to the handler", () => {
		const handler = jest.fn();
		const restore = setUnexpectedErrorHandler(handler);

		onUnexpectedError("something went wrong");

		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ message: "something went wrong" })
		);

		setUnexpectedErrorHandler(restore);
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
		const previous = setUnexpectedErrorHandler(second);

		expect(previous).toBe(first);

		setUnexpectedErrorHandler(original);
	});
});
