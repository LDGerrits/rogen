import "../where-command.js";
import { Result } from "../../../base/result.js";
import { BuildService } from "../../../domain/build/build-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogLevel, LogService } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { buildServiceOf } from "../../../domain/build/__tests__/fixtures.js";
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
		logService.entries
			.filter(({ kind }) => kind === "print")
			.flatMap(({ text }) => text.split("\n"));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		logService = new MockLogService();
		const environment = new MockEnvironmentService("/repo");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(FileSystemService, fs);
		services.set(EnvironmentService, environment);
		const indexService = new CoreIndexService(fs);
		services.set(IndexService, indexService);
		services.set(BuildService, buildServiceOf(fs, indexService));
		const configService = new CoreConfigService(fs, environment);
		services.set(ConfigService, configService);
		const commandService = new CoreCommandService(services, logService);
		run = async ({ _ = [], ...options }) =>
			commandService.executeCommand("where", {
				positionals: _,
				options,
			});
	});

	it("should print where each path lands and why, relative to the working directory", async () => {
		await writeConfig("default.rogen.json", {
			routes: ROUTES,
			variants: ["mock"],
		});
		await write(
			"src/Net/Http@client.luau",
			"src/Net/Http.mock.luau",
			"src/Util.luau"
		);

		const result = await run({
			_: [
				"src/Net/Http@client.luau",
				"src/Net/Http.mock.luau",
				"src/Util.luau",
				"src/Combat/Server/Hit.luau",
			],
		});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual([
			"src/Net/Http@client.luau -> StarterPlayer/StarterPlayerScripts/Net/Http · route Client (suffix)",
			"src/Net/Http.mock.luau -> pruned · variant mock is off (suffix)",
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder)",
		]);
	});

	it("should print the files behind an instance pasted from a Studio error", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write(
			"src/Inventory/Server/Save.luau",
			"src/Inventory/Types.luau"
		);

		await run({
			_: [
				"ServerScriptService.Inventory.Save:12: attempt to index nil",
				"ReplicatedStorage/Shared/Inventory",
				"Workspace.Missing",
			],
		});

		expect(printed()).toEqual([
			"src/Inventory/Server/Save.luau -> ServerScriptService/Inventory/Save · route Server (folder)",
			"src/Inventory/Types.luau -> ReplicatedStorage/Shared/Inventory/Types · route * (fallback)",
			"Workspace.Missing -> no file places it",
		]);
	});

	it("should say where a new file for an instance no file places goes", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write("src/Inventory/Server/Save.luau");

		await run({ _: ["ServerScriptService.Inventory.NewThing"] });

		expect(printed()).toEqual([
			"ServerScriptService.Inventory.NewThing -> no file places it · a new file goes in src/Inventory/Server/",
		]);
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

		it("should head only the lines that some configs lack in the whole tree, sorted", async () => {
			await run({});

			expect(printed()).toEqual([
				"lobby: places/lobby/Queue.luau -> ReplicatedStorage/Shared/Queue · route * (fallback)",
				"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			]);
		});
	});

	it("should place a file that doesn't exist yet in the init folder that holds it", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write(
			"src/Combat/Server/Moves/init.luau",
			"src/Combat/Server/Moves/Punch.luau"
		);

		await run({ _: ["src/Combat/Server/Moves"] });
		const asked = printed();
		logService.clear();
		await run({ _: ["src/Combat/Server/Moves/Sweep.luau"] });

		expect(asked).toEqual([
			"src/Combat/Server/Moves/Punch.luau -> ServerScriptService/Combat/Moves/Punch · route Server (folder)",
			"src/Combat/Server/Moves/init.luau -> ServerScriptService/Combat/Moves · route Server (folder)",
		]);
		expect(printed()).toEqual([
			"src/Combat/Server/Moves/Sweep.luau -> ServerScriptService/Combat/Moves/Sweep · route Server (folder)",
		]);
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

	it("should say there are no files rather than print nothing", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		const result = await run({});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual(["No files in the root dirs (src)."]);
	});

	it("should hint at a folder that doesn't exist when it is named with a trailing slash", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		await run({ _: ["src/Combat/"] });

		expect(printed()).toEqual([
			"src/Combat -> does not exist · name a file in it to see where it would land",
		]);
	});

	it("should hint at a folder that doesn't exist when it is named with a trailing backslash", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		await run({ _: ["src\\Combat\\"] });

		expect(printed()).toEqual([
			"src/Combat -> does not exist · name a file in it to see where it would land",
		]);
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

	it("should not hint at a folder for a missing name without a trailing slash, which may be a file missing its extension", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		await run({ _: ["src/Module"] });

		expect(printed()).toEqual(["src/Module -> does not exist"]);
	});

	describe("the require of a named file", () => {
		const notes = () =>
			logService.entries
				.filter(({ kind }) => kind === "note")
				.map(({ text }) => text);

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

		it("should write a name that isn't an identifier as an index", async () => {
			await write("src/Foo Bar.luau");

			await run({ _: ["src/Foo Bar.luau"] });

			expect(notes()).toEqual([
				'  require(game:GetService("ReplicatedStorage").Shared["Foo Bar"])',
			]);
		});

		it("should say why a module under a Starter container has none", async () => {
			await write("src/Hud/Client/Hud.luau");

			await run({ _: ["src/Hud/Client/Hud.luau"] });

			expect(notes()).toEqual([
				"  no require by this path: StarterPlayerScripts is cloned into each player",
			]);
		});

		it("should say why a script has none", async () => {
			await write("src/Inventory/Server/Hit.server.luau");

			await run({ _: ["src/Inventory/Server/Hit.server.luau"] });

			expect(notes()).toEqual([
				"  no require by this path: a script runs on its own and is not a module",
			]);
		});

		it.each(["src/Hit.ts", "src/Data.json"])(
			"should say nothing for %s",
			async (file) => {
				await write(file);

				await run({ _: [file] });

				expect(notes()).toEqual([]);
			}
		);

		it("should say nothing for a file that is not placed", async () => {
			await writeConfig("default.rogen.json", {
				routes: ROUTES,
				variants: ["mock"],
			});
			await write("src/Net/Http.mock.luau");

			await run({ _: ["src/Net/Http.mock.luau"] });

			expect(notes()).toEqual([]);
		});

		it("should say nothing for a directory, nor for a listing", async () => {
			await write("src/Util.luau");

			await run({ _: ["src"] });
			await run({ _: [] });

			expect(notes()).toEqual([]);
		});

		it("should give a file that does not exist yet the require it would have", async () => {
			await fs.createDirectory("/repo/src");

			await run({ _: ["src/New.luau"] });

			expect(notes()).toEqual([
				'  require(game:GetService("ReplicatedStorage").Shared.New)',
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

		it("should print an entry for an instance no file places", async () => {
			await run({
				_: ["ServerScriptService.Inventory.Save:3", "Workspace.Gone"],
				json: true,
			});

			expect(document()).toEqual([
				expect.objectContaining({
					source: "/repo/src/Inventory/Server/Save.luau",
					status: "placed",
				}),
				{
					config: "default",
					instance: "Workspace.Gone",
					status: "noFile",
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

		it("should print an empty list when nothing is placed", async () => {
			await fs.delete("/repo/src/Inventory/Server/Save.luau");
			await fs.delete("/repo/src/Net/Http.mock.luau");

			await run({ json: true });

			expect(document()).toEqual([]);
		});

		it("should print an entry for every config, even when they agree", async () => {
			await writeConfig("lobby.rogen.json", { routes: ROUTES });

			await run({
				_: ["src/Inventory/Server/Save.luau"],
				json: true,
				all: true,
			});

			expect(document().map(({ config }) => config)).toEqual([
				"default",
				"lobby",
			]);
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

		it("should print an empty list of diagnostics when every config loads", async () => {
			await run({ json: true });

			expect(JSON.parse(printed().join("\n")).diagnostics).toEqual([]);
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
