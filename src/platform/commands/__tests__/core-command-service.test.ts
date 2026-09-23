import { DisposableStore } from "../../../base/disposable.js";
import { ResultError, err, ok } from "../../../base/result.js";
import { ServiceCollection } from "../../instantiation/service-collection.js";
import { LogService, NullLogService } from "../../log/log-service.js";
import { Registry } from "../../registry/registry.js";
import { CommandEvent, CommandRegistry, Extensions } from "../commands.js";
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
		commandService = store.add(
			new CoreCommandService(services, logService)
		);
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
				_: ["foo", "bar"],
			});

			expect(result.isOk()).toBe(true);
			expect(calls).toEqual([[logService, { _: ["foo", "bar"] }]]);
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
				_: [],
			});

			expect((result as ResultError<Error>).error).toBe(error);
		});

		it("should return an error naming an unknown command", async () => {
			const result = await commandService.executeCommand("prod", {
				_: [],
			});

			expect(result.isErr()).toBe(true);
			expect((result as ResultError<Error>).error.message).toMatch(
				/Unknown command "prod"/
			);
		});

		it("should fire onWillExecuteCommand before and onDidExecuteCommand after the handler runs", async () => {
			const order: string[] = [];
			store.add(
				registry.registerCommand({
					id: "foo",
					metadata: { description: "foo" },
					handler: async () => {
						order.push("handler");
						return ok(undefined);
					},
				})
			);
			store.add(
				commandService.onWillExecuteCommand((e: CommandEvent) =>
					order.push(`will:${e.commandId}`)
				)
			);
			store.add(
				commandService.onDidExecuteCommand((e: CommandEvent) =>
					order.push(`did:${e.commandId}`)
				)
			);

			await commandService.executeCommand("foo", { _: [] });

			expect(order).toEqual(["will:foo", "handler", "did:foo"]);
		});

		it("should not fire events for an unknown command", async () => {
			const events: CommandEvent[] = [];
			store.add(
				commandService.onWillExecuteCommand((e) => events.push(e))
			);
			store.add(
				commandService.onDidExecuteCommand((e) => events.push(e))
			);

			await commandService.executeCommand("prod", { _: [] });

			expect(events).toEqual([]);
		});
	});
});
