import { LogLevel } from "../../log/log-service.js";
import { NativeEnvironmentService } from "../native-environment-service.js";

const inTerminal = (env: Record<string, string | undefined>) =>
	new NativeEnvironmentService({}, "/mock/cwd", {
		env,
		isTerminal: true,
		userHome: "/mock/home",
		tmpDir: "/mock/tmp",
		pid: 4242,
		platform: "linux",
	});

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
			userHome: "/mock/home",
			tmpDir: "/mock/tmp",
			pid: 4242,
			platform: "linux",
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
				userHome: "/mock/home",
				tmpDir: "/mock/tmp",
				pid: 4242,
				platform: "linux",
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
			const env = new NativeEnvironmentService(
				{ json: true },
				"/mock/cwd",
				{
					env: {},
					isTerminal: true,
					userHome: "/mock/home",
					tmpDir: "/mock/tmp",
					pid: 4242,
					platform: "linux",
				}
			);

			expect(env.isPlain).toBe(true);
		});
	});

	describe("annotationsIn", () => {
		it.each([
			[
				{ GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/work/repo" },
				"/work/repo",
			],
			[{ GITHUB_ACTIONS: "true" }, "/mock/cwd"],
			[{ GITHUB_WORKSPACE: "/work/repo" }, undefined],
			[
				{ GITHUB_ACTIONS: "false", GITHUB_WORKSPACE: "/work/repo" },
				undefined,
			],
			[{}, undefined],
		])("should read it from %j", (env, workspace) => {
			expect(inTerminal(env).annotationsIn).toBe(workspace);
		});

		it("should leave it out when the run prints JSON", () => {
			const env = new NativeEnvironmentService(
				{ json: true },
				"/mock/cwd",
				{
					env: { GITHUB_ACTIONS: "true" },
					isTerminal: false,
					userHome: "/mock/home",
					tmpDir: "/mock/tmp",
					pid: 4242,
					platform: "linux",
				}
			);

			expect(env.annotationsIn).toBeUndefined();
		});
	});

	describe("cacheDir", () => {
		const cacheDirOn = (
			platform: NodeJS.Platform,
			env: Record<string, string | undefined> = {}
		) =>
			new NativeEnvironmentService({}, "/mock/cwd", {
				env,
				isTerminal: true,
				userHome: "/home/me",
				tmpDir: "/mock/tmp",
				pid: 4242,
				platform,
			}).cacheDir;

		it("should be XDG_CACHE_HOME when it is set", () => {
			expect(cacheDirOn("linux", { XDG_CACHE_HOME: "/xdg" })).toBe(
				"/xdg"
			);
		});

		it.each([
			["linux", "/home/me/.cache"],
			["darwin", "/home/me/Library/Caches"],
		] as const)("should be the usual place on %s", (platform, dir) => {
			expect(cacheDirOn(platform)).toBe(dir);
		});

		it("should be LOCALAPPDATA on Windows", () => {
			expect(cacheDirOn("win32", { LOCALAPPDATA: "/local" })).toBe(
				"/local"
			);
		});
	});

	describe("checksForUpdates", () => {
		it("should be true for a person in a terminal", () => {
			expect(inTerminal({}).checksForUpdates).toBe(true);
		});

		it.each([
			["CI", "true"],
			["CLAUDECODE", "1"],
			["ROGEN_NO_UPDATE_CHECK", "1"],
			["ROGEN_NO_UPDATE_CHECK", "true"],
			["NO_UPDATE_NOTIFIER", "1"],
		])("should be false with %s=%s", (name, value) => {
			expect(inTerminal({ [name]: value }).checksForUpdates).toBe(false);
		});

		it("should stay on when the opt-out is 0 or false", () => {
			expect(
				inTerminal({ ROGEN_NO_UPDATE_CHECK: "0" }).checksForUpdates
			).toBe(true);
			expect(
				inTerminal({ ROGEN_NO_UPDATE_CHECK: "false" }).checksForUpdates
			).toBe(true);
		});

		it("should be false without a terminal", () => {
			const piped = new NativeEnvironmentService({}, "/mock/cwd", {
				env: {},
				isTerminal: false,
				userHome: "/mock/home",
				tmpDir: "/mock/tmp",
				pid: 4242,
				platform: "linux",
			});

			expect(piped.checksForUpdates).toBe(false);
		});

		it("should be false under --quiet in a terminal", () => {
			const quiet = new NativeEnvironmentService(
				{ quiet: true },
				"/mock/cwd",
				{
					env: {},
					isTerminal: true,
					userHome: "/mock/home",
					tmpDir: "/mock/tmp",
					pid: 4242,
					platform: "linux",
				}
			);

			expect(quiet.checksForUpdates).toBe(false);
		});

		it("should be false under --json in a terminal", () => {
			const json = new NativeEnvironmentService(
				{ json: true },
				"/mock/cwd",
				{
					env: {},
					isTerminal: true,
					userHome: "/mock/home",
					tmpDir: "/mock/tmp",
					pid: 4242,
					platform: "linux",
				}
			);

			expect(json.checksForUpdates).toBe(false);
		});
	});

	it("should carry the id of the process it describes", () => {
		const environment = new NativeEnvironmentService({}, "/repo", {
			env: {},
			isTerminal: true,
			userHome: "/home/me",
			tmpDir: "/mock/tmp",
			pid: 4242,
			platform: "linux",
		});

		expect(environment.pid).toBe(4242);
	});
});
