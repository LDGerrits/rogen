import { DisposableStore } from "../../../base/disposable.js";
import { UsageError } from "../../../base/errors.js";
import { ResultError, ok } from "../../../base/result.js";
import { MockLogService } from "../../log/__tests__/mock-log-service.js";
import { exitCodeOf } from "../command-failure.js";
import { Registry } from "../../registry/registry.js";
import {
	AbstractCommand,
	Command,
	CommandRegistry,
	Extensions,
	registerCommand,
	ReportedError,
} from "../commands.js";
import {
	OptionDescriptor,
	CommandLine,
	GlobalOptions,
} from "../../environment/args.js";
import { ServicesAccessor } from "../../instantiation/instantiation.js";
import { ServiceCollection } from "../../instantiation/service-collection.js";

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

		it("should throw for a duplicate id", () => {
			store.add(registry.registerCommand(command("foo")));

			expect(() => registry.registerCommand(command("foo"))).toThrow(
				/already registered/
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

		it("should include only the given command's own options", () => {
			store.add(
				registry.registerCommand(withOptions("a", [sourceOption]))
			);
			store.add(registry.registerCommand(command("b")));

			expect(registry.getOptions("b").map((o) => o.name)).not.toContain(
				"source"
			);
			expect(registry.getOptions("a").map((o) => o.name)).toContain(
				"source"
			);
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

describe("registerCommand", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	class EchoCommand extends AbstractCommand {
		constructor() {
			super({ id: "echo", metadata: { description: "Echoes." } });
		}

		async run(accessor: ServicesAccessor, line: CommandLine<readonly []>) {
			ran.push({ accessor, line });
			return ok(undefined);
		}
	}

	let ran: { accessor: ServicesAccessor; line: CommandLine }[];

	beforeEach(() => {
		ran = [];
	});

	it("should register the command under its descriptor's id and metadata", () => {
		store.add(registerCommand(EchoCommand));

		expect(registry.getCommand("echo")?.metadata).toEqual({
			description: "Echoes.",
		});
	});

	it("should run the command with the accessor and args its handler gets", async () => {
		store.add(registerCommand(EchoCommand));
		const accessor: ServicesAccessor = new ServiceCollection();
		const line: CommandLine = { positionals: ["a"], options: {} };

		const result = await registry
			.getCommand("echo")
			?.handler(accessor, line);

		expect(result?.isOk()).toBe(true);
		expect(ran).toEqual([{ accessor, line }]);
	});

	it("should remove the command when the registration is disposed", () => {
		registerCommand(EchoCommand)[Symbol.dispose]();

		expect(registry.getCommand("echo")).toBeUndefined();
	});
});

describe("AbstractCommand", () => {
	class JsonCommand extends AbstractCommand {
		constructor() {
			super({ id: "json", metadata: { description: "Prints JSON." } });
		}

		async run() {
			return ok(undefined);
		}

		print(logService: MockLogService, failure?: Error) {
			return this.printJson(logService, { done: !failure }, failure);
		}
	}

	describe("printJson", () => {
		it("should print the document once and succeed", () => {
			const logService = new MockLogService();

			const result = new JsonCommand().print(logService);

			expect(result.isOk()).toBe(true);
			expect(logService.entries.map(({ text }) => text)).toEqual([
				'{\n  "done": true\n}',
			]);
		});

		it("should fail as reported, keeping the failure's exit code", () => {
			const logService = new MockLogService();
			const failure = new UsageError("bad line");

			const result = new JsonCommand().print(logService, failure);
			const error = (result as ResultError<Error>).error;

			expect(error).toBeInstanceOf(ReportedError);
			expect(exitCodeOf(error)).toBe(2);
			expect(logService.entries).toHaveLength(1);
		});
	});
});
describe("ReportedError", () => {
	it("should keep the message and cause of the failure it stands for", () => {
		const cause = new Error("No config found.");
		const reported = new ReportedError(cause);

		expect(reported.message).toBe("No config found.");
		expect(reported.cause).toBe(cause);
		expect(reported).toBeInstanceOf(Error);
	});
});
