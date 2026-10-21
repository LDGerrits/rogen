import "../check-command.js";
import "../../build/build-command.js";
import {
	CommandHarness,
	commandHarness,
} from "../../__tests__/command-harness.js";
import { Result } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { ReportedError } from "../../../platform/commands/commands.js";

const ROUTES = {
	Server: "ServerScriptService",
	"*": "ReplicatedStorage/Shared",
};

describe("check command", () => {
	let fs: MemoryFileSystemService;
	let logService: MockLogService;
	let harness: CommandHarness<MockLogService>;
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
		harness = commandHarness();
		({ fs } = harness);
		logService = harness.log;
		run = ({ _ = [], ...options }) =>
			harness.run("check", { positionals: _, options });
	});

	const printed = () => logService.texts("print");

	describe("with paths", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
		});

		it("should warn of a path whose first folder is a typo of the source path", async () => {
			await write("src/Inventory/Server/Save.luau");
			await write("scr/Inventory/Server/X.luau");

			const result = await run({ _: ["scr/Inventory/Server/X.luau"] });

			expect(found(failureOf(result))).toEqual([
				["scan.outsideSourcePaths", "scr/Inventory/Server/X.luau"],
			]);
		});

		it("should say nothing of a file in no source path that is no typo of one", async () => {
			await write("src/Inventory/Server/Save.luau");
			await write("README.md");

			const result = await run({ _: ["README.md"] });

			expect(result.isOk()).toBe(true);
		});

		it("should pass a file that an error elsewhere does not concern, and say how far the check got", async () => {
			await writeConfig("default.rogen.json", {
				rogen: {
					routes: { shared: "ReplicatedStorage/Shared", ...ROUTES },
				},
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@server.luau"
			);

			const result = await run({ _: ["src/F/Shared/Good.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([]);
			expect(logService.texts("warn")).toEqual([
				"Checked as far as the build gets: it stops on src/F/Shared/Bad@server.luau (route.ignoredAt). Run 'rogen check' to see everything.",
			]);
		});

		it("should list what stops the build in the JSON document, beside the findings", async () => {
			await writeConfig("default.rogen.json", {
				rogen: {
					routes: { shared: "ReplicatedStorage/Shared", ...ROUTES },
				},
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@server.luau"
			);

			await run({ _: ["src/F/Shared/Good.luau"], json: true });

			expect(
				JSON.parse(printed()[0]) as { stoppedBy: { code: string }[] }
			).toMatchObject({
				diagnostics: [],
				stoppedBy: [{ code: "route.ignoredAt" }],
			});
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

		it("should leave out the warnings about the compiled path", async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES, compiledPath: "out" },
			});
			await write("src/Clean.luau");

			expect((await run({ _: ["src/Clean.luau"] })).isOk()).toBe(true);
		});

		it("should fail when a config does not load, whichever path is asked about", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{ nope");
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

	describe("with several places", () => {
		beforeEach(async () => {
			for (const place of ["lobby", "arena"])
				await writeConfig(`places/${place}/default.rogen.json`, {
					name: place,
					rogen: {
						sourcePaths: ["../shared/src", "src"],
						routes: ROUTES,
					},
				});
			await write(
				"places/shared/src/Stray@sever.luau",
				"places/lobby/src/Buy@sever.luau",
				"places/lobby/src/Clean.luau",
				"places/arena/src/Sell@sever.luau"
			);
		});

		it("should check a file of a place from the root, by the config of that place", async () => {
			const result = await run({
				_: ["places/lobby/src/Buy@sever.luau"],
			});

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "places/lobby/src/Buy@sever.luau"],
			]);
		});

		it("should check files of two places, each by its own config", async () => {
			const result = await run({
				_: [
					"places/lobby/src/Buy@sever.luau",
					"places/arena/src/Sell@sever.luau",
				],
			});

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "places/lobby/src/Buy@sever.luau"],
				["route.strayAt", "places/arena/src/Sell@sever.luau"],
			]);
		});

		it("should skip a file that no config covers with a note, and pass", async () => {
			const result = await run({
				_: ["places/shared/src/Stray@sever.luau"],
			});

			expect(result.isOk()).toBe(true);
			expect(logService.texts("warn")).toEqual([
				"places/shared/src/Stray@sever.luau: no config covers this file; check it through a place: rogen check places/lobby",
			]);
		});

		it("should check the files that have a config and skip the rest", async () => {
			const result = await run({
				_: [
					"places/shared/src/Stray@sever.luau",
					"places/lobby/src/Buy@sever.luau",
				],
			});

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "places/lobby/src/Buy@sever.luau"],
			]);
			expect(logService.texts("warn")).toHaveLength(1);
		});

		it("should check a config named by its file whole", async () => {
			const result = await run({
				_: ["places/lobby/default.rogen.json"],
			});

			expect(
				new Set(found(failureOf(result)).map(([, file]) => file))
			).toEqual(
				new Set([
					"places/lobby/src/Buy@sever.luau",
					"places/shared/src/Stray@sever.luau",
				])
			);
		});

		it("should check a folder by its own config", async () => {
			const result = await run({ _: ["places/arena"] });

			expect(found(failureOf(result))).toEqual([
				["route.strayAt", "places/arena/src/Sell@sever.luau"],
			]);
		});

		it("should not search upward for a bare check at the root", async () => {
			const result = await run({});

			expect(result.isErr()).toBe(true);
			expect((result as { error: Error }).error.message).toContain(
				"No default.rogen.json or default.project.json in this folder"
			);
		});

		it("should check the folder's own default for a bare check in a place", async () => {
			const place = commandHarness({ fs, cwd: "/repo/places/lobby" });

			const result = await place.run("check", {
				positionals: [],
				options: {},
			});

			expect(
				new Set(found(failureOf(result)).map(([, file]) => file))
			).toEqual(
				new Set([
					"places/lobby/src/Buy@sever.luau",
					"places/shared/src/Stray@sever.luau",
				])
			);
		});

		it("should report a skipped file on stderr and still print the JSON document", async () => {
			const result = await run({
				_: ["places/shared/src/Stray@sever.luau"],
				json: true,
			});

			expect(result.isOk()).toBe(true);
			expect(document().diagnostics).toEqual([]);
		});
	});

	describe("without paths", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
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
			await write("src/Clean.luau");
			await writeConfig("default.rogen.json", {
				rogen: { sourcePaths: ["src", "missing"], routes: ROUTES },
			});

			await run({});

			expect(printed()).toEqual([
				"missing - warning: this source path does not exist or is not a folder, so it contributes nothing. (scan.missingSourcePath)",
			]);
		});

		it("should include the warnings about the compiled path", async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES, compiledPath: "out" },
			});
			await write("src/Clean.luau");

			const result = await run({});

			expect(
				failureOf(result).diagnostics.map(({ code }) => code)
			).toEqual(["output.nothingEmitted"]);
		});

		it("should warn that a written project file differs from what a build would write", async () => {
			await write("src/Clean.luau");
			await fs.writeFile("/repo/default.project.json", "{}");

			const result = await run({});

			expect(found(failureOf(result))).toEqual([
				["output.differs", "default.project.json"],
			]);
			expect(await fs.readFile("/repo/default.project.json")).toBe("{}");
		});

		it("should pass when the project file is what a build would write", async () => {
			await write("src/Clean.luau");
			await harness.run("build");
			expect(await fs.exists("/repo/default.project.json")).toBe(true);

			const result = await run({});

			expect(result.isOk()).toBe(true);
		});

		it("should pass a clean project, and write nothing", async () => {
			await write("src/Clean.luau");

			const result = await run({});

			expect(result.isOk()).toBe(true);
			expect(await fs.exists("/repo/default.project.json")).toBe(false);
		});

		it("should fail on an error, and on a config that does not load", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{ nope");
			await write("src/Clean.luau");

			const result = await run({});

			expect(
				new Set(failureOf(result).diagnostics.map(({ code }) => code))
			).toEqual(new Set(["config.invalidSyntax"]));
		});
	});

	describe("with --json", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
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

	describe("on GitHub Actions", () => {
		let annotated: MockLogService;
		let runAnnotated: (
			args: CommandLine["options"] & { _?: string[] }
		) => Promise<Result<void, Error>>;

		beforeEach(async () => {
			annotated = new MockLogService("/repo", "/repo");
			const harness = commandHarness({ log: annotated, fs });
			runAnnotated = ({ _ = [], ...options }) =>
				harness.run("check", { positionals: _, options });
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Save@sever.luau");
		});

		it("should annotate each finding beside printing it", async () => {
			await runAnnotated({ _: ["src/Save@sever.luau"] });

			expect(annotated.texts("print")).toEqual([
				'src/Save@sever.luau - warning: did you mean "@Server"? (route.strayAt)',
			]);
			expect(annotated.texts("annotation")).toEqual([
				'::warning file=src/Save@sever.luau,title=route.strayAt::did you mean "@Server"?',
			]);
		});

		it("should write no workflow commands into the JSON document", async () => {
			await runAnnotated({ _: ["src/Save@sever.luau"], json: true });

			expect(annotated.texts("annotation")).toEqual([]);
		});
	});
});
