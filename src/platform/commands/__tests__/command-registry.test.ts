import { jest } from "@jest/globals";
import { Disposable, DisposableStore } from "../../../base/disposable.js";
import { Registry } from "../../registry/registry.js";
import {
	CommandDescriptor,
	CommandRegistry,
	Extensions,
} from "../command-registry.js";
import { ok } from "../../../base/result.js";

function descriptor(id: string): CommandDescriptor {
	return {
		id,
		title: id,
		description: `Test command ${id}`,
		handler: async () => ok(undefined),
	};
}

describe("CommandRegistry (platform/commands contribution point)", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("registers and looks up a command by id", () => {
		store.add(registry.registerCommand(descriptor("lookup-test")));

		expect(registry.getCommand("lookup-test")?.title).toBe("lookup-test");
	});

	it("enumerates every registered command", () => {
		store.add(registry.registerCommand(descriptor("enum-a")));
		store.add(registry.registerCommand(descriptor("enum-b")));

		const ids = registry.getCommands().map((d) => d.id);

		expect(ids).toEqual(expect.arrayContaining(["enum-a", "enum-b"]));
	});

	it("registerCommand returns a Disposable that removes the registration", () => {
		const disposable: Disposable = registry.registerCommand(
			descriptor("dispose-test")
		);

		expect(registry.getCommand("dispose-test")).toBeDefined();

		disposable[Symbol.dispose]();

		expect(registry.getCommand("dispose-test")).toBeUndefined();
	});

	it("returns undefined for a command that was never registered", () => {
		expect(registry.getCommand("never-registered")).toBeUndefined();
	});

	it("fires onDidRegisterCommand with a private emitter and a public Event", () => {
		const listener = jest.fn<(d: CommandDescriptor) => void>();
		store.add(registry.onDidRegisterCommand(listener));
		store.add(registry.registerCommand(descriptor("event-test")));

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0].id).toBe("event-test");
	});

	it("throws when registering a duplicate id", () => {
		store.add(registry.registerCommand(descriptor("duplicate")));

		expect(() => registry.registerCommand(descriptor("duplicate"))).toThrow(
			/already registered/
		);
	});

	it("throws when registering without a handler", () => {
		const broken = {
			id: "no-handler",
			title: "no-handler",
			description: "missing handler",
		} as unknown as CommandDescriptor;

		expect(() => registry.registerCommand(broken)).toThrow(
			/without a handler/
		);
	});

	it("allows the same id to be registered again after disposal", () => {
		const first = registry.registerCommand(descriptor("reregister"));
		first[Symbol.dispose]();

		store.add(registry.registerCommand(descriptor("reregister")));

		expect(registry.getCommand("reregister")).toBeDefined();
	});
});
