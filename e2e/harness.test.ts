import {
	RunningProcess,
	eventually,
	formatStep,
	showsStdout,
} from "./harness.js";

describe("e2e harness", () => {
	describe("showsStdout", () => {
		it("should leave out the output of build and init, which frame every case alike", () => {
			expect(showsStdout(["build"], {})).toBe(false);
			expect(showsStdout(["init", "lobby"], {})).toBe(false);
		});

		it("should show the output of a command that is what a case is about", () => {
			expect(showsStdout(["where", "src"], {})).toBe(true);
			expect(showsStdout(["sourcemap"], {})).toBe(true);
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
					["rogen", "check"],
					{ ...result, stderr: "oops\n" },
					true
				)
			).toBe("$ rogen check\nexit 0\nstdout:\n  hello\nstderr:\n  oops");
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

	describe("RunningProcess", () => {
		it("should hold the output written right before the process ended", async () => {
			const running = new RunningProcess("sh", [
				"-c",
				"(sleep 0.3; echo end) & exit 3",
			]);

			expect(await running.exited).toBe(3);
			expect(running.output).toBe("end\n");
		});

		it("should end as a failed start with its reason when the program is missing", async () => {
			const running = new RunningProcess("rogen-e2e-missing-program", []);

			expect(await running.exited).toBeNull();
			expect(running.startError?.message).toContain("ENOENT");
			expect(await running.stop()).toBeNull();
		});

		it("should stop waiting at once, with its exit code and output, when the process has ended", async () => {
			const running = new RunningProcess("sh", [
				"-c",
				"echo broken; exit 2",
			]);
			const started = Date.now();

			await expect(
				running.waitFor(() => {
					expect(running.output).toContain("ready");
				}, 20_000)
			).rejects.toThrow("ended with 2 before it was ready:\nbroken");
			expect(Date.now() - started).toBeLessThan(5_000);
		});

		it("should give what the check returned once it passes", async () => {
			const running = new RunningProcess("sh", [
				"-c",
				"echo ready; sleep 60",
			]);

			const line = await running.waitFor(() => {
				const found = running.output.split("\n").find(Boolean);
				if (!found) throw new Error("no line yet");
				return found;
			});

			expect(line).toBe("ready");
			await running.stop();
		});

		it("should end the programs it started when it stops", async () => {
			const running = new RunningProcess("sh", [
				"-c",
				"sleep 60 & echo $!; wait",
			]);
			const grandchild = Number(
				await running.waitFor(() => {
					expect(running.output).toMatch(/^\d+\n/);
					return running.output.trim();
				})
			);

			await running.stop();

			await eventually(() =>
				expect(() => process.kill(grandchild, 0)).toThrow()
			);
		});
	});
});
