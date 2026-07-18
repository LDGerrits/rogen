export const ErrorUtils = {
	fromUnknown(error: unknown): Error {
		if (error instanceof Error) {
			return error;
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
