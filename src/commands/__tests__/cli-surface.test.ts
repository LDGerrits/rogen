import "../build/build-command.js";
import "../help/help-command.js";
import "../init/init-command.js";
import "../list/list-command.js";
import "../version/version-command.js";
import "../watch/watch-command.js";
import { DisposableStore } from "../../base/disposable.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { CoreCommandService } from "../../platform/commands/core-command-service.js";
import { parseArgs } from "../../platform/environment/args.js";
import { ServiceCollection } from "../../platform/instantiation/service-collection.js";
import { LogService, NullLogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";

describe("CLI surface", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	const parse = (...argv: string[]) =>
		parseArgs(argv, (command) => registry.getOptions(command));

	it("should register the commands of the spec", () => {
		expect([...registry.getCommands().keys()].sort()).toEqual([
			"build",
			"help",
			"init",
			"list",
			"version",
			"watch",
		]);
	});

	it("should parse every override flag on build, with the repeatable ones as arrays", () => {
		const { command, options } = parse(
			"build",
			"lobby",
			"-c",
			"a.rogen.json",
			"--config",
			"b.rogen.json",
			"-o",
			"out.project.json",
			"-s",
			"dist",
			"--template",
			"base.project.json",
			"-t",
			"mock",
			"--tag",
			"dev",
			"--no-tag",
			"prod",
			"--show-config"
		).unwrap();

		expect(command).toBe("build");
		expect(options).toEqual({
			_: ["build", "lobby"],
			config: ["a.rogen.json", "b.rogen.json"],
			"out-file": "out.project.json",
			"sync-dir": "dist",
			template: "base.project.json",
			tag: ["mock", "dev"],
			"no-tag": ["prod"],
			"show-config": true,
		});
	});

	it("should accept the override flags on watch, but not --show-config", () => {
		expect(parse("watch", "-t", "mock", "-c", "a.rogen.json").isOk()).toBe(
			true
		);
		expect(parse("watch", "--show-config").isErr()).toBe(true);
	});

	it("should not accept override flags on commands they don't apply to", () => {
		expect(parse("list", "-c", "a.rogen.json").isErr()).toBe(true);
		expect(parse("init", "-t", "mock").isErr()).toBe(true);
	});

	it.each(["--profile", "--env", "--mode", "--build", "--init", "--trace"])(
		"should reject the old flag %s",
		(flag) => {
			expect(parse("build", flag).isErr()).toBe(true);
		}
	);

	it("should suggest `rogen build <name>` for an unknown command", async () => {
		const store = new DisposableStore();
		const logService = new NullLogService();
		const services = new ServiceCollection();
		services.set(LogService, logService);
		const result = await store
			.add(new CoreCommandService(services, logService))
			.executeCommand("prod", { _: ["prod"] });
		store[Symbol.dispose]();

		expect(result.isErr() && result.error.message).toContain(
			"rogen build prod"
		);
	});
});
