import { toPosix } from "../../../base/path.js";
import path from "path";
import "../check-command.js";
import "../../write/write-command.js";
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
			toPosix(path.relative(path.resolve("/repo"), resource)),
		]);

	const document = () =>
		JSON.parse(
			logService.entries.find(({ kind }) => kind === "print")?.text ?? ""
		) as {
			diagnostics: { code: string; file: string }[];
			skipped?: { path: string; reason: string; config?: string }[];
		};

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
				routes: ROUTES,
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

		it("should say a file in no source path, that is no typo of one, is left out of the project file, and pass", async () => {
			await write("src/Inventory/Server/Save.luau");
			await write("lib/x.luau");

			const result = await run({ _: ["lib/x.luau"] });

			expect(result.isOk()).toBe(true);
			expect(logService.texts("warn")).toEqual([]);
			expect(logService.texts("notice")).toEqual([
				"note: lib/x.luau: in no source path of default.rogen.json, so Rogen leaves it out of the project file.",
			]);
		});

		it("should list a file in no source path under skipped in the JSON document", async () => {
			await write("src/Inventory/Server/Save.luau");
			await write("lib/x.luau");

			await run({ _: ["lib/x.luau"], json: true });

			expect(document()).toEqual({
				diagnostics: [],
				skipped: [
					{
						path: "/repo/lib/x.luau",
						reason: "outsideSourcePaths",
						config: "default.rogen.json",
					},
				],
			});
		});

		it("should leave skipped out of the JSON document when every path is read", async () => {
			await write("src/Save.luau");

			await run({ _: ["src/Save.luau"], json: true });

			expect(document()).toEqual({ diagnostics: [] });
		});

		it("should not note a typo'd path that is warned about", async () => {
			await write("src/Inventory/Server/Save.luau");
			await write("scr/Inventory/Server/X.luau");

			await run({ _: ["scr/Inventory/Server/X.luau"], json: true });

			expect(document()).toMatchObject({
				diagnostics: [{ code: "scan.outsideSourcePaths" }],
			});
			expect(document()).not.toHaveProperty("skipped");
		});

		it("should fail on an error elsewhere that stops the write, printing it as a finding, so a hook or CI can't pass a path it never got to check", async () => {
			await writeConfig("default.rogen.json", {
				routes: { Shared: "ReplicatedStorage/Shared", ...ROUTES },
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@Server.luau"
			);

			const result = await run({ _: ["src/F/Shared/Good.luau"] });

			expect(result.isErr()).toBe(true);
			expect(printed()).toEqual([
				expect.stringMatching(
					/^src[\\/]F[\\/]Shared[\\/]Bad@Server\.luau - error: .*\(route\.ignoredAt\)$/
				),
			]);
			expect(logService.texts("warn")).toEqual([
				"The write stops on the error above, so the paths were checked only as far as it gets; fix it and check again.",
			]);
		});

		it("should say them when several errors elsewhere stop the write", async () => {
			await writeConfig("default.rogen.json", {
				routes: { Shared: "ReplicatedStorage/Shared", ...ROUTES },
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@Server.luau",
				"src/F/Shared/Worse@Server.luau"
			);

			const result = await run({ _: ["src/F/Shared/Good.luau"] });

			expect(result.isErr()).toBe(true);
			expect(logService.texts("warn")).toEqual([
				"The write stops on the errors above, so the paths were checked only as far as it gets; fix them and check again.",
			]);
		});

		it("should fail when a path's config is named by two files", async () => {
			await writeConfig("game.rogen.json", { routes: ROUTES });
			await writeConfig("game.rogen.jsonc", { routes: ROUTES });

			const result = await run({ _: ["game"] });

			expect((result as { error: Error }).error.message).toContain(
				"game.rogen.json"
			);
			expect(printed()).toEqual([]);
		});

		it("should fail when the tree mounts the source path of an instance it checks", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { $path: "src" },
				},
			});
			await write("src/F/Shared/Good.luau");

			const result = await run({ _: ["ServerScriptService.Main"] });

			expect(failureOf(result).diagnostics).toMatchObject([
				{ code: "tree.mountsSourcePath" },
			]);
		});

		it("should list what stops the build in the JSON document, beside the findings", async () => {
			await writeConfig("default.rogen.json", {
				routes: { Shared: "ReplicatedStorage/Shared", ...ROUTES },
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@Server.luau"
			);

			const result = await run({
				_: ["src/F/Shared/Good.luau"],
				json: true,
			});

			expect(result.isErr()).toBe(true);
			expect(
				JSON.parse(printed()[0]) as { stoppedBy: { code: string }[] }
			).toMatchObject({
				diagnostics: [],
				stoppedBy: [{ code: "route.ignoredAt" }],
			});
		});

		it("should print the findings as output, not as warnings", async () => {
			await write("src/Save.client.luau");

			await run({ _: ["src/Save.client.luau"] });

			expect(printed()).toEqual([
				'src/Save.client.luau - warning: a LocalScript never runs in ReplicatedStorage: no route is named "client", so ".client" routes nothing (tree.deadScript)',
			]);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
		});

		it("should print the findings under --quiet", async () => {
			logService.setLevel(LogLevel.Error);
			await write("src/Save.client.luau");

			await run({ _: ["src/Save.client.luau"] });

			expect(printed()).toHaveLength(1);
		});

		it("should fail with the diagnostics about a path", async () => {
			await write("src/Save.client.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Save.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/Save.client.luau"],
			]);
		});

		it("should give only the warnings about the path it is asked about", async () => {
			await write("src/Save.client.luau", "src/Load.client.luau");

			const error = failureOf(await run({ _: ["src/Save.client.luau"] }));

			expect(error.message).toContain("Save.client");
			expect(error.message).not.toContain("Load.client");
		});

		it("should pass a clean path", async () => {
			await write("src/Save.client.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Clean.luau"] });

			expect(result.isOk()).toBe(true);
			expect(logService.entries).toEqual([]);
		});

		it("should check a file that does not exist yet as if it were created", async () => {
			await write("src/Clean.luau");

			const result = await run({ _: ["src/New.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/New.client.luau"],
			]);
		});

		it("should check the files in a directory", async () => {
			await write("src/Inventory/Save.client.luau", "src/Clean.luau");

			const result = await run({ _: ["src/Inventory"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/Inventory/Save.client.luau"],
			]);
		});

		it("should leave out the warnings about the compiled path", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				compiledPath: "out",
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
					sourcePaths: ["../shared/src", "src"],
					routes: ROUTES,
				});
			await write(
				"places/shared/src/Stray.client.luau",
				"places/lobby/src/Buy.client.luau",
				"places/lobby/src/Clean.luau",
				"places/arena/src/Sell.client.luau"
			);
		});

		it("should check a file of a place from the root, by the config of that place", async () => {
			const result = await run({
				_: ["places/lobby/src/Buy.client.luau"],
			});

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "places/lobby/src/Buy.client.luau"],
			]);
		});

		it("should check files of two places, each by its own config", async () => {
			const result = await run({
				_: [
					"places/lobby/src/Buy.client.luau",
					"places/arena/src/Sell.client.luau",
				],
			});

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "places/lobby/src/Buy.client.luau"],
				["tree.deadScript", "places/arena/src/Sell.client.luau"],
			]);
		});

		it("should skip a file that no config covers with a note, and pass", async () => {
			const result = await run({
				_: ["places/shared/src/Stray.client.luau"],
			});

			expect(result.isOk()).toBe(true);
			expect(logService.texts("warn")).toEqual([]);
			expect(logService.texts("notice")).toEqual([
				"note: places/shared/src/Stray.client.luau: no config at or above it reads it, but other configs list it in their source paths. Check it through one: 'rogen check places/arena/default.rogen.json' or 'rogen check places/lobby/default.rogen.json'.",
			]);
		});

		it("should name the named configs of the working folder as the way to check it", async () => {
			await writeConfig("game.rogen.json", {
				name: "game",
				routes: ROUTES,
			});
			await writeConfig("arena.rogen.json", {
				name: "arena",
				routes: ROUTES,
			});

			await write("places/shared/Stray.client.luau");

			await run({ _: ["places/shared/Stray.client.luau"] });

			expect(logService.texts("notice")).toEqual([
				"note: places/shared/Stray.client.luau: no config at or above it reads it. Check it through one: rogen check arena.rogen.json or game.rogen.json.",
			]);
		});

		it("should list a file that no config covers under skipped in the JSON document", async () => {
			await run({
				_: ["places/shared/src/Stray.client.luau"],
				json: true,
			});

			expect(document()).toEqual({
				diagnostics: [],
				skipped: [
					{
						path: "/repo/places/shared/src/Stray.client.luau",
						reason: "noConfig",
						readers: [
							"places/arena/default.rogen.json",
							"places/lobby/default.rogen.json",
						],
					},
				],
			});
		});

		it("should check the files that have a config and skip the rest", async () => {
			const result = await run({
				_: [
					"places/shared/src/Stray.client.luau",
					"places/lobby/src/Buy.client.luau",
				],
			});

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "places/lobby/src/Buy.client.luau"],
			]);
			expect(logService.texts("notice")).toHaveLength(1);
		});

		it("should check a config named by its file whole", async () => {
			const result = await run({
				_: ["places/lobby/default.rogen.json"],
			});

			expect(
				new Set(found(failureOf(result)).map(([, file]) => file))
			).toEqual(
				new Set([
					"places/lobby/src/Buy.client.luau",
					"places/shared/src/Stray.client.luau",
				])
			);
		});

		it("should check a folder by its own config", async () => {
			const result = await run({ _: ["places/arena"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "places/arena/src/Sell.client.luau"],
			]);
		});

		it("should report the stale project file of the folder it checks", async () => {
			await fs.writeFile("/repo/places/arena/default.project.json", "{}");

			const result = await run({ _: ["places/arena"] });

			expect(found(failureOf(result))).toContainEqual([
				"output.differs",
				"places/arena/default.project.json",
			]);
		});

		it("should report the stale project file of the config that holds a file it checks", async () => {
			await fs.writeFile("/repo/places/arena/default.project.json", "{}");

			const result = await run({
				_: ["places/arena/src/Sell.client.luau"],
			});

			expect(found(failureOf(result))).toContainEqual([
				"output.differs",
				"places/arena/default.project.json",
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
					"places/lobby/src/Buy.client.luau",
					"places/shared/src/Stray.client.luau",
				])
			);
		});

		it("should report a skipped file on stderr and still print the JSON document", async () => {
			const result = await run({
				_: ["places/shared/src/Stray.client.luau"],
				json: true,
			});

			expect(result.isOk()).toBe(true);
			expect(document().diagnostics).toEqual([]);
		});
	});

	describe("with root-level places", () => {
		beforeEach(async () => {
			for (const place of ["game", "lobby"])
				await writeConfig(`${place}.rogen.json`, {
					name: place,
					sourcePaths: ["src/common", `src/${place}`],
					routes: ROUTES,
				});
			await write(
				"src/common/Stray.client.luau",
				"src/game/Buy.client.luau",
				"src/lobby/Clean.luau"
			);
		});

		it("should check a file of a place by the config that holds it", async () => {
			const result = await run({ _: ["src/game/Buy.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/game/Buy.client.luau"],
			]);
		});

		it("should check a shared file by every config that holds it, and report it once", async () => {
			const result = await run({ _: ["src/common/Stray.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/common/Stray.client.luau"],
			]);
		});

		it("should check a file that does not exist yet", async () => {
			await write("src/common/New.client.luau");

			const result = await run({ _: ["src/common/New.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/common/New.client.luau"],
			]);
		});

		it("should skip a file that no config holds with a note, and pass", async () => {
			await write("tools/Stray.client.luau");

			const result = await run({ _: ["tools/Stray.client.luau"] });

			expect(result.isOk()).toBe(true);
			expect(logService.texts("notice")).toHaveLength(1);
		});

		it("should check a folder by every config that holds some of it", async () => {
			const result = await run({ _: ["src"] });

			expect(
				new Set(found(failureOf(result)).map(([, file]) => file))
			).toEqual(
				new Set([
					"src/common/Stray.client.luau",
					"src/game/Buy.client.luau",
				])
			);
		});

		it("should leave a nearer default config to answer, as for any file", async () => {
			await writeConfig("src/lobby/default.rogen.json", {
				sourcePaths: ["."],
				routes: ROUTES,
			});
			await write("src/lobby/Sell.client.luau");

			const result = await run({ _: ["src/lobby/Sell.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/lobby/Sell.client.luau"],
			]);
		});

		it("should check a config named by its bare name whole", async () => {
			const byName = await run({ _: ["game"] });
			const byFile = await run({ _: ["game.rogen.json"] });

			expect(found(failureOf(byName))).toEqual(found(failureOf(byFile)));
			expect(
				new Set(found(failureOf(byName)).map(([, file]) => file))
			).toEqual(
				new Set([
					"src/common/Stray.client.luau",
					"src/game/Buy.client.luau",
				])
			);
		});

		it("should check a bare name that stands for a project file", async () => {
			await fs.writeFile("/repo/arena.project.json", "{}");

			const result = await run({ _: ["arena"] });

			expect(found(failureOf(result))).toEqual([
				["config.unnamedProjectFile", "arena.project.json"],
			]);
			expect(logService.texts("notice")).toEqual([]);
		});

		it("should read a bare name that is a folder with a default as the write does", async () => {
			await writeConfig("dist.rogen.json", {
				name: "dist",
				routes: ROUTES,
			});
			await writeConfig("dist/default.rogen.json", {
				routes: ROUTES,
			});
			await write("dist/src/Stray.client.luau");

			const result = await run({ _: ["dist"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "dist/src/Stray.client.luau"],
			]);
		});

		it("should still check a file that no config is named for", async () => {
			await write("src/game/New.client.luau");

			const result = await run({ _: ["src/game/New.client.luau"] });

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/game/New.client.luau"],
			]);
		});

		describe("bare, in a folder of several configs", () => {
			const clean = async () => {
				await fs.delete("/repo/src/common/Stray.client.luau");
				await fs.delete("/repo/src/game/Buy.client.luau");
			};

			it("should check every config of the folder", async () => {
				const result = await run({});

				expect(
					new Set(found(failureOf(result)).map(([, file]) => file))
				).toEqual(
					new Set([
						"src/common/Stray.client.luau",
						"src/game/Buy.client.luau",
					])
				);
			});

			it("should fail on a config that does not load beside configs that do", async () => {
				await clean();
				await fs.writeFile("/repo/release.rogen.json", "{ nope");

				const result = await run({});

				expect(
					new Set(found(failureOf(result)).map(([code]) => code))
				).toEqual(new Set(["config.invalidSyntax"]));
			});

			it("should pass when every config is clean", async () => {
				await clean();

				const result = await run({});

				expect(result.isOk()).toBe(true);
			});

			it("should report the stale project file of a config that is not the first", async () => {
				await clean();
				await fs.writeFile("/repo/lobby.project.json", "{}");

				const result = await run({});

				expect(found(failureOf(result))).toEqual([
					["output.differs", "lobby.project.json"],
				]);
			});

			it("should not report a project file that is not written yet", async () => {
				await clean();
				await harness.run("write", {
					positionals: ["game"],
					options: {},
				});

				const result = await run({});

				expect(result.isOk()).toBe(true);
				expect(await fs.exists("/repo/lobby.project.json")).toBe(false);
			});
		});
	});

	describe("without paths", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
			});
		});

		it("should fail with every diagnostic of the project", async () => {
			await write("src/Save.client.luau", "src/Clean.luau");

			const result = await run({});

			expect(found(failureOf(result))).toEqual([
				["tree.deadScript", "src/Save.client.luau"],
			]);
		});

		it("should print one line per file a warning is about", async () => {
			await write("src/Save.client.luau", "src/Load.client.luau");

			await run({});

			expect(printed()).toEqual([
				'src/Load.client.luau - warning: a LocalScript never runs in ReplicatedStorage: no route is named "client", so ".client" routes nothing (tree.deadScript)',
				'src/Save.client.luau - warning: a LocalScript never runs in ReplicatedStorage: no route is named "client", so ".client" routes nothing (tree.deadScript)',
			]);
		});

		it("should not cap the warnings of one code", async () => {
			const names = Array.from(
				{ length: 12 },
				(_, i) => `A${i}.client.luau`
			);
			await write(...names.map((name) => `src/${name}`));

			await run({});

			expect(printed()).toHaveLength(12);
		});

		it("should keep a warning that is not about a file as it is", async () => {
			await write("src/Clean.luau");
			await writeConfig("default.rogen.json", {
				sourcePaths: ["src", "missing"],
				routes: ROUTES,
			});

			await run({});

			expect(printed()).toEqual([
				"missing - warning: this source path does not exist or is not a folder, so it contributes nothing. (scan.missingSourcePath)",
			]);
		});

		it("should include the warnings about the compiled path", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				compiledPath: "out",
			});
			await write("src/Clean.luau");

			const result = await run({});

			expect(
				failureOf(result).diagnostics.map(({ code }) => code)
			).toEqual(["output.nothingEmitted"]);
		});

		it("should warn that a written project file differs from what a write would write", async () => {
			await write("src/Clean.luau");
			await fs.writeFile("/repo/default.project.json", "{}");

			const result = await run({});

			expect(found(failureOf(result))).toEqual([
				["output.differs", "default.project.json"],
			]);
			expect(await fs.readFile("/repo/default.project.json")).toBe("{}");
		});

		it("should pass when the project file is what a write would write", async () => {
			await write("src/Clean.luau");
			await harness.run("write");
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
				routes: ROUTES,
			});
		});

		it("should print the diagnostics and fail when there are any", async () => {
			await write("src/Save.client.luau");

			const result = await run({
				_: ["src/Save.client.luau"],
				json: true,
			});

			expect(result.isErr()).toBe(true);
			expect(document().diagnostics).toMatchObject([
				{ code: "tree.deadScript" },
			]);
		});

		it("should print an empty list and pass when clean", async () => {
			await write("src/Clean.luau");

			const result = await run({ json: true });

			expect(result.isOk()).toBe(true);
			expect(document()).toEqual({ diagnostics: [] });
		});

		const LOWER_ROUTES = {
			server: "ServerScriptService",
			client: "StarterPlayer/StarterPlayerScripts",
			shared: "ReplicatedStorage/shared",
			"*": "ReplicatedStorage/shared",
		};

		it.each([
			{
				code: "scan.sourcePathNamedAfterKey",
				config: { sourcePaths: ["server", "src/client"] },
				files: ["server/Save.luau", "src/client/Hud.luau"],
			},
			{
				code: "route.serverCodeShipped",
				config: {},
				files: [
					"src/shared/server/Datastore.luau",
					"src/shared/server/Secret.luau",
				],
			},
			{
				code: "tree.deadScript",
				config: {},
				files: [
					"src/shared/Run.server.luau",
					"src/shared/Hud.client.luau",
				],
			},
			{
				code: "tree.runContextTarget",
				config: { emitLegacyScripts: false },
				files: [
					"src/Panel/init.client.luau",
					"src/Menu/init.client.luau",
				],
			},
			{
				code: "tree.mountClash",
				config: {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { shared: { $path: "vendor" } },
					},
				},
				files: [
					"vendor/Combat/init.luau",
					"src/Combat/Hit.luau",
					"src/Combat/Miss.luau",
				],
			},
		])(
			"should give the write's diagnostic objects for $code",
			async ({ code, config, files }) => {
				await writeConfig("default.rogen.json", {
					routes: LOWER_ROUTES,
					...config,
				});
				await write(...files);

				await harness.run("write", {
					positionals: [],
					options: { json: true },
				});
				const written = JSON.parse(printed()[0]) as {
					configs: { diagnostics: { code: string }[] }[];
				};
				logService.clear();
				await run({ json: true });

				const { diagnostics } = written.configs[0];
				expect(
					diagnostics.filter((diagnostic) => diagnostic.code === code)
				).toHaveLength(2);
				expect(document().diagnostics).toEqual(diagnostics);
			}
		);
	});

	describe("on GitHub Actions", () => {
		let annotated: MockLogService;
		let runAnnotated: (
			args: CommandLine["options"] & { _?: string[] }
		) => Promise<Result<void, Error>>;

		beforeEach(async () => {
			annotated = new MockLogService({
				cwd: "/repo",
				annotationsIn: "/repo",
			});
			const harness = commandHarness({ log: annotated, fs });
			runAnnotated = ({ _ = [], ...options }) =>
				harness.run("check", { positionals: _, options });
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
			});
			await write("src/Save.client.luau");
		});

		it("should annotate each finding beside printing it", async () => {
			await runAnnotated({ _: ["src/Save.client.luau"] });

			expect(annotated.texts("print")).toEqual([
				'src/Save.client.luau - warning: a LocalScript never runs in ReplicatedStorage: no route is named "client", so ".client" routes nothing (tree.deadScript)',
			]);
			expect(annotated.texts("annotation")).toEqual([
				'::warning file=src/Save.client.luau,title=tree.deadScript::a LocalScript never runs in ReplicatedStorage: no route is named "client", so ".client" routes nothing',
			]);
		});

		it("should write no workflow commands into the JSON document", async () => {
			await runAnnotated({ _: ["src/Save.client.luau"], json: true });

			expect(annotated.texts("annotation")).toEqual([]);
		});
	});
});
