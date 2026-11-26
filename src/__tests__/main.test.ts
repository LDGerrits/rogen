import { jest } from "@jest/globals";
import { stripVTControlCharacters } from "util";
import { DisposableStore } from "../base/disposable.js";
import { err, ok } from "../base/result.js";
import path from "path";
import { ProjectError, onUnexpectedError } from "../base/errors.js";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../platform/log/log-service.js";
import {
	Command,
	CommandRegistry,
	Extensions,
} from "../platform/commands/commands.js";
import { JsonOption } from "../platform/environment/args.js";
import { Registry } from "../platform/registry/registry.js";
import { MockLogService } from "../platform/log/__tests__/mock-log-service.js";
import run, { UpdateNotice, isLongRunning } from "../main.js";

const testCommand = (
	id: string,
	handler: Command["handler"],
	metadata: Partial<Command["metadata"]> = {}
): Command => ({
	id,
	metadata: {
		summary: "Tests main.",
		description: "Tests main.",
		...metadata,
	},
	handler,
});

describe("run", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;
	let out: string[];
	let errors: string[];

	beforeEach(() => {
		store = new DisposableStore();
		out = [];
		errors = [];
		jest.spyOn(console, "info").mockImplementation((line) => {
			out.push(stripVTControlCharacters(String(line)));
		});
		jest.spyOn(console, "warn").mockImplementation((line) => {
			errors.push(stripVTControlCharacters(String(line)));
		});
		jest.spyOn(console, "error").mockImplementation((...parts) => {
			errors.push(stripVTControlCharacters(parts.map(String).join(" ")));
		});
	});

	afterEach(() => {
		store[Symbol.dispose]();
		jest.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("should print the version and exit 0", async () => {
		await run(["--version"]);

		expect(out.join("\n")).toMatch(/\d+\.\d+\.\d+/);
		expect(errors).toEqual([]);
		expect(process.exitCode).toBe(0);
	});

	it("should read its arguments from the command line when given none", async () => {
		jest.replaceProperty(process, "argv", [
			process.execPath,
			"rogen",
			"--version",
		]);

		await run();

		expect(out.join("\n")).toMatch(/\d+\.\d+\.\d+/);
		expect(process.exitCode).toBe(0);
	});

	it("should print the version the bundle was built with", async () => {
		Object.assign(globalThis, { ROGEN_VERSION: "9.8.7" });
		try {
			await run(["--version"]);
		} finally {
			Reflect.deleteProperty(globalThis, "ROGEN_VERSION");
		}

		expect(out.join("\n")).toContain("9.8.7");
	});

	it("should name an unknown option and exit 2", async () => {
		await run(["--nope"]);

		expect(errors.join("\n")).toContain("--nope");
		expect(process.exitCode).toBe(2);
	});

	it("should print an unknown option as a JSON error under --json", async () => {
		await run(["--nope", "--json"]);

		expect(JSON.parse(out.join("\n"))).toMatchObject({
			error: { kind: "usage" },
		});
		expect(errors).toEqual([]);
		expect(process.exitCode).toBe(2);
	});

	it("should refuse to run a command when the current folder is gone", async () => {
		jest.spyOn(process, "cwd").mockImplementation(() => {
			throw new Error("ENOENT: no such file or directory, uv_cwd");
		});

		await run(["build"]);

		expect(errors.join("\n")).toContain(
			"The current folder no longer exists."
		);
		expect(process.exitCode).toBe(1);
	});

	it("should still print the help when the current folder is gone", async () => {
		jest.spyOn(process, "cwd").mockImplementation(() => {
			throw new Error("ENOENT: no such file or directory, uv_cwd");
		});

		await run(["help"]);

		expect(out.join("\n")).toContain("rogen");
		expect(process.exitCode).toBe(0);
	});

	it("should report the error a command returns and exit with its code", async () => {
		store.add(
			registry.registerCommand(
				testCommand("main-test-fails", async () =>
					err(new ProjectError("The project is broken."))
				)
			)
		);

		await run(["main-test-fails"]);

		expect(errors.join("\n")).toContain("The project is broken.");
		expect(process.exitCode).toBe(1);
	});

	it("should report a command that crashes as a fatal error", async () => {
		store.add(
			registry.registerCommand(
				testCommand("main-test-crashes", async () => {
					throw new Error("kaboom");
				})
			)
		);

		await run(["main-test-crashes"]);

		expect(errors.join("\n")).toContain("Fatal Error: Error: kaboom");
		expect(process.exitCode).toBe(1);
	});

	it("should print only the JSON document for a crash under --json", async () => {
		store.add(
			registry.registerCommand(
				testCommand(
					"main-test-json-crash",
					async () => {
						throw new Error("kaboom");
					},
					{ options: [JsonOption] }
				)
			)
		);

		await run(["main-test-json-crash", "--json"]);

		expect(errors).toEqual([]);
		expect(JSON.parse(out.join("\n"))).toMatchObject({
			error: { kind: "internal" },
		});
		expect(process.exitCode).toBe(1);
	});

	describe("under --json", () => {
		const chatty =
			(failure?: Error): Command["handler"] =>
			async (accessor) => {
				const logService = accessor.get(LogService);
				logService.intro("rogen main-test");
				logService.step("default.rogen.json");
				logService.info("Serving.");
				logService.success("Wrote default.project.json.");
				logService.note("beside it");
				logService.notice("Rogen 9.9.9 is out");
				logService.warn("careful");
				logService.error("broken");
				logService.debug("detail");
				logService.diagnostics([warning]);
				logService.diagnostics([warning], { asResult: true });
				logService.outro("Done.");
				if (failure) return err(failure);
				logService.result('{"done":true}');
				return ok(undefined);
			};
		const warning = warningDiagnostic(
			"tree.deadScript",
			{ resource: path.resolve("src/Dead.luau") },
			"never runs."
		);

		beforeEach(() => {
			jest.replaceProperty(process, "env", {
				...process.env,
				GITHUB_ACTIONS: "true",
			});
		});

		it("should print the document on stdout and nothing else, in a workflow and under -v too", async () => {
			store.add(
				registry.registerCommand(
					testCommand("main-test-json-chatty", chatty(), {
						options: [JsonOption],
					})
				)
			);

			await run(["main-test-json-chatty", "--json", "-v"]);

			expect(out).toEqual(['{"done":true}']);
			expect(errors).toEqual([]);
			expect(process.exitCode).toBe(0);
		});

		it("should print the failure as the only document", async () => {
			store.add(
				registry.registerCommand(
					testCommand(
						"main-test-json-fails",
						chatty(new DiagnosticsError([warning])),
						{ options: [JsonOption] }
					)
				)
			);

			await run(["main-test-json-fails", "--json"]);

			expect(out).toHaveLength(1);
			expect(JSON.parse(out[0])).toMatchObject({
				diagnostics: [{ code: "tree.deadScript" }],
			});
			expect(errors).toEqual([]);
		});
	});

	it("should annotate a failure's diagnostics once in a workflow", async () => {
		jest.replaceProperty(process, "env", {
			...process.env,
			GITHUB_ACTIONS: "true",
			GITHUB_WORKSPACE: process.cwd(),
		});
		store.add(
			registry.registerCommand(
				testCommand("main-test-annotates", async () =>
					err(
						new DiagnosticsError([
							errorDiagnostic(
								"config.invalidSyntax",
								{ resource: path.resolve("a.rogen.json") },
								"bad."
							),
						])
					)
				)
			)
		);

		await run(["main-test-annotates"]);

		expect(errors).toEqual([
			"::error file=a.rogen.json,title=config.invalidSyntax::bad.",
			"a.rogen.json - error: bad. (config.invalidSyntax)",
		]);
	});

	it("should send a command's own lines where its metadata says, for the line it got", async () => {
		const handler: Command["handler"] = async (accessor) => {
			accessor.get(LogService).info("Synced.");
			accessor.get(LogService).result("{}");
			return ok(undefined);
		};
		store.add(
			registry.registerCommand(
				testCommand("main-test-own-lines", handler, {
					options: [JsonOption],
					ownLinesToStderr: ({ options }) => options.json !== true,
				})
			)
		);
		store.add(
			registry.registerCommand(
				testCommand("main-test-stdout-lines", handler)
			)
		);

		await run(["main-test-own-lines"]);

		expect(out).toEqual(["{}"]);
		expect(errors).toEqual(["Synced."]);

		out.length = 0;
		errors.length = 0;
		await run(["main-test-stdout-lines"]);

		expect(out).toEqual(["Synced.", "{}"]);
		expect(errors).toEqual([]);
	});

	it("should add the stack of a crash under --json -v", async () => {
		store.add(
			registry.registerCommand(
				testCommand(
					"main-test-json-crash-verbose",
					async () => {
						throw new Error("kaboom");
					},
					{ options: [JsonOption] }
				)
			)
		);

		await run(["main-test-json-crash-verbose", "--json", "-v"]);

		expect(errors.join("\n")).toContain("Fatal Error: Error: kaboom");
		expect(process.exitCode).toBe(1);
	});

	it("should log an unexpected error raised while a command runs", async () => {
		store.add(
			registry.registerCommand(
				testCommand("main-test-strays", async () => {
					onUnexpectedError(new Error("stray failure"));
					return ok(undefined);
				})
			)
		);

		await run(["main-test-strays"]);

		expect(errors.join("\n")).toContain("stray failure");
		expect(process.exitCode).toBe(0);
	});

	it("should run a long-running command to its end", async () => {
		const ran = jest.fn<Command["handler"]>(async () => ok(undefined));
		store.add(
			registry.registerCommand(
				testCommand("main-test-serves", ran, { longRunning: true })
			)
		);

		await run(["main-test-serves"]);

		expect(ran).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(0);
	});

	describe("in a terminal", () => {
		const env = process.env;
		const stdinIsTTY = process.stdin.isTTY;
		const stdoutIsTTY = process.stdout.isTTY;

		beforeEach(() => {
			process.env = { NO_COLOR: "1", ROGEN_NO_UPDATE_CHECK: "1" };
			process.stdin.isTTY = true;
			process.stdout.isTTY = true;
		});

		afterEach(() => {
			process.env = env;
			process.stdin.isTTY = stdinIsTTY;
			process.stdout.isTTY = stdoutIsTTY;
		});

		it("should mark an error with the terminal's symbol", async () => {
			store.add(
				registry.registerCommand(
					testCommand("main-test-terminal", async () =>
						err(new ProjectError("The project is broken."))
					)
				)
			);

			await run(["main-test-terminal"]);

			expect(errors.join("\n")).toContain("■ The project is broken.");
			expect(process.exitCode).toBe(1);
		});
	});
});

describe("isLongRunning", () => {
	it("should hold for a command that always runs on", () => {
		expect(isLongRunning({ longRunning: true }, {})).toBe(true);
	});

	it("should hold for a command that runs on with its option given", () => {
		expect(
			isLongRunning({ longRunningWith: "watch" }, { watch: true })
		).toBe(true);
		expect(isLongRunning({ longRunningWith: "watch" }, {})).toBe(false);
	});

	it("should not hold for a command that ends", () => {
		expect(isLongRunning({}, {})).toBe(false);
		expect(isLongRunning(undefined, {})).toBe(false);
	});
});

describe("UpdateNotice", () => {
	it("should print the notice its check found", async () => {
		const logService = new MockLogService();

		await new UpdateNotice(
			Promise.resolve("Rogen 9.0.0 is out."),
			false,
			logService
		).print();

		expect(logService.texts("notice")).toEqual(["Rogen 9.0.0 is out."]);
	});

	it("should print nothing when the check fails, finds nothing or never ran", async () => {
		const logService = new MockLogService();

		await new UpdateNotice(
			Promise.reject(new Error("offline")),
			false,
			logService
		).print();
		await new UpdateNotice(
			Promise.resolve(undefined),
			false,
			logService
		).print();
		await new UpdateNotice(undefined, true, logService).print();

		expect(logService.entries).toEqual([]);
	});
});
