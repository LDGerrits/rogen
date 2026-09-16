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

// Throws on the next tick so a silent failure doesn't stay silent.
const defaultUnexpectedErrorHandler: UnexpectedErrorHandler = (error) => {
	setTimeout(() => {
		throw error;
	}, 0);
};

let unexpectedErrorHandler: UnexpectedErrorHandler =
	defaultUnexpectedErrorHandler;

/** Returns the previous handler so a caller can restore it. */
export function setUnexpectedErrorHandler(
	newHandler: UnexpectedErrorHandler
): UnexpectedErrorHandler {
	const previousHandler = unexpectedErrorHandler;
	unexpectedErrorHandler = newHandler;
	return previousHandler;
}

export function onUnexpectedError(error: unknown): void {
	try {
		unexpectedErrorHandler(ErrorUtils.fromUnknown(error));
	} catch (handlerError) {
		// Don't let a bad handler break the caller (usually Emitter.fire).
		defaultUnexpectedErrorHandler(ErrorUtils.fromUnknown(handlerError));
	}
}
