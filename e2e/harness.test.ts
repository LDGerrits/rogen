import { formatStep, showsStdout } from "./harness.js";

describe("e2e harness", () => {
	describe("showsStdout", () => {
		it("should leave out the output of build and init, which frame every case alike", () => {
			expect(showsStdout(["build"], {})).toBe(false);
			expect(showsStdout(["init", "lobby"], {})).toBe(false);
		});

		it("should show the output of a command that is what a case is about", () => {
			expect(showsStdout(["where", "src"], {})).toBe(true);
			expect(showsStdout(["list"], {})).toBe(true);
			expect(showsStdout(["check"], {})).toBe(true);
		});

		it("should show the output of a framed command that the case lists", () => {
			expect(showsStdout(["build"], { output: ["build"] })).toBe(true);
			expect(showsStdout(["init"], { output: ["build"] })).toBe(false);
		});

		it("should show a document or help, which no other test frames", () => {
			expect(showsStdout(["build", "--json"], {})).toBe(true);
			expect(showsStdout(["init", "--json"], {})).toBe(true);
			expect(showsStdout(["build", "--help"], {})).toBe(true);
			expect(showsStdout(["init", "-h"], {})).toBe(true);
		});
	});

	describe("formatStep", () => {
		const result = { exitCode: 0, stdout: "hello\n", stderr: "" };

		it("should print the exit code and both streams", () => {
			expect(
				formatStep(
					["rogen", "list"],
					{ ...result, stderr: "oops\n" },
					true
				)
			).toBe("$ rogen list\nexit 0\nstdout:\n  hello\nstderr:\n  oops");
		});

		it("should say that output was left out, and still print the errors", () => {
			expect(
				formatStep(
					["rogen", "build"],
					{ ...result, exitCode: 1, stderr: "bad\n" },
					false
				)
			).toBe(
				"$ rogen build\nexit 1\nstdout: (not shown)\nstderr:\n  bad"
			);
		});

		it("should not mention output that a quiet command did not print", () => {
			expect(
				formatStep(["rogen", "build"], { ...result, stdout: "" }, false)
			).toBe("$ rogen build\nexit 0");
		});
	});
});
