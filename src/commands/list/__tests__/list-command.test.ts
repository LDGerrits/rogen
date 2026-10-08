import "../list-command.js";
import { Result, ResultError } from "../../../base/result.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import { ReportedError } from "../../../base/errors.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

describe("list command", () => {
	let fs: MemoryFileSystemService;
	let logService: MockLogService;
	let run: (
		options?: CommandLine["options"] & { _?: string[] }
	) => Promise<Result<void, Error>>;

	const write = (file: string, config: Record<string, unknown> | string) =>
		fs.writeFile(
			`/repo/${file}`,
			typeof config === "string" ? config : JSON.stringify(config)
		);

	const steps = () =>
		logService.entries
			.filter(({ kind }) => kind === "step")
			.map(({ text }) => text);

	const under = (step: string) => {
		const entries = logService.entries;
		const start = entries.findIndex(
			({ kind, text }) => kind === "step" && text === step
		);
		const next = entries.findIndex(
			({ kind }, index) =>
				index > start && (kind === "step" || kind === "outro")
		);
		const end = next === -1 ? entries.length : next;
		return entries.slice(start + 1, end).map(({ text }) => text);
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		logService = new MockLogService();
		const environment = new MockEnvironmentService("/repo");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(FileSystemService, fs);
		services.set(EnvironmentService, environment);
		services.set(ConfigService, new CoreConfigService(fs, environment));
		const commandService = new CoreCommandService(services, logService);
		run = ({ _ = [], ...options } = {}) =>
			commandService.executeCommand("list", {
				positionals: _,
				options,
			});
	});

	it("should show a config's root dirs, sync dir, project file and every variant with its state", async () => {
		await write("default.rogen.json", {
			rootDirs: ["src", "lobby"],
			syncDir: "out",
			variants: ["mock", "dev", "prod"],
		});

		const result = await run({ variant: ["mock", "prod"] });

		expect(result.isOk()).toBe(true);
		expect(steps()).toEqual(["default.rogen.json"]);
		expect(under("default.rogen.json")).toEqual([
			[
				"root dirs: src, lobby",
				"sync dir: out",
				"project file: default.project.json",
				"variants: mock on, dev off, prod on",
			].join("\n"),
		]);
	});

	it("should say so when there is no sync dir and no variant", async () => {
		await write("default.rogen.json", {});

		await run();

		const [details] = under("default.rogen.json");
		expect(details).toContain("sync dir: (none)");
		expect(details).toContain("variants: (none)");
	});

	it("should show the extends chain of a config", async () => {
		await write("root.rogen.json", {});
		await write("base.rogen.json", { extends: "root.rogen.json" });
		await write("default.rogen.json", { extends: "base.rogen.json" });

		await run();

		expect(under("default.rogen.json")).toContain(
			"extends: base.rogen.json -> root.rogen.json"
		);
	});

	it("should list every config here, in name order", async () => {
		await write("lobby.rogen.json", {});
		await write("default.rogen.json", {});
		await write("notes.json", {});

		await run();

		expect(steps()).toEqual(["default.rogen.json", "lobby.rogen.json"]);
	});

	it("should report a broken config in place, print the rest and fail", async () => {
		await write("a.rogen.json", {});
		await write("b.rogen.json", `{\n\t"bogus": 1\n}`);
		await write("c.rogen.json", {});

		const result = await run();

		expect(steps()).toEqual([
			"a.rogen.json",
			"b.rogen.json",
			"c.rogen.json",
		]);
		expect(under("b.rogen.json")).toEqual([
			expect.stringContaining("/repo/b.rogen.json:2:2 - error:"),
		]);
		expect(result.isErr()).toBe(true);
	});

	it("should still show the extends chain of a broken config", async () => {
		await write("base.rogen.json", { bogus: 1 });
		await write("broken.rogen.json", { extends: "base.rogen.json" });

		await run();

		const lines = under("broken.rogen.json");
		expect(lines).toContain("extends: base.rogen.json");
		expect(lines.join("\n")).toContain("error:");
	});

	it("should fail when there is no config here", async () => {
		const result = await run();

		expect((result as ResultError<Error>).error.message).toContain(
			"No *.rogen.json found"
		);
	});

	it("should list only the named configs", async () => {
		await write("default.rogen.json", {});
		await write("lobby.rogen.json", {});
		await write("match.rogen.json", {});

		await run({ _: ["lobby", "match"] });

		expect(steps()).toEqual(["lobby.rogen.json", "match.rogen.json"]);
	});

	it("should list the config at an explicit path", async () => {
		await write("default.rogen.json", {});
		await write("places/lobby.rogen.json", {});

		await run({ _: ["places/lobby.rogen.json"] });

		expect(steps()).toEqual(["places/lobby.rogen.json"]);
	});

	it("should show each variant's state once variant flags are applied", async () => {
		await write("default.rogen.json", {
			variants: ["mock", "fake"],
			mode: "dev",
			modes: { dev: { variants: ["mock"] } },
		});

		await run({ variant: ["fake"], "no-variant": ["mock"] });

		expect(under("default.rogen.json")).toEqual([
			expect.stringContaining("variants: mock off, fake on"),
		]);
	});

	it("should show the mode a config builds in and every mode it declares", async () => {
		await write("default.rogen.json", {
			variants: ["mock"],
			mode: "dev",
			modes: { dev: { variants: ["mock"] }, qa: {}, prod: {} },
		});

		await run({});

		expect(under("default.rogen.json")).toEqual([
			expect.stringContaining("variants: mock on"),
		]);
		expect(under("default.rogen.json")[0]).toContain(
			["mode: dev", "modes: dev, qa, prod"].join("\n")
		);
	});

	it("should show the mode a flag picks in place of the config's", async () => {
		await write("default.rogen.json", {
			mode: "dev",
			modes: { dev: {}, prod: {} },
		});

		await run({ mode: "prod" });

		expect(under("default.rogen.json")[0]).toContain(
			["mode: prod", "modes: dev, prod"].join("\n")
		);
	});

	it("should list the conflict groups a config declares", async () => {
		await write("default.rogen.json", {
			variants: ["halloween", "christmas", "debug"],
			conflicts: [["halloween", "christmas"]],
		});

		await run({});

		expect(under("default.rogen.json")[0]).toContain(
			"conflicts: halloween | christmas"
		);
	});

	it("should leave modes off a config that declares none", async () => {
		await write("default.rogen.json", {});

		await run({});

		expect(under("default.rogen.json")).toEqual([
			expect.not.stringContaining("modes:"),
		]);
		expect(under("default.rogen.json")[0]).not.toContain("conflicts:");
		expect(under("default.rogen.json")[0]).not.toContain("mode:");
	});

	describe("with --json", () => {
		const document = () =>
			JSON.parse(
				logService.entries
					.filter(({ kind }) => kind === "print")
					.map(({ text }) => text)
					.join("\n")
			) as { configs: Record<string, unknown>[] };

		const entry = (config: string) =>
			document().configs.find((candidate) => candidate.config === config);

		it("should print each config's resolved fields, identity first", async () => {
			await write("base.rogen.json", {
				routes: { Server: "ServerScriptService" },
			});
			await write("default.rogen.json", {
				extends: "base.rogen.json",
				rootDirs: ["src", "lobby"],
				routes: { "*": "ReplicatedStorage/Shared" },
				variants: ["mock"],
				exclude: ["**/*.spec.luau"],
				syncDir: "out",
			});

			const result = await run({
				_: ["default"],
				json: true,
				variant: ["mock"],
			});

			expect(result.isOk()).toBe(true);
			expect(document()).toEqual({
				configs: [
					{
						config: "default",
						file: "/repo/default.rogen.json",
						status: "valid",
						extends: ["/repo/base.rogen.json"],
						projectName: "repo",
						rootDirs: ["/repo/src", "/repo/lobby"],
						commonRoot: "/repo",
						routes: {
							Server: "ServerScriptService",
							"*": "ReplicatedStorage/Shared",
						},
						variants: { mock: true },
						conflicts: [],
						mode: null,
						modes: [],
						exclude: ["/repo/**/*.spec.luau"],
						template: null,
						syncDir: "/repo/out",
						outFile: "/repo/default.project.json",
						diagnostics: [],
					},
				],
			});
		});

		it("should print the active mode and every mode a config declares", async () => {
			await write("default.rogen.json", {
				variants: ["mock", "fake"],
				conflicts: [["mock", "fake"]],
				mode: "dev",
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["**/*.spec.luau"] },
				},
			});

			await run({ json: true, mode: "prod" });

			expect(entry("default")).toMatchObject({
				mode: "prod",
				modes: ["dev", "prod"],
				variants: { mock: false },
				exclude: ["/repo/**/*.spec.luau"],
			});
		});

		it("should print every config here when none is named", async () => {
			await write("lobby.rogen.json", {});
			await write("default.rogen.json", {});

			await run({ json: true });

			expect(document().configs.map(({ config }) => config)).toEqual([
				"default",
				"lobby",
			]);
		});

		it("should apply variant flags to the printed variants", async () => {
			await write("default.rogen.json", { variants: ["mock"] });

			await run({ json: true, variant: ["mock"] });

			expect(entry("default")?.variants).toEqual({
				mock: true,
			});
		});

		it("should print a broken config's diagnostics in place of its fields and fail without reporting again", async () => {
			await write("a.rogen.json", {});
			await write("b.rogen.json", `{\n\t"bogus": 1\n}`);

			const result = await run({ json: true });

			expect(entry("a")).toMatchObject({ status: "valid" });
			expect(entry("a")).toHaveProperty("rootDirs");
			expect(entry("b")).toEqual({
				config: "b",
				file: "/repo/b.rogen.json",
				status: "broken",
				extends: [],
				diagnostics: [
					expect.objectContaining({
						file: "/repo/b.rogen.json",
						line: 2,
						column: 2,
						severity: "error",
						code: expect.any(String),
					}),
				],
			});
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
		});

		it("should print nothing but the document", async () => {
			await write("default.rogen.json", {});

			await run({ json: true });

			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should fail without printing when no config is found, for the caller to report", async () => {
			const result = await run({ json: true });

			expect(result.isErr()).toBe(true);
			expect(logService.entries).toEqual([]);
		});
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should accept names, paths, variant flags and --json, but not the output overrides", () => {
			expect(
				parse(
					"list",
					"lobby",
					"places/a.rogen.json",
					"--variant",
					"mock",
					"--no-variant",
					"dev",
					"--json"
				).isOk()
			).toBe(true);
			expect(parse("list", "-o", "out.project.json").isErr()).toBe(true);
			expect(parse("list", "--all").isErr()).toBe(true);
		});
	});
});
