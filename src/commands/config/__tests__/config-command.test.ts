import path from "path";
import { Result, ok } from "../../../base/result.js";
import { MockConfigService } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	ConfigRefs,
	ConfigService,
} from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { ParsedArgs } from "../../../platform/environment/args.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { AbstractConfigCommand, ConfigRefsError } from "../config-command.js";

class TestConfigCommand extends AbstractConfigCommand {
	ran = 0;

	constructor() {
		super({ id: "build", metadata: { description: "Builds." } });
	}

	protected async runWithConfigs(): Promise<Result<void, Error>> {
		this.ran++;
		return ok(undefined);
	}
}

class PathsCommand extends TestConfigCommand {
	protected override configNames(): readonly string[] {
		return [];
	}
}

describe("AbstractConfigCommand", () => {
	const run = async (
		args: Partial<ParsedArgs>,
		command: TestConfigCommand = new TestConfigCommand()
	) => {
		const configService = new MockConfigService();
		const services = new ServiceCollection();
		services.set(ConfigService, configService);
		const result = await command.run(services, { _: ["build"], ...args });
		return { result, command, requested: configService.initialized };
	};

	const refs = async (args: Partial<ParsedArgs>): Promise<ConfigRefs> => {
		const { result, requested } = await run(args);
		result.unwrap();
		return requested[0];
	};

	const refusal = async (args: Partial<ParsedArgs>) => {
		const { result, command, requested } = await run(args);
		expect(command.ran).toBe(0);
		expect(requested).toEqual([]);
		return result.isErr() && (result.error as ConfigRefsError).code;
	};

	it("should load the configs, then run with them loaded", async () => {
		const { command, requested } = await run({});

		expect(requested).toHaveLength(1);
		expect(command.ran).toBe(1);
	});

	it("should take the names after the command and the -c paths", async () => {
		const result = await refs({
			_: ["build", "lobby", "match"],
			config: ["extra.rogen.json"],
		});

		expect(result.names).toEqual(["lobby", "match"]);
		expect(result.paths).toEqual(["extra.rogen.json"]);
	});

	it("should read only the flags when its positionals name something else", async () => {
		const { requested } = await run(
			{ _: ["where", "src/Hud.luau"], config: ["extra.rogen.json"] },
			new PathsCommand()
		);

		expect(requested[0].names).toEqual([]);
		expect(requested[0].paths).toEqual(["extra.rogen.json"]);
	});

	it("should carry the overrides, with tags as on and off", async () => {
		const result = await refs({
			"out-file": "out.project.json",
			"sync-dir": "dist",
			template: "base.project.json",
			tag: ["mock", "dev"],
			"no-tag": ["prod"],
		});

		expect(result.overrides).toEqual({
			outFile: "out.project.json",
			syncDir: "dist",
			template: "base.project.json",
			tags: { mock: true, dev: true, prod: false },
		});
	});

	it("should carry no overrides when no flag is given", async () => {
		expect((await refs({})).overrides).toEqual({ tags: {} });
	});

	it.each([
		["-o", { "out-file": "a.json" }],
		["-s", { "sync-dir": "dist" }],
		["--template", { template: "t.json" }],
	] as const)(
		"should refuse %s with several names",
		async (_flag, flags: Partial<ParsedArgs>) => {
			expect(
				await refusal({ _: ["build", "lobby", "match"], ...flags })
			).toBe("cli.singleConfigFlag");
		}
	);

	it("should count -c paths towards the several names", async () => {
		expect(
			await refusal({
				_: ["build", "lobby"],
				config: ["match.rogen.json"],
				"out-file": "a.json",
			})
		).toBe("cli.singleConfigFlag");
	});

	it("should allow -o with one name", async () => {
		const { result } = await run({
			_: ["build", "lobby"],
			"out-file": "a.json",
		});

		expect(result.isOk()).toBe(true);
	});

	it("should ask for every config with --all", async () => {
		expect(await refs({ all: true })).toMatchObject({
			names: [],
			paths: [],
			all: true,
		});
	});

	it.each<[string, Partial<ParsedArgs>]>([
		["a name", { _: ["build", "lobby"] }],
		["a -c path", { config: ["lobby.rogen.json"] }],
	])("should refuse --all with %s", async (_what, args) => {
		expect(await refusal({ all: true, ...args })).toBe("cli.allWithNames");
	});

	it("should refuse -o with --all", async () => {
		expect(await refusal({ all: true, "out-file": "a.json" })).toBe(
			"cli.singleConfigFlag"
		);
	});

	it("should return the load failure without running", async () => {
		const cwd = path.resolve("/repo");
		const fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(cwd);
		const environment = new NativeEnvironmentService({ _: ["build"] }, cwd);
		using configService = new CoreConfigService(fileSystem, environment);
		const services = new ServiceCollection();
		services.set(ConfigService, configService);
		const command = new TestConfigCommand();

		const result = await command.run(services, { _: ["build", "lobby"] });

		expect(result.isErr()).toBe(true);
		expect(command.ran).toBe(0);
	});
});
