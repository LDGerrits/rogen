import { safeStringify } from "./json.js";

/** Why a system call failed, in words for the user: Node's `EACCES: permission denied, open '/x'` becomes `permission denied`. */
export function failureReason(error: Error): string {
	const code = /^[A-Z][A-Z0-9]+: /;
	if (!code.test(error.message)) return error.message;
	return error.message.replace(code, "").replace(/, [a-z]+( '.*')?$/, "");
}

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

	/** Whether `error` carries one of the Node error codes `codes`, such as `ENOENT`. */
	hasCode(error: unknown, ...codes: string[]): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string" &&
			codes.includes(error.code)
		);
	},

	/** Whether `error` is a failed system call: its code is an errno such as `EACCES`, which the environment causes and a bug does not. */
	isSystemError(error: unknown): error is Error & { readonly code: string } {
		return (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string" &&
			/^E[A-Z0-9]+$/.test(error.code)
		);
	},

	/** `cause` as an error that says what failed and why: `Failed to write a.json: permission denied`. */
	wrap(what: string, cause: Error): Error {
		return new Error(`${what}: ${failureReason(cause)}`, { cause });
	},
};

/** The user backed out: not a failure to report, only a message to end on. */
export class CancelledError extends Error {
	override readonly name = "CancelledError";
}

/** The command line is wrong rather than the project: an unknown command, option or name, or a combination that isn't allowed. */
export class UsageError extends Error {
	override readonly name = "UsageError";
}

/** A failure already reported in full; only the exit code is left to set. */
export class ReportedError extends Error {
	override readonly name = "ReportedError";

	constructor(cause: Error) {
		super(cause.message, { cause });
	}
}

/** A failure that ends the run with a given exit code, such as the code a child process stopped with. */
export class ExitCodeError extends Error {
	override readonly name = "ExitCodeError";

	constructor(
		readonly exitCode: number,
		cause: Error
	) {
		super(cause.message, { cause });
	}
}

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
