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
	wrap(what: string, cause: Error): IoError {
		return new IoError(`${what}: ${failureReason(cause)}`, undefined, {
			cause,
		});
	},
};

/** What each exit code of a run means. */
export const ExitCodes = {
	0: "done (warnings included)",
	1: "the project has errors",
	2: "the command line is wrong",
} as const;

/** What went wrong in a word a program can branch on, each with the exit code its run ends with. */
export const ErrorKinds = {
	usage: { exitCode: 2, meaning: "the command line is wrong" },
	project: {
		exitCode: 1,
		meaning: "the project is not in a state the command can run on",
	},
	tool: {
		exitCode: 1,
		meaning: "a program Rogen needs is missing or failed",
	},
	io: {
		exitCode: 1,
		meaning: "a file or directory could not be read or written",
	},
	cancelled: { exitCode: 1, meaning: "the run was cancelled" },
	internal: { exitCode: 1, meaning: "a bug in Rogen" },
} as const;

export type ErrorKind = keyof typeof ErrorKinds;

/** A failure that knows its kind, and the one next step to name when there is one; `message` reads as `reason` then `hint`. */
export abstract class KindedError extends Error {
	abstract readonly kind: ErrorKind;

	constructor(
		readonly reason: string,
		readonly hint?: string,
		options?: ErrorOptions
	) {
		super(hint ? `${reason} ${hint}` : reason, options);
	}
}

/** The user backed out; not a failure to report. */
export class CancelledError extends KindedError {
	override readonly name = "CancelledError";
	readonly kind = "cancelled";
}

/** The command line is wrong rather than the project. */
export class UsageError extends KindedError {
	override readonly name = "UsageError";
	readonly kind = "usage";
}

/** The project can't be run on as it is, such as no config where one is needed. */
export class ProjectError extends KindedError {
	override readonly name = "ProjectError";
	readonly kind = "project";
}

/** A program Rogen needs is missing or failed without a diagnostic to say so. */
export class ToolError extends KindedError {
	override readonly name = "ToolError";
	readonly kind = "tool";
}

/** A file or directory could not be read or written. */
export class IoError extends KindedError {
	override readonly name = "IoError";
	readonly kind = "io";
}

/** The kind of `error`: the one it carries, `io` for a failed system call, else `internal`. */
export function errorKind(error: Error): ErrorKind {
	if (error instanceof KindedError) return error.kind;
	return ErrorUtils.isSystemError(error) ? "io" : "internal";
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
