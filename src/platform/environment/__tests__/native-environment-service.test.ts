import { LogLevel } from "../../log/log-service.js";
import { NativeEnvironmentService } from "../native-environment-service.js";

const inTerminal = (env: Record<string, string | undefined>) =>
	new NativeEnvironmentService({}, "/mock/cwd", { env, isTerminal: true });

describe("NativeEnvironmentService", () => {
	it("should expose the working directory", () => {
		expect(inTerminal({}).cwd).toBe("/mock/cwd");
	});

	it.each([
		[{}, LogLevel.Info],
		[{ verbose: true }, LogLevel.Debug],
		[{ quiet: true }, LogLevel.Error],
		[{ verbose: true, quiet: true }, LogLevel.Error],
	])("should read the log level from %j", (flags, level) => {
		const env = new NativeEnvironmentService(flags, "/mock/cwd", {
			env: {},
			isTerminal: true,
		});

		expect(env.logLevel).toBe(level);
	});

	describe("isInteractive", () => {
		it("should be true in a terminal with none of the variables", () => {
			expect(inTerminal({}).isInteractive).toBe(true);
		});

		it("should be false without a terminal", () => {
			const piped = new NativeEnvironmentService({}, "/mock/cwd", {
				env: {},
				isTerminal: false,
			});

			expect(piped.isInteractive).toBe(false);
		});

		it.each([
			["CI", "true"],
			["CI", "1"],
			["AGENT", "amp"],
			["AI_AGENT", "x"],
			["CLAUDECODE", "1"],
			["CODEX_SANDBOX", "seatbelt"],
			["CODEX_THREAD_ID", "abc"],
			["CURSOR_AGENT", "1"],
			["GEMINI_CLI", "1"],
			["COPILOT_AGENT", "1"],
			["OPENCODE", "1"],
			["CLINE_ACTIVE", "true"],
		])("should be false when %s is %s", (name, value) => {
			expect(inTerminal({ [name]: value }).isInteractive).toBe(false);
		});

		it.each([undefined, "", "0", "false", "FALSE"])(
			"should be true when CI is %p",
			(value) => {
				expect(inTerminal({ CI: value }).isInteractive).toBe(true);
			}
		);

		it.each([
			"CURSOR_TRACE_ID",
			"REPL_ID",
			"COPILOT_GITHUB_TOKEN",
			"TERM_PROGRAM",
		])("should be true when only %s is set", (name) => {
			expect(inTerminal({ [name]: "1" }).isInteractive).toBe(true);
		});

		it("should be false when the terminal is dumb", () => {
			expect(inTerminal({ TERM: "dumb" }).isInteractive).toBe(false);
		});
	});

	describe("isPlain", () => {
		it("should draw in an interactive terminal", () => {
			expect(inTerminal({}).isPlain).toBe(false);
		});

		it("should print plain lines when NO_COLOR is set", () => {
			const env = inTerminal({ NO_COLOR: "1" });

			expect(env.isPlain).toBe(true);
			expect(env.isInteractive).toBe(true);
		});

		it("should print plain lines when an agent runs it", () => {
			expect(inTerminal({ CLAUDECODE: "1" }).isPlain).toBe(true);
		});

		it("should print plain lines under --json in a terminal", () => {
			const env = new NativeEnvironmentService({ json: true }, "/mock/cwd", {
				env: {},
				isTerminal: true,
			});

			expect(env.isPlain).toBe(true);
		});
	});
});
