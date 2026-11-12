import { createDecorator } from "../instantiation.js";
import { CoreInstantiationService } from "../core-instantiation-service.js";
import { InstantiationService } from "../instantiation-service.js";
import { ServiceCollection } from "../service-collection.js";
import { SyncDescriptor } from "../sync-descriptor.js";

interface NameService {
	readonly _serviceBrand: undefined;
	readonly name: string;
}

interface GreetingService {
	readonly _serviceBrand: undefined;
	greet(): string;
}

const NameService = createDecorator<NameService>("nameService");
const GreetingService = createDecorator<GreetingService>("greetingService");
const LoopService = createDecorator<GreetingService>("loopService");

let created: string[] = [];

class Names implements NameService {
	declare readonly _serviceBrand: undefined;
	readonly name = "Ada";

	constructor() {
		created.push("names");
	}
}

class Greeting implements GreetingService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly punctuation: string,
		@NameService private readonly names: NameService
	) {
		created.push("greeting");
	}

	greet(): string {
		return `Hello, ${this.names.name}${this.punctuation}`;
	}
}

class Looping implements GreetingService {
	declare readonly _serviceBrand: undefined;

	constructor(@LoopService private readonly again: GreetingService) {}

	greet(): string {
		return this.again.greet();
	}
}

function collection(): ServiceCollection {
	const services = new ServiceCollection();
	services.set(NameService, new SyncDescriptor(Names));
	services.set(GreetingService, new SyncDescriptor(Greeting, ["!"]));
	return services;
}

describe("CoreInstantiationService", () => {
	beforeEach(() => {
		created = [];
	});

	describe("createInstance", () => {
		it("should pass a registered service to a decorated parameter", () => {
			class Greeter {
				constructor(@NameService private readonly names: NameService) {}

				greet(): string {
					return `Hello, ${this.names.name}.`;
				}
			}
			const services = new ServiceCollection();
			services.set(NameService, { name: "Ada" } as NameService);

			const greeter = new CoreInstantiationService(
				services
			).createInstance(Greeter);

			expect(greeter.greet()).toBe("Hello, Ada.");
		});

		it("should put the caller's arguments before the services", () => {
			const instantiation = new CoreInstantiationService(collection());

			const greeting = instantiation.createInstance(Greeting, "?");

			expect(greeting.greet()).toBe("Hello, Ada?");
		});

		it("should refuse a class given more arguments than it takes before its services", () => {
			const instantiation = new CoreInstantiationService(collection());

			expect(() =>
				(
					instantiation.createInstance as (
						ctor: unknown,
						...args: unknown[]
					) => unknown
				)(Greeting, "!", "extra")
			).toThrow(/Greeting takes 1 argument\(s\)/);
		});

		it("should leave an argument the caller left out undefined, so its default applies", () => {
			class Punctuated {
				constructor(
					readonly punctuation: string = "!",
					@NameService readonly names: NameService
				) {}
			}
			const instantiation = new CoreInstantiationService(collection());

			const punctuated = (
				instantiation.createInstance as (
					ctor: unknown,
					...args: unknown[]
				) => Punctuated
			)(Punctuated);

			expect(punctuated.punctuation).toBe("!");
		});

		it("should give a subclass without a constructor its base class's services", () => {
			class Shouting extends Greeting {
				override greet(): string {
					return super.greet().toUpperCase();
				}
			}
			const instantiation = new CoreInstantiationService(collection());

			expect(instantiation.createInstance(Shouting, "!").greet()).toBe(
				"HELLO, ADA!"
			);
		});

		it("should name a service nobody registered when strict", () => {
			class Lonely {
				constructor(@LoopService _loop: GreetingService) {}
			}
			const instantiation = new CoreInstantiationService(
				collection(),
				true
			);

			expect(() => instantiation.createInstance(Lonely)).toThrow(
				/UNKNOWN service loopService/
			);
		});

		it("should pass undefined for a service nobody registered when not strict", () => {
			class Lonely {
				constructor(@LoopService readonly loop: GreetingService) {}
			}
			const instantiation = new CoreInstantiationService(collection());

			expect(instantiation.createInstance(Lonely).loop).toBeUndefined();
		});

		it("should build from a descriptor, its static arguments first", () => {
			const instantiation = new CoreInstantiationService(collection());

			const greeting = instantiation.createInstance(
				new SyncDescriptor(Greeting, ["?"])
			);

			expect(greeting.greet()).toBe("Hello, Ada?");
		});

		it("should offer itself as a service", () => {
			class Needy {
				constructor(
					@InstantiationService
					readonly instantiation: InstantiationService
				) {}
			}
			const instantiation = new CoreInstantiationService(collection());

			expect(instantiation.createInstance(Needy).instantiation).toBe(
				instantiation
			);
		});
	});

	describe("invokeFunction", () => {
		it("should build a described service when it is first asked for", () => {
			const instantiation = new CoreInstantiationService(collection());

			const greeting = instantiation.invokeFunction((accessor) =>
				accessor.get(GreetingService).greet()
			);

			expect(greeting).toBe("Hello, Ada!");
		});

		it("should build nothing until a service is asked for", () => {
			const instantiation = new CoreInstantiationService(collection());

			instantiation.invokeFunction(() => undefined);

			expect(created).toEqual([]);
		});

		it("should build a service's dependencies first, each once", () => {
			const instantiation = new CoreInstantiationService(collection());

			instantiation.invokeFunction((accessor) => {
				accessor.get(GreetingService);
				accessor.get(GreetingService);
				accessor.get(NameService);
			});

			expect(created).toEqual(["names", "greeting"]);
		});

		it("should pass its extra arguments on", () => {
			const instantiation = new CoreInstantiationService(collection());

			const result = instantiation.invokeFunction(
				(_accessor, a: number, b: number) => a + b,
				2,
				3
			);

			expect(result).toBe(5);
		});

		it("should refuse an accessor used after the function returned", async () => {
			const instantiation = new CoreInstantiationService(collection());

			const late = instantiation.invokeFunction(async (accessor) => {
				await Promise.resolve();
				return accessor.get(NameService);
			});

			await expect(late).rejects.toThrow(
				"service accessor is only valid during the invocation of its target method"
			);
		});

		it("should name a service nobody registered", () => {
			const instantiation = new CoreInstantiationService(collection());

			expect(() =>
				instantiation.invokeFunction((accessor) =>
					accessor.get(LoopService)
				)
			).toThrow("[invokeFunction] unknown service 'loopService'");
		});

		it("should refuse to run once disposed", () => {
			const instantiation = new CoreInstantiationService(collection());
			instantiation[Symbol.dispose]();

			expect(() => instantiation.invokeFunction(() => 1)).toThrow(
				"InstantiationService has been disposed"
			);
		});

		it("should name the circle when services depend on each other", () => {
			const services = new ServiceCollection();
			services.set(LoopService, new SyncDescriptor(Looping));
			const instantiation = new CoreInstantiationService(services);

			expect(() =>
				instantiation.invokeFunction((accessor) =>
					accessor.get(LoopService)
				)
			).toThrow(/loopService -> loopService/);
		});

		it("should build a service again after a failed attempt", () => {
			class Flaky {
				declare readonly _serviceBrand: undefined;
				static fail = true;
				readonly name = "Flaky";

				constructor() {
					if (Flaky.fail) throw new Error("not yet");
				}
			}
			const services = new ServiceCollection();
			services.set(NameService, new SyncDescriptor(Flaky));
			const instantiation = new CoreInstantiationService(services);
			const ask = () =>
				instantiation.invokeFunction((accessor) =>
					accessor.get(NameService)
				);
			expect(ask).toThrow("not yet");

			Flaky.fail = false;

			expect(ask().name).toBe("Flaky");
		});
	});

	describe("dispose", () => {
		it("should dispose every service even when one fails", () => {
			const disposed: string[] = [];
			const failing = (name: string, fails: boolean) =>
				class {
					declare readonly _serviceBrand: undefined;
					readonly name = name;

					[Symbol.dispose](): void {
						disposed.push(name);
						if (fails) throw new Error(`${name} failed`);
					}
				};
			const services = new ServiceCollection();
			services.set(
				NameService,
				new SyncDescriptor(failing("first", true))
			);
			services.set(
				LoopService,
				new SyncDescriptor(failing("second", false)) as never
			);
			const instantiation = new CoreInstantiationService(services);
			instantiation.invokeFunction((accessor) => {
				accessor.get(NameService);
				accessor.get(LoopService);
			});

			expect(() => instantiation[Symbol.dispose]()).toThrow(
				"first failed"
			);
			expect(disposed).toEqual(["first", "second"]);
		});

		it("should dispose the services it built, and not the ones it was given", () => {
			const disposed: string[] = [];
			class Closing {
				declare readonly _serviceBrand: undefined;
				readonly name = "closing";

				[Symbol.dispose](): void {
					disposed.push("built");
				}
			}
			const given = {
				name: "given",
				[Symbol.dispose]: () => disposed.push("given"),
			};
			const services = new ServiceCollection();
			services.set(NameService, new SyncDescriptor(Closing));
			services.set(LoopService, given as unknown as GreetingService);
			const instantiation = new CoreInstantiationService(services);
			instantiation.invokeFunction((accessor) => {
				accessor.get(NameService);
				accessor.get(LoopService);
			});

			instantiation[Symbol.dispose]();

			expect(disposed).toEqual(["built"]);
		});
	});

	describe("createChild", () => {
		it("should fall back on the parent for a service the child lacks", () => {
			const parent = new CoreInstantiationService(collection());
			const child = parent.createChild(new ServiceCollection());

			const name = child.invokeFunction(
				(accessor) => accessor.get(NameService).name
			);

			expect(name).toBe("Ada");
		});

		it("should prefer the child's own service", () => {
			const parent = new CoreInstantiationService(collection());
			const child = parent.createChild(
				new ServiceCollection([NameService, { name: "Grace" }])
			);

			const name = child.invokeFunction(
				(accessor) => accessor.get(NameService).name
			);

			expect(name).toBe("Grace");
		});

		it("should build the parent's service with the parent's services, once", () => {
			const parent = new CoreInstantiationService(collection());
			const child = parent.createChild(
				new ServiceCollection([NameService, { name: "Grace" }])
			);

			const greeting = child.invokeFunction((accessor) =>
				accessor.get(GreetingService).greet()
			);
			const again = parent.invokeFunction((accessor) =>
				accessor.get(GreetingService).greet()
			);

			expect(greeting).toBe("Hello, Ada!");
			expect(again).toBe("Hello, Ada!");
			expect(created).toEqual(["names", "greeting"]);
		});

		it("should dispose with its parent", () => {
			const disposed: string[] = [];
			class Closing {
				declare readonly _serviceBrand: undefined;
				readonly name = "closing";

				[Symbol.dispose](): void {
					disposed.push("closing");
				}
			}
			const parent = new CoreInstantiationService(collection());
			const child = parent.createChild(
				new ServiceCollection([
					NameService,
					new SyncDescriptor(Closing),
				])
			);
			child.invokeFunction((accessor) => accessor.get(NameService));

			(parent as CoreInstantiationService)[Symbol.dispose]();

			expect(disposed).toEqual(["closing"]);
		});

		it("should dispose on its own, and not again with its parent", () => {
			const disposed: string[] = [];
			class Closing {
				declare readonly _serviceBrand: undefined;
				readonly name = "closing";

				[Symbol.dispose](): void {
					disposed.push("closing");
				}
			}
			const parent = new CoreInstantiationService(collection());
			const child = parent.createChild(
				new ServiceCollection([
					NameService,
					new SyncDescriptor(Closing),
				])
			);
			child.invokeFunction((accessor) => accessor.get(NameService));

			child[Symbol.dispose]();
			parent[Symbol.dispose]();

			expect(disposed).toEqual(["closing"]);
		});
	});

	describe("createDecorator", () => {
		it("should give one identifier to one name", () => {
			expect(createDecorator<NameService>("nameService")).toBe(
				NameService
			);
		});
	});
});
