import { safeStringify } from "./json.js";

/** Node's `EACCES: permission denied, open '/x'` becomes `permission denied`. */
export function failureReason(error: Error): string {
	const code = /^[A-Z][A-Z0-9]+: /;
	if (!code.test(error.message)) return error.message;
	return error.message.replace(code, "").replace(/, [a-z]+( '.*')?$/, "");
}

export const ErrorUtils = {
	fromUnknown(error: unknown): Error {
		// Errors from another realm fail instanceof.
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

	hasCode(error: unknown, ...codes: string[]): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string" &&
			codes.includes(error.code)
		);
	},

	/** Whether `error` is a failed system call, which the environment causes and a bug does not. */
	isSystemError(error: unknown): error is Error & { readonly code: string } {
		return (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string" &&
			/^E[A-Z0-9]+$/.test(error.code)
		);
	},

	/** `Failed to write a.json: permission denied` for `what` and `cause`. */
	wrap(what: string, cause: Error): Error {
		return new Error(`${what}: ${failureReason(cause)}`, { cause });
	},
};

/** The user backed out; not a failure to report. */
export class CancelledError extends Error {
	override readonly name = "CancelledError";
}

/** The command line is wrong rather than the project. */
export class UsageError extends Error {
	override readonly name = "UsageError";
}

type UnexpectedErrorHandler = (error: Error) => void;

const defaultUnexpectedErrorHandler: UnexpectedErrorHandler = (error) => {
	setTimeout(() => {
		throw error;
	}, 0);
};

let unexpectedErrorHandler: UnexpectedErrorHandler =
	defaultUnexpectedErrorHandler;

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
		defaultUnexpectedErrorHandler(ErrorUtils.fromUnknown(handlerError));
	}
}
