import { safeStringify } from "./json.js";

export const ErrorUtils = {
	fromUnknown(error: unknown): Error {
		// Use the object string instead of instanceof to
		// bypass the instanceof memory-reference trap
		if (
			error instanceof Error ||
			(typeof error === "object" &&
				error !== null &&
				Object.prototype.toString.call(error) === "[object Error]")
		) {
			return error as Error;
		}
		if (typeof error === "string") {
			return new Error(error);
		}
		return new Error(
			`An unexpected error occurred: ${safeStringify(error)}`
		);
	},

	toString(error: Error): string {
		return error.stack ? error.stack : error.message;
	},
};

export type UnexpectedErrorHandler = (error: Error) => void;

/**
 * Throws on the next tick rather than swallowing the error, so a program
 * with nothing installed still fails loudly instead of silently. Mirrors
 * VS Code's default `onUnexpectedError` behavior.
 */
const defaultUnexpectedErrorHandler: UnexpectedErrorHandler = (error) => {
	setTimeout(() => {
		throw error;
	}, 0);
};

let unexpectedErrorHandler: UnexpectedErrorHandler =
	defaultUnexpectedErrorHandler;

/**
 * Replaces the handler that {@link onUnexpectedError} reports through.
 * Returns the previous handler so a caller (typically a test) can restore
 * it afterwards.
 */
export function setUnexpectedErrorHandler(
	newHandler: UnexpectedErrorHandler
): UnexpectedErrorHandler {
	const previousHandler = unexpectedErrorHandler;
	unexpectedErrorHandler = newHandler;
	return previousHandler;
}

/**
 * Reports an error that couldn't be handled where it occurred, such as a
 * listener throwing during `Emitter.fire`. Goes through the replaceable
 * handler above instead of writing to the console directly, so callers can
 * control where these errors end up.
 */
export function onUnexpectedError(error: unknown): void {
	unexpectedErrorHandler(ErrorUtils.fromUnknown(error));
}
