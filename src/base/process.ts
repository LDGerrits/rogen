export type NodeEnv = "development" | "production" | "test";

export function getCwd(): string {
	return process.cwd();
}

export function getArgs(): string[] {
	return process.argv.slice(2);
}

export function getNodeEnv(): NodeEnv {
	const env = process.env.NODE_ENV;
	if (env === "test") return "test";
	if (env === "development") return "development";
	return "production";
}

export function exit(code: number): void {
	process.exit(code);
}
