import "../where-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { Result } from "../../../base/result.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

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
			routes: ROUTES,
			variants: ["mock"],
		});
		await write(
			"src/Net/Http@client.luau",
			"src/Net/Http.mock@client.luau",
			"src/Util.luau"
		);

		const result = await run({
			_: [
				"src/Net/Http@client.luau",
				"src/Net/Http.mock@client.luau",
				"src/Util.luau",
				"src/Combat/Server/Hit.luau",
			],
		});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual([
			"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Net/Http · route Client (suffix)",
			"src/Net/Http.mock@client.luau -> pruned · variant mock is off (suffix)",
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder)",
		]);
	});

	describe("when an error elsewhere stops the build", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", {
				routes: { shared: "ReplicatedStorage/Shared", ...ROUTES },
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
				"src/F/Shared/Good.luau -> not placed · the build stops on src/F/Shared/Bad@server.luau (route.ignoredAt); run 'rogen check'",
			]);
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
		await writeConfig("default.rogen.json", { routes: ROUTES });
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
			rootDirs: ["."],
			routes: { ...ROUTES, ReplicatedFirst: "ReplicatedFirst" },
		});
		await write("ReplicatedFirst/Boot.client.luau");

		await run({ _: ["ReplicatedFirst/Boot.client.luau"] });

		expect(printed()).toEqual([
			"ReplicatedFirst/Boot.client.luau -> ReplicatedFirst/Boot · route ReplicatedFirst (folder)",
		]);
	});

	it("should print every file in the tree when given no path", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write("src/B.luau", "src/A/Server/C.luau");

		await run({});

		expect(printed()).toEqual([
			"src/A/Server/C.luau -> ServerScriptService/A/C · route Server (folder)",
			"src/B.luau -> ReplicatedStorage/Shared/B · route * (fallback)",
		]);
	});

	it("should say there are no files rather than print nothing", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		const result = await run({});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual(["No files in the root dirs (src)."]);
	});

	it("should read every config here, with variant flags applied", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await writeConfig("mocked.rogen.json", {
			routes: ROUTES,
			variants: ["mock"],
		});
		await write("src/Http.mock.luau");

		await run({ _: ["src/Http.mock.luau"], variant: ["mock"] });

		expect(printed()).toEqual([
			"default: src/Http.mock.luau -> ReplicatedStorage/Shared/Http.mock · route * (fallback)",
			"mocked: src/Http.mock.luau -> ReplicatedStorage/Shared/Http · route * (fallback) · variant mock (suffix)",
		]);
	});

	describe("with several configs", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
			await writeConfig("lobby.rogen.json", {
				routes: ROUTES,
				rootDirs: ["src", "places/lobby"],
			});
			await write("src/Util.luau", "places/lobby/Queue.luau");
		});

		it("should print a line once when the configs agree, and only the placing config's line for a place's file", async () => {
			await run({
				_: ["src/Util.luau", "places/lobby/Queue.luau", "README.md"],
			});

			expect(printed()).toEqual([
				"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
				"lobby: places/lobby/Queue.luau -> ReplicatedStorage/Shared/Queue · route * (fallback)",
				"README.md -> outside the root dirs",
			]);
		});
	});

	it("should fail with the config's errors", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES, bogus: 1 });

		const result = await run({ _: ["src/A.luau"] });

		expect(result.isErr()).toBe(true);
		expect(printed()).toEqual([]);
	});

	it("should print the answers, then the errors of a config that doesn't load, and fail", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await writeConfig("broken.rogen.json", { routes: ROUTES, bogus: 1 });
		await write("src/Util.luau");

		const result = await run({ _: ["src/Util.luau"] });

		expect(printed()).toEqual([
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
		]);
		expect(result.isErr() && result.error.message).toContain(
			"/repo/broken.rogen.json:1:"
		);
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
			await writeConfig("default.rogen.json", { routes: ROUTES });
			await write("src/A.luau");

			await run({ _: [slashed] });
			const expected = printed();
			logService.clear();
			await run({ _: [backslashed] });

			expect(printed()).toEqual(expected);
		}
	);

	describe("the require of a named file", () => {
		const notes = () => logService.texts("note");

		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
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

			await run({ _: ["src"], verbose: true });

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

			await run({ _: ["src/Util.luau"], verbose: true });

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
				routes: ROUTES,
				variants: ["mock"],
			});
			await write(
				"src/Inventory/Server/Save.luau",
				"src/Net/Http.mock.luau"
			);
		});

		it("should print one JSON document with an entry per path", async () => {
			const result = await run({
				_: [
					"src/Inventory/Server/Save.luau",
					"src/Net/Http.mock.luau",
					"src/Nowhere.luau",
				],
				json: true,
			});

			expect(result.isOk()).toBe(true);
			expect(printed()).not.toEqual([]);
			expect(document()).toEqual([
				{
					config: "default",
					source: "/repo/src/Inventory/Server/Save.luau",
					status: "placed",
					exists: true,
					instancePath: ["ServerScriptService", "Inventory", "Save"],
					require:
						'game:GetService("ServerScriptService").Inventory.Save',
					route: "Server",
					routeMatch: "folder",
					variants: [],
					diagnostics: [],
				},
				{
					config: "default",
					source: "/repo/src/Net/Http.mock.luau",
					status: "pruned",
					exists: true,
					variants: [{ variant: "mock", form: "suffix" }],
					diagnostics: [],
				},
				{
					config: "default",
					source: "/repo/src/Nowhere.luau",
					status: "placed",
					exists: false,
					instancePath: ["ReplicatedStorage", "Shared", "Nowhere"],
					require:
						'game:GetService("ReplicatedStorage").Shared.Nowhere',
					route: "*",
					routeMatch: "fallback",
					variants: [],
					diagnostics: [],
				},
			]);
		});

		it("should print nothing but the document, however loud the log level", async () => {
			await run({ json: true, verbose: true });

			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should answer from the configs that load and print the errors of one that doesn't", async () => {
			await writeConfig("broken.rogen.json", {
				routes: ROUTES,
				bogus: 1,
			});

			const result = await run({
				_: ["src/Inventory/Server/Save.luau"],
				json: true,
			});

			expect(result.isErr()).toBe(true);
			const { locations, diagnostics } = JSON.parse(
				printed().join("\n")
			) as { locations: { config: string }[]; diagnostics: unknown[] };
			expect(locations.map(({ config }) => config)).toEqual(["default"]);
			expect(diagnostics).toMatchObject([
				{
					file: "/repo/broken.rogen.json",
					code: "config.unknownField",
				},
			]);
		});
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should accept the variant flags, but not the output overrides", () => {
			expect(
				parse(
					"where",
					"src",
					"--variant",
					"mock",
					"--no-variant",
					"dev"
				).isOk()
			).toBe(true);
			expect(parse("where", "--json").isOk()).toBe(true);
			expect(parse("where", "-o", "out.project.json").isErr()).toBe(true);
			expect(parse("where", "-c", "a.rogen.json").isErr()).toBe(true);
		});
	});
});
