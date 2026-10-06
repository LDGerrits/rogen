import { NativeEnvironmentService } from "../native-environment-service.js";

describe("NativeEnvironmentService", () => {
	it("should expose the working directory and the logging flags", () => {
		const env = new NativeEnvironmentService(
			{ verbose: true, quiet: false },
			"/mock/cwd"
		);

		expect(env.cwd).toBe("/mock/cwd");
		expect(env.verbose).toBe(true);
		expect(env.quiet).toBe(false);
	});
});
