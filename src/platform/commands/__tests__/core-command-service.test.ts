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
		commandService = new CoreCommandService(services, logService);
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

		it("should return an error naming an unknown command", async () => {
			const result = await commandService.executeCommand("prod", {
				positionals: [],
				options: {},
			});

			expect(result.isErr()).toBe(true);
			expect((result as ResultError<Error>).error.message).toMatch(
				/Unknown command "prod"/
			);
		});

		it("should suggest building a config named like the unknown command", async () => {
			const result = await commandService.executeCommand("prod", {
				positionals: ["prod"],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toContain(
				"rogen build prod"
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
