import "../check-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ReportedError } from "../../../base/errors.js";
import { Result } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";

const ROUTES = {
	Server: "ServerScriptService",
	"*": "ReplicatedStorage/Shared",
};

describe("check command", () => {
	let fs: MemoryFileSystemService;
	let logService: MockLogService;
	let run: (
		args: CommandLine["options"] & { _?: string[] }
	) => Promise<Result<void, Error>>;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(`/repo/${p}`, "");
	};

	const writeConfig = (file: string, config: Record<string, unknown>) =>
		fs.writeFile(`/repo/${file}`, JSON.stringify(config));

	const failureOf = (result: Result<void, Error>): DiagnosticsError => {
		const error = result.isErr() ? result.error : undefined;
		const cause = error instanceof ReportedError ? error.cause : error;
		expect(cause).toBeInstanceOf(DiagnosticsError);
		return cause as DiagnosticsError;
	};

	const found = (error: DiagnosticsError) =>
		error.diagnostics.map(({ code, resource }) => [
			code,
			resource.replace("/repo/", ""),
		]);

	const document = () =>
		JSON.parse(
			logService.entries.find(({ kind }) => kind === "print")?.text ?? ""
		) as { diagnostics: { code: string; file: string }[] };

	beforeEach(async () => {
		const harness = commandHarness();
		({ fs } = harness);
		logService = harness.log;
		run = ({ _ = [], ...options }) =>
			harness.run("check", { positionals: _, options });
	});

	const printed = () => logService.texts("print");

	describe("with paths", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
		});

		it("should print the findings as output, not as warnings", async () => {
			await write("src/Save@sever.luau");

			await run({ _: ["src/Save@sever.luau"] });

			expect(printed()).toEqual([
				'src/Save@sever.luau - warning: did you mean "@Server"? (route.strayAt)',
			]);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
		});

		it("should print the findings under --quiet", async () => {
			logService.setLevel(LogLevel.Error);
			await write("src/Save@sever.luau");

			await run({ _: ["src/Save@sever.luau"] });

			expect(printed()).toHaveLength(1);
		});

		it("should fail with the diagnostics about a path", async () => {
			await write("src/Save@sever.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Save@sever.luau"] });

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "src/Save@sever.luau"],
			]);
		});

		it("should narrow a grouped warning to the path it is asked about", async () => {
			await write("src/Save@sever.luau", "src/Load@sever.luau");

			const error = failureOf(await run({ _: ["src/Save@sever.luau"] }));

			expect(error.message).toContain("Save@sever");
			expect(error.message).not.toContain("Load@sever");
		});

		it("should pass a clean path", async () => {
			await write("src/Save@sever.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Clean.luau"] });

			expect(result.isOk()).toBe(true);
			expect(logService.entries).toEqual([]);
		});

		it("should check a file that does not exist yet as if it were created", async () => {
			await write("src/Clean.luau");

			const result = await run({ _: ["src/New@sever.luau"] });

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "src/New@sever.luau"],
			]);
		});

		it("should check the files in a directory", async () => {
			await write("src/Inventory/Save@sever.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Inventory"] });

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "src/Inventory/Save@sever.luau"],
			]);
		});

		it("should say a diagnostic once when several configs raise it", async () => {
			await writeConfig("lobby.rogen.json", { routes: ROUTES });
			await write("src/Save@sever.luau");

			const result = await run({ _: ["src/Save@sever.luau"] });

			expect(found(failureOf(result))).toHaveLength(1);
		});

		it("should leave out the warnings about the sync dir", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				syncDir: "out",
			});
			await write("src/Clean.luau");

			expect((await run({ _: ["src/Clean.luau"] })).isOk()).toBe(true);
		});

		it("should fail when a config does not load, whichever path is asked about", async () => {
			await fs.writeFile("/repo/broken.rogen.json", "{ nope");
			await write("src/Clean.luau");

			const result = await run({ _: ["src/Clean.luau"] });

			expect(
				new Set(found(failureOf(result)).map(([code]) => code))
			).toEqual(new Set(["config.invalidSyntax"]));
		});

		it("should write nothing", async () => {
			await write("src/Clean.luau");

			await run({ _: ["src/Clean.luau"] });

			expect(await fs.exists("/repo/default.project.json")).toBe(false);
		});
	});

	describe("without paths", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
		});

		it("should fail with every diagnostic of the project", async () => {
			await write("src/Save@sever.luau", "src/Clean.luau");

			const result = await run({});

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "src/Save@sever.luau"],
			]);
		});

		it("should print one line per file a grouped warning is about", async () => {
			await write("src/Save@sever.luau", "src/Load@sever.luau");

			await run({});

			expect(printed()).toEqual([
				'src/Load@sever.luau - warning: did you mean "@Server"? (route.strayAt)',
				'src/Save@sever.luau - warning: did you mean "@Server"? (route.strayAt)',
			]);
		});

		it("should not cap the files a grouped warning is about", async () => {
			const names = Array.from(
				{ length: 12 },
				(_, i) => `A${i}@sever.luau`
			);
			await write(...names.map((name) => `src/${name}`));

			await run({});

			expect(printed()).toHaveLength(12);
		});

		it("should keep a warning that is not about a file as it is", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				rootDirs: ["missing"],
			});

			await run({});

			expect(printed()).toEqual([
				"missing - warning: this root dir does not exist, so it contributes nothing. (scan.missingRootDir)",
			]);
		});

		it("should include the warnings about the sync dir", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				syncDir: "out",
			});
			await write("src/Clean.luau");

			const result = await run({});

			expect(
				failureOf(result).diagnostics.map(({ code }) => code)
			).toEqual(["output.nothingEmitted"]);
		});

		it("should pass a clean project, and write nothing", async () => {
			await write("src/Clean.luau");

			const result = await run({});

			expect(result.isOk()).toBe(true);
			expect(await fs.exists("/repo/default.project.json")).toBe(false);
		});

		it("should say a warning once when two configs share it", async () => {
			await writeConfig("lobby.rogen.json", { routes: ROUTES });
			await write("src/Save@sever.luau");

			const result = await run({});

			expect(found(failureOf(result))).toHaveLength(1);
		});

		it("should fail on an error, and on a config that does not load", async () => {
			await fs.writeFile("/repo/broken.rogen.json", "{ nope");
			await write("src/Clean.luau");

			const result = await run({});

			expect(
				new Set(failureOf(result).diagnostics.map(({ code }) => code))
			).toEqual(new Set(["config.invalidSyntax"]));
		});
	});

	describe("with --json", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
		});

		it("should print the diagnostics and fail when there are any", async () => {
			await write("src/Save@sever.luau");

			const result = await run({
				_: ["src/Save@sever.luau"],
				json: true,
			});

			expect(result.isErr()).toBe(true);
			expect(document().diagnostics).toMatchObject([
				{ code: "route.strayAt" },
			]);
		});

		it("should print an empty list and pass when clean", async () => {
			await write("src/Clean.luau");

			const result = await run({ json: true });

			expect(result.isOk()).toBe(true);
			expect(document()).toEqual({ diagnostics: [] });
		});
	});
});
