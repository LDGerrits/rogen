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
		await writeConfig("rogen.json", {
			routes: ROUTES,
			globIgnorePaths: ["**/*.spec.luau"],
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
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder)",
		]);
	});

	it("should say a file that is no instance is not one", async () => {
		await writeConfig("rogen.json", { routes: ROUTES });
		await write("src/Notes.md");

		await run({ _: ["src/Notes.md"] });

		expect(printed()).toEqual(["src/Notes.md -> not an instance"]);
	});

	describe("when an error elsewhere stops the build", () => {
		beforeEach(async () => {
			await writeConfig("rogen.json", {
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
		await writeConfig("rogen.json", { routes: ROUTES });
		await write("src/F/Sever/A.luau");

		await run({ _: ["src/F/Sever/A.luau"] });
		const named = printed();
		logService.clear();
		await run({ _: ["src/F"] });

		expect(named.join("\n")).toContain("route.folderTypo");
		expect(printed().join("\n")).not.toContain("route.folderTypo");
	});

	it("should read an argument as a path when the working directory holds a folder named after its service", async () => {
		await writeConfig("rogen.json", {
			sourcePaths: ["."],
			routes: { ...ROUTES, ReplicatedFirst: "ReplicatedFirst" },
		});
		await write("ReplicatedFirst/Boot.client.luau");

		await run({ _: ["ReplicatedFirst/Boot.client.luau"] });

		expect(printed()).toEqual([
			"ReplicatedFirst/Boot.client.luau -> ReplicatedFirst/Boot · route ReplicatedFirst (folder)",
		]);
	});

	it("should print every file in the tree when given no path", async () => {
		await writeConfig("rogen.json", { routes: ROUTES });
		await write("src/B.luau", "src/A/Server/C.luau");

		await run({});

		expect(printed()).toEqual([
			"src/A/Server/C.luau -> ServerScriptService/A/C · route Server (folder)",
			"src/B.luau -> ReplicatedStorage/Shared/B · route * (fallback)",
		]);
	});

	it("should say there are no files rather than print nothing", async () => {
		await writeConfig("rogen.json", { routes: ROUTES });
		await fs.createDirectory("/repo/src");

		const result = await run({});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual(["No files in the source paths (src)."]);
	});

	it("should fail with the config's errors", async () => {
		await writeConfig("rogen.json", { routes: ROUTES, extends: "base" });

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
			await writeConfig("rogen.json", { routes: ROUTES });
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
			await writeConfig("rogen.json", { routes: ROUTES });
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
			await writeConfig("rogen.json", {
				routes: ROUTES,
				globIgnorePaths: ["**/*.spec.luau"],
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
					config: "repo",
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
					config: "repo",
					source: "/repo/src/Net/Http.spec.luau",
					status: "ignored",
					exists: true,
					pattern: "/repo/**/*.spec.luau",
					diagnostics: [],
				},
				{
					config: "repo",
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
			await writeConfig("rogen.json", {
				routes: ROUTES,
				extends: "base",
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
					file: "/repo/rogen.json",
					code: "config.removedField",
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

		it("should accept paths and --json, but not the output overrides", () => {
			expect(parse("where", "src", "--json").isOk()).toBe(true);
			expect(parse("where", "--variant", "mock").isErr()).toBe(true);
			expect(parse("where", "-o", "out.project.json").isErr()).toBe(true);
			expect(parse("where", "-c", "a.rogen.json").isErr()).toBe(true);
			expect(parse("where", "--out-file", "a.project.json").isErr()).toBe(
				true
			);
		});
	});
});
