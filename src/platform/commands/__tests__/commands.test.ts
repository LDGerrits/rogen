import { jest } from "@jest/globals";
import { DisposableStore } from "../../../base/disposable.js";
import { ok } from "../../../base/result.js";
import { Registry } from "../../registry/registry.js";
import {
	Command,
	CommandRegistry,
	Extensions,
	GlobalOptions,
} from "../commands.js";
import { OptionDescriptor } from "../../environment/args.js";

function command(id: string): Command {
	return {
		id,
		metadata: { description: `Test command ${id}` },
		handler: async () => ok(undefined),
	};
}

function withOptions(id: string, options: OptionDescriptor[]): Command {
	return {
		...command(id),
		metadata: { description: id, options },
	};
}

const sourceOption: OptionDescriptor = {
	name: "source",
	short: "s",
	type: "string",
	description: "A source.",
};

describe("CommandRegistry", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("registerCommand", () => {
		it("should make the command available by id", () => {
			const foo = command("foo");
			store.add(registry.registerCommand(foo));

			expect(registry.getCommand("foo")).toBe(foo);
		});

		it("should return a Disposable that removes the command", () => {
			const registration = registry.registerCommand(command("foo"));

			registration[Symbol.dispose]();

			expect(registry.getCommand("foo")).toBeUndefined();
		});

		it("should allow the id to be registered again after disposal", () => {
			registry.registerCommand(command("foo"))[Symbol.dispose]();

			store.add(registry.registerCommand(command("foo")));

			expect(registry.getCommand("foo")).toBeDefined();
		});

		it("should not remove a later registration when an earlier one is disposed again", () => {
			const first = registry.registerCommand(command("foo"));
			first[Symbol.dispose]();
			const second = command("foo");
			store.add(registry.registerCommand(second));

			first[Symbol.dispose]();

			expect(registry.getCommand("foo")).toBe(second);
		});

		it("should fire onDidRegisterCommand with the id", () => {
			const listener = jest.fn<(id: string) => void>();
			store.add(registry.onDidRegisterCommand(listener));

			store.add(registry.registerCommand(command("foo")));

			expect(listener).toHaveBeenCalledWith("foo");
		});

		it("should throw for a duplicate id", () => {
			store.add(registry.registerCommand(command("foo")));

			expect(() => registry.registerCommand(command("foo"))).toThrow(
				/already registered/
			);
		});

		it("should throw for a command without a handler", () => {
			const broken = {
				id: "foo",
				metadata: { description: "missing handler" },
			} as unknown as Command;

			expect(() => registry.registerCommand(broken)).toThrow(
				/without a handler/
			);
		});
	});

	describe("getCommand", () => {
		it("should return undefined for an unknown id", () => {
			expect(registry.getCommand("unknown")).toBeUndefined();
		});
	});

	describe("getCommands", () => {
		it("should return every registered command keyed by id", () => {
			store.add(registry.registerCommand(command("foo")));
			store.add(registry.registerCommand(command("bar")));

			const commands = registry.getCommands();

			expect([...commands.keys()]).toEqual(
				expect.arrayContaining(["foo", "bar"])
			);
		});
	});

	describe("getOptions", () => {
		it("should include the global options", () => {
			expect(registry.getOptions()).toEqual(
				expect.arrayContaining([...GlobalOptions])
			);
		});

		it("should include each command's options once", () => {
			store.add(
				registry.registerCommand(withOptions("a", [sourceOption]))
			);
			store.add(
				registry.registerCommand(withOptions("b", [sourceOption]))
			);

			const names = registry.getOptions().map((o) => o.name);

			expect(names.filter((n) => n === "source")).toHaveLength(1);
		});

		it("should drop a command's options once it is disposed", () => {
			const registration = registry.registerCommand(
				withOptions("a", [sourceOption])
			);
			registration[Symbol.dispose]();

			expect(registry.getOptions().map((o) => o.name)).not.toContain(
				"source"
			);
		});
	});

	describe("registerCommand option validation", () => {
		it("should throw when a short flag is already bound to another option", () => {
			const clash: OptionDescriptor = {
				name: "sync",
				short: "s",
				type: "string",
				description: "A clash.",
			};
			store.add(
				registry.registerCommand(withOptions("a", [sourceOption]))
			);

			expect(() =>
				registry.registerCommand(withOptions("b", [clash]))
			).toThrow(/conflicts/);
		});

		it("should throw when an option redefines a global option differently", () => {
			const clash: OptionDescriptor = {
				name: "help",
				type: "string",
				description: "A clash.",
			};

			expect(() =>
				registry.registerCommand(withOptions("a", [clash]))
			).toThrow(/conflicts/);
		});

		it("should throw when a command reuses a global short flag", () => {
			const clash: OptionDescriptor = {
				name: "verbose-thing",
				short: "v",
				type: "boolean",
				description: "A clash.",
			};

			expect(() =>
				registry.registerCommand(withOptions("a", [clash]))
			).toThrow(/conflicts/);
		});
	});
});
