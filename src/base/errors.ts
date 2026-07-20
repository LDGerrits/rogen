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
			`An unexpected error occurred: ${JSON.stringify(error)}`
		);
	},

	toString(error: Error): string {
		return error.stack ? error.stack : error.message;
	},
};
