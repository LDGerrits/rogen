import "../where-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { Result } from "../../../base/result.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockInputService } from "../../../platform/input/__tests__/mock-input-service.js";
import { UsageError } from "../../../base/errors.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";

const ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage/Shared",
};

describe("where command", () => {
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

	const printed = () =>
		logService.texts("print").flatMap((text) => text.split("\n"));

	beforeEach(async () => {
		const harness = commandHarness();
		({ fs } = harness);
		logService = harness.log;
		run = ({ _ = [], ...options }) =>
			harness.run("where", { positionals: _, options });
	});

	it("should print where each path lands and why, relative to the working directory", async () => {
		await writeConfig("default.rogen.json", {
			globIgnorePaths: ["**/*.spec.luau"],
			rogen: { routes: ROUTES },
		});
		await write(
			"src/Net/Http@client.luau",
			"src/Net/Http.spec.luau",
			"src/Util.luau"
		);

		const result = await run({
			_: [
				"src/Net/Http@client.luau",
				"src/Net/Http.spec.luau",
				"src/Util.luau",
				"src/Combat/Server/Hit.luau",
			],
		});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual([
			"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Net/Http · route Client (suffix)",
			"src/Net/Http.spec.luau -> ignored · matches **/*.spec.luau",
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder) · the file does not exist yet",
		]);
	});

	describe("a file in no source path", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Util.luau", "lib/x.luau");
		});

		it("should keep its outside line and say Rogen leaves it out", async () => {
			const result = await run({ _: ["lib/x.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"lib/x.luau -> outside the source paths",
			]);
			expect(logService.texts("notice")).toEqual([
				"note: lib/x.luau: in no source path of default.rogen.json, so Rogen leaves it out of the project file.",
			]);
		});

		it("should list it under skipped in the JSON document", async () => {
			await run({ _: ["lib/x.luau", "src/Util.luau"], json: true });

			expect(JSON.parse(printed().join("\n")).skipped).toEqual([
				{
					path: "/repo/lib/x.luau",
					reason: "outsideSourcePaths",
					config: "default.rogen.json",
				},
			]);
		});

		it("should not list a path some write reads", async () => {
			await run({ _: ["src/Util.luau"], json: true });

			expect(JSON.parse(printed().join("\n"))).not.toHaveProperty(
				"skipped"
			);
		});
	});

	describe("a project file that is out of date", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Util.luau");
			await fs.writeFile("/repo/default.project.json", "{}");
		});

		it("should not be said with a path", async () => {
			const result = await run({ _: ["src/Util.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			]);
			expect(logService.texts("diagnosticWarning")).toEqual([]);
		});

		it("should not be said with no path", async () => {
			await run({ _: [] });

			expect(logService.texts("diagnosticWarning")).toEqual([]);
		});

		it("should not be in the JSON document", async () => {
			await run({ _: ["src/Util.luau"], json: true });

			expect(JSON.parse(printed().join("\n")).diagnostics).toEqual([]);
		});
	});

	it("should say a file that is no instance is not one", async () => {
		await writeConfig("default.rogen.json", { rogen: { routes: ROUTES } });
		await write("src/Notes.md");

		await run({ _: ["src/Notes.md"] });

		expect(printed()).toEqual(["src/Notes.md -> not an instance"]);
	});

	describe("when an error elsewhere stops the build", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: {
					routes: { shared: "ReplicatedStorage/Shared", ...ROUTES },
				},
			});
			await write(
				"src/F/Shared/Good.luau",
				"src/F/Shared/Bad@server.luau"
			);
		});

		it("should say what stops it, and still succeed", async () => {
			const result = await run({ _: ["src/F/Shared/Good.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"src/F/Shared/Good.luau -> not placed · the write stops on src/F/Shared/Bad@server.luau (route.ignoredAt); run 'rogen check'",
			]);
		});

		it("should name the file with the error when the error is inside the directory asked about", async () => {
			await run({ _: ["src/F"] });

			expect(printed()).toContain(
				"src/F -> not placed · src/F/Shared/Bad@server.luau has an error (route.ignoredAt)"
			);
		});

		it("should name the error in the JSON document", async () => {
			await run({ _: ["src/F/Shared/Good.luau"], json: true });

			expect(JSON.parse(printed().join("\n")).locations[0]).toMatchObject(
				{
					status: "blocked",
					blockedBy: {
						file: "/repo/src/F/Shared/Bad@server.luau",
						code: "route.ignoredAt",
					},
				}
			);
		});
	});

	it("should show the misspelt folder a named file lies in, but not under a directory's files", async () => {
		await writeConfig("default.rogen.json", { rogen: { routes: ROUTES } });
		await write("src/F/Sever/A.luau");

		await run({ _: ["src/F/Sever/A.luau"] });
		const named = printed();
		logService.clear();
		await run({ _: ["src/F"] });

		expect(named.join("\n")).toContain("route.folderTypo");
		expect(printed().join("\n")).not.toContain("route.folderTypo");
	});

	it("should read an argument as a path when the working directory holds a folder named after its service", async () => {
		await writeConfig("default.rogen.json", {
			rogen: {
				sourcePaths: ["."],
				routes: { ...ROUTES, ReplicatedFirst: "ReplicatedFirst" },
			},
		});
		await write("ReplicatedFirst/Boot.client.luau");

		await run({ _: ["ReplicatedFirst/Boot.client.luau"] });

		expect(printed()).toEqual([
			"ReplicatedFirst/Boot.client.luau -> ReplicatedFirst/Boot · route ReplicatedFirst (folder)",
		]);
	});

	it("should print every file in the tree when given no path", async () => {
		await writeConfig("default.rogen.json", { rogen: { routes: ROUTES } });
		await write("src/B.luau", "src/A/Server/C.luau");

		await run({});

		expect(printed()).toEqual([
			"src/A/Server/C.luau -> ServerScriptService/A/C · route Server (folder)",
			"src/B.luau -> ReplicatedStorage/Shared/B · route * (fallback)",
		]);
	});

	it("should say there are no files rather than print nothing", async () => {
		await writeConfig("default.rogen.json", { rogen: { routes: ROUTES } });
		await fs.createDirectory("/repo/src");

		const result = await run({});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual(["No files in the source paths (src)."]);
	});

	it("should fail with the config's errors", async () => {
		await writeConfig("default.rogen.json", {
			extends: "base",
			rogen: { routes: ROUTES },
		});

		const result = await run({ _: ["src/A.luau"] });

		expect(result.isErr()).toBe(true);
		expect(printed()).toEqual([]);
	});

	it.each([
		[
			"a file that doesn't exist yet",
			"src\\Combat\\Hit.luau",
			"src/Combat/Hit.luau",
		],
		["a folder", "src\\", "src/"],
		[
			"a path through ..",
			"src\\Combat\\..\\A.luau",
			"src/Combat/../A.luau",
		],
	])(
		"should read a backslash as a separator, so %s answers as with slashes",
		async (_, backslashed, slashed) => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/A.luau");

			await run({ _: [slashed] });
			const expected = printed();
			logService.clear();
			await run({ _: [backslashed] });

			expect(printed()).toEqual(expected);
		}
	);

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
				"places/shared/src/Common/Util.luau",
				"places/lobby/src/Server/Only.luau",
				"places/arena/src/Server/Main.luau"
			);
		});

		it("should answer a file of a place from the root, by the config of that place", async () => {
			const result = await run({
				_: ["places/lobby/src/Server/Only.luau"],
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"places/lobby/src/Server/Only.luau -> ServerScriptService/Only · route Server (folder)",
			]);
		});

		it("should answer files of two places, each by its own config, in the order given", async () => {
			const result = await run({
				_: [
					"places/arena/src/Server/Main.luau",
					"places/lobby/src/Server/Only.luau",
				],
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"places/arena/default.rogen.json: places/arena/src/Server/Main.luau -> ServerScriptService/Main · route Server (folder)",
				"places/lobby/default.rogen.json: places/lobby/src/Server/Only.luau -> ServerScriptService/Only · route Server (folder)",
			]);
		});

		it("should skip a file that no config covers with a note, and succeed", async () => {
			const result = await run({
				_: ["places/shared/src/Common/Util.luau"],
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([]);
			expect(logService.texts("warn")).toEqual([]);
			expect(logService.texts("notice")).toEqual([
				"note: places/shared/src/Common/Util.luau: no config at or above it reads it.",
			]);
		});

		it("should name the named configs of the working folder as the way to see where it lands", async () => {
			await writeConfig("game.rogen.json", {
				name: "game",
				rogen: { routes: ROUTES },
			});

			await run({ _: ["places/shared/src/Common/Util.luau"] });

			expect(logService.texts("notice")).toEqual([
				"note: places/shared/src/Common/Util.luau: no config at or above it reads it. See where it lands through one: rogen where game.rogen.json.",
			]);
		});

		it("should list a file that no config covers under skipped in the JSON document", async () => {
			await run({
				_: ["places/shared/src/Common/Util.luau"],
				json: true,
			});

			expect(JSON.parse(printed().join("\n"))).toMatchObject({
				skipped: [
					{
						path: "/repo/places/shared/src/Common/Util.luau",
						reason: "noConfig",
					},
				],
			});
		});

		it("should answer the files it can and skip the one it can't", async () => {
			const result = await run({
				_: [
					"places/shared/src/Common/Util.luau",
					"places/lobby/src/Server/Only.luau",
				],
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"places/lobby/src/Server/Only.luau -> ServerScriptService/Only · route Server (folder)",
			]);
			expect(logService.texts("notice")).toHaveLength(1);
		});

		it("should list every file of a config named by its file", async () => {
			const result = await run({
				_: ["places/lobby/default.rogen.json"],
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"places/lobby/src/Server/Only.luau -> ServerScriptService/Only · route Server (folder)",
				"places/shared/src/Common/Util.luau -> ReplicatedStorage/Shared/Common/Util · route * (fallback)",
			]);
		});

		it("should fail at the root with no path, where no config is", async () => {
			const result = await run({});

			expect(result.isErr()).toBe(true);
			expect((result as { error: Error }).error.message).toContain(
				"No default.rogen.json or default.project.json in this folder"
			);
		});

		it("should read the place's config for a bare instance from the place's folder", async () => {
			const harness = commandHarness({ fs, cwd: "/repo/places/lobby" });

			const result = await harness.run("where", {
				positionals: ["ServerScriptService.Only"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(harness.log.texts("print")).toEqual([
				"src/Server/Only.luau -> ServerScriptService/Only · route Server (folder)",
			]);
		});
	});

	describe("with root-level places", () => {
		beforeEach(async () => {
			for (const place of ["game", "lobby"])
				await writeConfig(`${place}.rogen.json`, {
					name: place,
					rogen: {
						sourcePaths: ["src/common", `src/${place}`],
						routes: ROUTES,
					},
				});
			await write(
				"src/common/Util.luau",
				"src/game/Server/Main.luau",
				"src/lobby/Server/Main.luau"
			);
		});

		it("should answer a file of a place by the config that holds it", async () => {
			const result = await run({ _: ["src/game/Server/Main.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"src/game/Server/Main.luau -> ServerScriptService/Main · route Server (folder)",
			]);
		});

		it("should list every file of a config named by its bare name", async () => {
			const byName = await run({ _: ["game"] });
			const named = printed();
			logService.clear();
			const byFile = await run({ _: ["game.rogen.json"] });

			expect(byName.isOk()).toBe(true);
			expect(byFile.isOk()).toBe(true);
			expect(named).toEqual(printed());
			expect(named).toEqual(
				expect.arrayContaining([
					expect.stringContaining("src/common/Util.luau"),
					expect.stringContaining("src/game/Server/Main.luau"),
				])
			);
			expect(named.join("\n")).not.toContain("src/lobby");
		});

		it("should still place a file that no config is named for", async () => {
			const result = await run({ _: ["src/game/Server/New.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"src/game/Server/New.luau -> ServerScriptService/New · route Server (folder) · the file does not exist yet",
			]);
		});

		it("should print a shared file once when every config places it alike", async () => {
			const result = await run({ _: ["src/common/Util.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([
				"src/common/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			]);
		});

		it("should head a shared file's line with each config that places it apart", async () => {
			await writeConfig("lobby.rogen.json", {
				name: "lobby",
				rogen: {
					sourcePaths: ["src/common", "src/lobby"],
					routes: { "*": "ReplicatedFirst" },
				},
			});

			await run({ _: ["src/common/Util.luau"] });

			expect(printed()).toEqual([
				"game.rogen.json: src/common/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
				"lobby.rogen.json: src/common/Util.luau -> ReplicatedFirst/Util · route * (fallback)",
			]);
		});

		it("should give one entry per config for a shared file in the JSON document", async () => {
			await run({ _: ["src/common/Util.luau"], json: true });

			const { locations } = JSON.parse(printed().join("\n")) as {
				locations: { config: string; source: string }[];
			};
			expect(
				locations.map(({ config, source }) => [config, source])
			).toEqual([
				["game.rogen.json", "/repo/src/common/Util.luau"],
				["lobby.rogen.json", "/repo/src/common/Util.luau"],
			]);
		});

		it("should skip a file that no config holds with a note, and succeed", async () => {
			const result = await run({ _: ["tools/Run.luau"] });

			expect(result.isOk()).toBe(true);
			expect(printed()).toEqual([]);
			expect(logService.texts("notice")).toHaveLength(1);
		});

		it("should answer for every config of the folder with no path", async () => {
			const result = await run({});

			expect(result.isOk()).toBe(true);
			const lines = printed();
			expect(lines.filter((l) => l.includes("src/game"))).toHaveLength(1);
			expect(lines.filter((l) => l.includes("src/lobby"))).toHaveLength(
				1
			);
			expect(lines.filter((l) => l.includes("src/common"))).toHaveLength(
				1
			);
		});
	});

	describe("the require of a named file", () => {
		const notes = () => logService.texts("note");

		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
		});

		it("should print a module's require as a note under its line", async () => {
			await write("src/Util.luau");

			await run({ _: ["src/Util.luau"] });

			expect(
				logService.entries.map(({ kind, text }) => [kind, text])
			).toEqual([
				["print", expect.stringContaining("src/Util.luau ->")],
				[
					"note",
					'  require(game:GetService("ReplicatedStorage").Shared.Util)',
				],
			]);
		});

		it("should print a listing's requires under --verbose, as debug lines", async () => {
			await write(
				"src/Util.luau",
				"src/Inventory/Server/Hit.server.luau"
			);
			logService.setLevel(LogLevel.Debug);

			await run({ _: ["src"], verbose: [true] });

			expect(
				logService.entries
					.filter(({ kind }) => kind === "print" || kind === "debug")
					.map(({ kind, text }) => [kind, text])
			).toEqual([
				[
					"print",
					expect.stringContaining(
						"src/Inventory/Server/Hit.server.luau ->"
					),
				],
				["print", expect.stringContaining("src/Util.luau ->")],
				[
					"debug",
					'require: game:GetService("ReplicatedStorage").Shared.Util',
				],
			]);
			expect(notes()).toEqual([]);
		});

		it("should not print the expression of a listing without --verbose", async () => {
			await write("src/Util.luau");

			await run({ _: ["src"] });

			expect(
				logService.entries.filter(({ kind }) => kind === "debug")
			).toEqual([]);
		});

		it("should not repeat a named file's require as a debug line under --verbose", async () => {
			await write("src/Util.luau");
			logService.setLevel(LogLevel.Debug);

			await run({ _: ["src/Util.luau"], verbose: [true] });

			expect(notes()).toHaveLength(1);
			expect(
				logService.entries.filter(({ kind }) => kind === "debug")
			).toEqual([]);
		});
	});

	describe("with --json", () => {
		const document = () =>
			(
				JSON.parse(printed().join("\n")) as {
					locations: Record<string, unknown>[];
				}
			).locations;

		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				globIgnorePaths: ["**/*.spec.luau"],
				rogen: { routes: ROUTES },
			});
			await write(
				"src/Inventory/Server/Save.luau",
				"src/Net/Http.spec.luau"
			);
		});

		it("should print one JSON document with an entry per path", async () => {
			const result = await run({
				_: [
					"src/Inventory/Server/Save.luau",
					"src/Net/Http.spec.luau",
					"src/Nowhere.luau",
				],
				json: true,
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).not.toEqual([]);
			expect(document()).toEqual([
				{
					config: "default.rogen.json",
					source: "/repo/src/Inventory/Server/Save.luau",
					status: "placed",
					exists: true,
					instancePath: ["ServerScriptService", "Inventory", "Save"],
					require:
						'game:GetService("ServerScriptService").Inventory.Save',
					route: "Server",
					routeMatch: "folder",
					diagnostics: [],
				},
				{
					config: "default.rogen.json",
					source: "/repo/src/Net/Http.spec.luau",
					status: "ignored",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
					diagnostics: [],
				},
				{
					config: "default.rogen.json",
					source: "/repo/src/Nowhere.luau",
					status: "placed",
					exists: false,
					instancePath: ["ReplicatedStorage", "Shared", "Nowhere"],
					require:
						'game:GetService("ReplicatedStorage").Shared.Nowhere',
					route: "*",
					routeMatch: "fallback",
					diagnostics: [],
				},
			]);
		});

		it("should give the status of a file that is no instance", async () => {
			await write("src/Notes.md");

			await run({ _: ["src/Notes.md"], json: true });

			expect(document()).toMatchObject([
				{ source: "/repo/src/Notes.md", status: "notInstance" },
			]);
		});

		it("should print nothing but the document, however loud the log level", async () => {
			await run({ json: true, verbose: [true] });

			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should print the errors of a config that doesn't load", async () => {
			await writeConfig("default.rogen.json", {
				extends: "base",
				rogen: { routes: ROUTES },
			});

			const result = await run({
				_: ["src/Inventory/Server/Save.luau"],
				json: true,
			});

			expect(result.isErr()).toBe(true);
			const { locations, diagnostics } = JSON.parse(
				printed().join("\n")
			) as { locations: { config: string }[]; diagnostics: unknown[] };
			expect(locations).toEqual([]);
			expect(diagnostics).toMatchObject([
				{
					file: "/repo/default.rogen.json",
					code: "config.removedField",
				},
			]);
		});
	});

	describe("reading text on stdin", () => {
		const pipe = async (text: string, ...more: string[]) => {
			const harness = commandHarness({
				fs,
				input: new MockInputService(text),
			});
			logService = harness.log;
			return harness.run("where", {
				positionals: ["-", ...more],
				options: {},
			});
		};

		const text = () => logService.texts("print").join("\n");

		const writeJson = (file: string, value: Record<string, unknown>) =>
			fs.writeFile(`/repo/${file}`, JSON.stringify(value));

		it("should write both forms Studio prints as file:line and leave the other text as it is", async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Inventory/Server/Save.luau");

			const result = await pipe(
				[
					"12:30:01 Output",
					"ServerScriptService.Inventory.Save:12: attempt to index nil",
					"Stack Begin",
					"Script 'ServerScriptService.Inventory.Save', Line 7 - function save",
					"Stack End",
					"",
				].join("\n")
			);

			expect(result.isOk()).toBe(true);
			expect(text()).toBe(
				[
					"12:30:01 Output",
					"src/Inventory/Server/Save.luau:12: attempt to index nil",
					"Stack Begin",
					"src/Inventory/Server/Save.luau:7 - function save",
					"Stack End",
				].join("\n")
			);
			expect(logService.texts("warn")).toEqual([]);
		});

		it("should leave an instance no file places as it is", async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Inventory/Server/Save.luau");

			await pipe("ServerScriptService.Other.Thing:3: boom");

			expect(text()).toBe("ServerScriptService.Other.Thing:3: boom");
		});

		it("should pass text through when there is nothing to rewrite, even without a config", async () => {
			const result = await pipe("hello\nworld\n");

			expect(result.isOk()).toBe(true);
			expect(text()).toBe("hello\nworld");
		});

		describe("of several places", () => {
			beforeEach(async () => {
				for (const place of ["lobby", "arena"])
					await writeJson(`places/${place}/default.rogen.json`, {
						name: place,
						rogen: {
							sourcePaths: ["../shared/src", "src"],
							routes: ROUTES,
						},
					});
				await write(
					"places/shared/src/Common/Util.luau",
					"places/lobby/src/Server/Only.luau",
					"places/lobby/src/Server/Main.luau",
					"places/arena/src/Server/Main.luau"
				);
			});

			const pipeIn = (cwd: string, text: string) => {
				const harness = commandHarness({
					fs,
					cwd,
					input: new MockInputService(text),
				});
				logService = harness.log;
				return harness.run("where", {
					positionals: ["-"],
					options: {},
				});
			};

			it("should print the text as it is, then fail, at the root, which no config is at", async () => {
				const result = await pipe("ServerScriptService.Only:5: b");

				expect(result.isErr()).toBe(true);
				expect(text()).toBe("ServerScriptService.Only:5: b");
				expect((result as { error: Error }).error.message).toContain(
					"No default.rogen.json or default.project.json in this folder"
				);
			});

			it("should rewrite what the place's own file places and what it shares from the place's folder", async () => {
				const result = await pipeIn(
					"/repo/places/lobby",
					"ReplicatedStorage.Shared.Common.Util:2: a\nServerScriptService.Only:5: b"
				);

				expect(result.isOk()).toBe(true);
				expect(text()).toBe(
					"../shared/src/Common/Util.luau:2: a\nsrc/Server/Only.luau:5: b"
				);
			});
		});

		it("should keep a Windows line ending and print nothing for empty input", async () => {
			await writeConfig("default.rogen.json", {
				rogen: { routes: ROUTES },
			});
			await write("src/Inventory/Server/Save.luau");

			await pipe("a\r\nServerScriptService.Inventory.Save:1\r\n");
			expect(text()).toBe("a\r\nsrc/Inventory/Server/Save.luau:1");

			logService.clear();
			await pipe("");
			expect(logService.texts("print")).toEqual([]);
		});

		it("should print the text as it is, then fail, when no config can answer", async () => {
			const result = await pipe(
				"ServerScriptService.Inventory.Save:12: x"
			);

			expect(result.isErr()).toBe(true);
			expect(text()).toBe("ServerScriptService.Inventory.Save:12: x");
		});

		it("should fail for - when stdin is a terminal", async () => {
			const harness = commandHarness({
				fs,
				input: new MockInputService("", true),
			});
			const result = await harness.run("where", {
				positionals: ["-"],
				options: {},
			});

			expect(result.isErr()).toBe(true);
			expect((result as { error: Error }).error).toBeInstanceOf(
				UsageError
			);
		});

		describe("when the line is wrong", () => {
			it("should fail for - beside another argument", async () => {
				const result = await pipe("", "src");

				expect(result.isErr()).toBe(true);
				expect((result as { error: Error }).error).toBeInstanceOf(
					UsageError
				);
			});

			it("should fail for - with --json", async () => {
				const harness = commandHarness({ fs });
				const result = await harness.run("where", {
					positionals: ["-"],
					options: { json: true },
				});

				expect(result.isErr()).toBe(true);
				expect((result as { error: Error }).error).toBeInstanceOf(
					UsageError
				);
			});
		});
	});
});
