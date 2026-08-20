import { NativeEnvironmentService } from "../environment-service.js";
import { ParsedArgs } from "../args.js";

describe("NativeEnvironmentService", () => {
	it("should expose parsed arguments and evaluate logging getters", () => {
		const args: ParsedArgs = {
			verbose: true,
			quiet: false,
			_: [],
		};
		const env = new NativeEnvironmentService(args, "/mock/cwd");

		expect(env.cwd).toBe("/mock/cwd");
		expect(env.args).toBe(args);
		expect(env.verbose).toBe(true);
		expect(env.quiet).toBe(false);
		expect(env.trace).toBe(false);
	});
});
