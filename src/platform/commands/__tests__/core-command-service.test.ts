import { UsageError } from "../../../base/errors.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError, err, ok } from "../../../base/result.js";
import { ServiceCollection } from "../../instantiation/service-collection.js";
import { LogService } from "../../log/log-service.js";
import { NullLogService } from "../../log/null-log-service.js";
import { Registry } from "../../registry/registry.js";
import { CommandRegistry, Extensions } from "../commands.js";
import { CoreCommandService } from "../core-command-service.js";

describe("CoreCommandService", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	const logService = new NullLogService();
	let store: DisposableStore;
	let services: ServiceCollection;
	let commandService: CoreCommandService;

	beforeEach(() => {
		store = new DisposableStore();
		services = new ServiceCollection();
		services.set(LogService, logService);
		commandService = new CoreCommandService(services, logService, registry);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("executeCommand", () => {
		it("should run the handler with the accessor and args", async () => {
			const calls: unknown[][] = [];
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async (accessor, args) => {
						calls.push([accessor.get(LogService), args]);
						return ok(undefined);
					},
				})
			);

			const result = await commandService.executeCommand("foo", {
				positionals: ["foo", "bar"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(calls).toEqual([
				[logService, { positionals: ["foo", "bar"], options: {} }],
			]);
		});

		it("should return the handler's error", async () => {
			const error = new Error("failed");
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async () => err(error),
				})
			);

			const result = await commandService.executeCommand("foo", {
				positionals: [],
				options: {},
			});

			expect((result as ResultError<Error>).error).toBe(error);
		});

		it("should return a failed system call as the command's error", async () => {
			const error = Object.assign(
				new Error("EACCES: permission denied, scandir '/repo/src'"),
				{ code: "EACCES" }
			);
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async () => {
						throw error;
					},
				})
			);

			const result = await commandService.executeCommand("foo", {
				positionals: [],
				options: {},
			});

			expect((result as ResultError<Error>).error).toBe(error);
		});

		it("should let any other throw through, since it is a bug", async () => {
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async () => {
						throw new TypeError("oops");
					},
				})
			);

			await expect(
				commandService.executeCommand("foo", {
					positionals: [],
					options: {},
				})
			).rejects.toThrow("oops");
		});

		it("should refuse words after -- for a command that takes none", async () => {
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async () => ok(undefined),
				})
			);

			const result = await commandService.executeCommand("foo", {
				positionals: [],
				passthrough: ["--port", "1"],
				options: {},
			});

			expect(result.isErr() && result.error).toEqual(
				new UsageError(
					"foo takes nothing after '--'. Run 'rogen help foo' to see what it accepts."
				)
			);
		});

		it("should hand the words after -- to a command that declares them", async () => {
			const lines: unknown[] = [];
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: {
						description: "foo",
						passthrough: { name: "args", description: "" },
					},
					handler: async (_accessor, line) => {
						lines.push(line.passthrough);
						return ok(undefined);
					},
				})
			);

			const result = await commandService.executeCommand("foo", {
				positionals: [],
				passthrough: ["--port", "1"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(lines).toEqual([["--port", "1"]]);
		});

		it("should return an error naming an unknown command", async () => {
			const result = await commandService.executeCommand("prod", {
				positionals: [],
				options: {},
			});

			expect((result as ResultError<Error>).error).toBeInstanceOf(
				UsageError
			);
			expect((result as ResultError<Error>).error.message).toMatch(
				/Unknown command "prod"/
			);
		});

		it("should point the old version command at the flag", async () => {
			const result = await commandService.executeCommand("version", {
				positionals: [],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown command \"version\". Did you mean 'rogen --version'?"
			);
		});

		it("should offer the command that takes an unknown word", async () => {
			store.add(
				registry.registerCommand({
					id: "build",
					metadata: {
						description: "build",
						unknownWordOffer: "To build a config",
					},
					handler: async () => ok(undefined),
				})
			);

			const result = await commandService.executeCommand("prod", {
				positionals: ["prod"],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown command \"prod\". To build a config, run 'rogen build prod'; run 'rogen help' to see the commands."
			);
		});

		it("should point at help when no command takes an unknown word", async () => {
			const result = await commandService.executeCommand("prod", {
				positionals: ["prod"],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown command \"prod\". Run 'rogen help' to see the commands."
			);
		});

		it("should suggest the command a misspelled one is closest to", async () => {
			store.add(
				registry.registerCommand({
					id: "build",
					metadata: { description: "build" },
					handler: async () => ok(undefined),
				})
			);

			const result = await commandService.executeCommand("biuld", {
				positionals: ["biuld"],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown command \"biuld\". Did you mean 'rogen build'?"
			);
		});
	});
});
