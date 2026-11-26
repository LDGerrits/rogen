import { DeferredPromise } from "../../../base/async.js";
import { Emitter } from "../../../base/event.js";
import { Result, ok } from "../../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { mockConfig } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { WatchSession, WatchUpdate } from "../../watch/watch-service.js";
import {
	FailedConfig,
	LoadedConfig,
	SyncWarnings,
	WrittenConfig,
} from "../../write/write.js";
import { RojoChildHost, RojoChildren } from "../rojo-children.js";

class FakeWatch implements WatchSession {
	readonly configs: readonly ResolvedConfig[] = [];
	readonly updates = new Emitter<WatchUpdate>();
	readonly onDidUpdate = this.updates.event;
	readonly onDidError = new Emitter<Error>().event;
	constructor(private readonly events: string[]) {}
	async start(): Promise<Result<void, Error>> {
		return ok(undefined);
	}
	async refresh(): Promise<void> {}
	async stop(): Promise<void> {
		this.events.push("watch stopped");
	}
	[Symbol.dispose](): void {}
}

class FakeChild {
	disposed = false;
	followed = 0;
	constructor(
		readonly name: string,
		private readonly events: string[],
		private readonly ending: Promise<void> = Promise.resolve()
	) {}
	async terminate(): Promise<void> {
		await this.ending;
		this.events.push(`stopped ${this.name}`);
	}
	[Symbol.dispose](): void {
		this.disposed = true;
	}
}

const configs = {
	a: mockConfig({ file: "/repo/a/default.rogen.json" }),
	b: mockConfig({ file: "/repo/b/default.rogen.json" }),
};

const findings = { warnings: [], sync: SyncWarnings.unknown };
const summary = {
	roots: [],
	routes: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
};

const written = (config: ResolvedConfig): LoadedConfig =>
	new WrittenConfig(config, "wrote", findings, summary, []);

const failed = (config: ResolvedConfig): LoadedConfig =>
	new FailedConfig(config, [
		errorDiagnostic("write.failed", { resource: config.file }, "no"),
	]);

const update = (...outcomes: LoadedConfig[]): WatchUpdate => ({
	at: new Date(0),
	cause: { kind: "initial" },
	changes: [],
	notices: [],
	reports: outcomes.map((outcome) => ({
		outcome,
		unreported: [],
		repeated: [],
		fixed: [],
		repeatedFailure: false,
	})),
});

const incompatible = (file: string): Diagnostic =>
	errorDiagnostic("rojo.syncRulesUnsupported", { resource: file }, "old");

describe("RojoChildren", () => {
	let events: string[];
	let watch: FakeWatch;
	let wanted: readonly ResolvedConfig[] | undefined;
	let problems: readonly Diagnostic[];
	let admissions: (true | undefined)[];
	let starts: Promise<FakeChild | undefined>[];
	let errors: Error[];
	let refusals: Error[];
	let children: RojoChildren<FakeChild, true>;

	const host = (): RojoChildHost<FakeChild, true> => ({
		wanted: () => wanted,
		problemsIn: async () => problems,
		admit: async () => (admissions.length > 0 ? admissions.shift() : true),
		start: async (config) => {
			const next = starts.shift();
			if (next) return next;
			events.push(`started ${config.projectDir.slice(-1)}`);
			return new FakeChild(config.projectDir.slice(-1), events);
		},
		follow: (child) => {
			child.followed++;
		},
		retire: async (child, reason) => {
			await child.terminate();
			child[Symbol.dispose]();
			events.push(`retired ${child.name} (${reason})`);
		},
	});

	const apply = async (next: WatchUpdate) => {
		watch.updates.fire(next);
		await children.settled();
	};

	beforeEach(() => {
		events = [];
		watch = new FakeWatch(events);
		wanted = [configs.a];
		problems = [];
		admissions = [];
		starts = [];
		errors = [];
		refusals = [];
		children = new RojoChildren(watch, host());
		children.onDidError((error) => errors.push(error));
		children.onDidRefuse((error) => refusals.push(error));
	});

	afterEach(() => children[Symbol.dispose]());

	describe("update", () => {
		it("should start a child once its config is first written, not before", async () => {
			await apply(update(failed(configs.a)));
			expect(events).toEqual([]);

			await apply(update(written(configs.a)));

			expect(events).toEqual(["started a"]);
			expect(children.hasStarted).toBe(true);
		});

		it("should keep the child while its project file stays where it was", async () => {
			await apply(update(written(configs.a)));
			await apply(update(written(configs.a)));
			await apply(update(failed(configs.a)));

			expect(events).toEqual(["started a"]);
			expect(children.children()[0].followed).toBe(2);
		});

		it("should stop the old child before it starts one on a new project", async () => {
			await apply(update(written(configs.a)));

			wanted = [configs.b];
			await apply(update(written(configs.b)));

			expect(events).toEqual([
				"started a",
				"stopped a",
				"retired a (removed)",
				"started b",
			]);
		});

		it("should restart a child whose place changes, the old one first", async () => {
			const place = { value: "8000" };
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				placeOf: (config) => `${config.projectFile}:${place.value}`,
			});
			await apply(update(written(configs.a)));

			place.value = "8001";
			await apply(update(written(configs.a)));

			expect(events).toEqual([
				"started a",
				"stopped a",
				"retired a (moved)",
				"started a",
			]);
		});

		it("should stop the child of a config that goes away", async () => {
			wanted = [configs.a, configs.b];
			await apply(update(written(configs.a), written(configs.b)));

			wanted = [configs.b];
			await apply(update(written(configs.b)));

			expect(events).toEqual([
				"started a",
				"started b",
				"stopped a",
				"retired a (removed)",
			]);
		});

		it("should leave its children alone while nothing is wanted", async () => {
			await apply(update(written(configs.a)));

			wanted = undefined;
			await apply(update(written(configs.a)));

			expect(events).toEqual(["started a"]);
		});

		it("should keep a running child when the host does not admit its new place", async () => {
			const place = { value: "8000" };
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				placeOf: () => place.value,
			});
			await apply(update(written(configs.a)));

			place.value = "8001";
			admissions.push(undefined);
			await apply(update(written(configs.a)));

			expect(events).toEqual(["started a"]);
		});
	});

	describe("compatibility", () => {
		it("should refuse before the first start, and start nothing", async () => {
			problems = [incompatible("/repo/a/default.project.json")];

			await apply(update(written(configs.a)));
			problems = [];
			await apply(update(written(configs.a)));

			expect(events).toEqual([]);
			expect(refusals).toHaveLength(1);
			expect((refusals[0] as DiagnosticsError).diagnostics).toEqual([
				incompatible("/repo/a/default.project.json"),
			]);
			expect(errors).toEqual([]);
		});

		it("should report a problem after the first start, and keep the child running", async () => {
			await apply(update(written(configs.a)));

			problems = [incompatible("/repo/a/default.project.json")];
			await apply(update(written(configs.a)));

			expect(events).toEqual(["started a"]);
			expect(refusals).toEqual([]);
			expect(errors).toHaveLength(1);
		});
	});

	describe("failures", () => {
		it("should refuse when an update throws before the first start", async () => {
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				problemsIn: async () => {
					throw new Error("boom");
				},
			});
			children.onDidRefuse((error) => refusals.push(error));

			await apply(update(written(configs.a)));

			expect(refusals.map(({ message }) => message)).toEqual(["boom"]);
			expect(children.isHalted).toBe(true);
		});

		it("should report an update that throws after the first start, and go on", async () => {
			let fails = false;
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				problemsIn: async () => {
					if (fails) throw new Error("boom");
					return [];
				},
			});
			children.onDidError((error) => errors.push(error));
			await apply(update(written(configs.a)));

			fails = true;
			await apply(update(written(configs.a)));

			expect(errors.map(({ message }) => message)).toEqual(["boom"]);
			expect(children.isHalted).toBe(false);
		});
	});

	describe("stop", () => {
		it("should stop every child before it stops the watch", async () => {
			wanted = [configs.a, configs.b];
			await apply(update(written(configs.a), written(configs.b)));

			await children.stop();

			expect(events).toEqual([
				"started a",
				"started b",
				"stopped a",
				"stopped b",
				"watch stopped",
			]);
		});

		it("should wait for a child that is being retired", async () => {
			const ending = new DeferredPromise<void>();
			starts.push(Promise.resolve(new FakeChild("a", events, ending.p)));
			await apply(update(written(configs.a)));
			wanted = [];
			watch.updates.fire(update());
			await new Promise((resolve) => setImmediate(resolve));

			const stopped = children.stop();
			ending.complete();
			await stopped;

			expect(events).toEqual([
				"stopped a",
				"retired a (removed)",
				"watch stopped",
			]);
		});

		it("should end a child that starts after it stopped", async () => {
			const late = new DeferredPromise<FakeChild | undefined>();
			starts.push(late.p);
			watch.updates.fire(update(written(configs.a)));
			await new Promise((resolve) => setImmediate(resolve));

			const stopped = children.stop();
			late.complete(new FakeChild("a", events));
			await stopped;

			expect(events).toEqual(["stopped a", "watch stopped"]);
			expect(children.children()).toEqual([]);
		});

		it("should start no child for the next config when it stops while it retires one", async () => {
			const ending = new DeferredPromise<void>();
			starts.push(Promise.resolve(new FakeChild("a", events, ending.p)));
			await apply(update(written(configs.a)));
			wanted = [configs.b];
			watch.updates.fire(update(written(configs.b)));
			await new Promise((resolve) => setImmediate(resolve));

			const stopped = children.stop();
			ending.complete();
			await stopped;

			expect(events).toEqual([
				"stopped a",
				"retired a (removed)",
				"watch stopped",
			]);
		});

		it("should start nothing in place of a child it moves when it stops while it ends the old one", async () => {
			const place = { value: "8000" };
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				placeOf: () => place.value,
			});
			const ending = new DeferredPromise<void>();
			starts.push(Promise.resolve(new FakeChild("a", events, ending.p)));
			await apply(update(written(configs.a)));
			place.value = "8001";
			watch.updates.fire(update(written(configs.a)));
			await new Promise((resolve) => setImmediate(resolve));

			const stopped = children.stop();
			ending.complete();
			await stopped;

			expect(events).toEqual([
				"stopped a",
				"retired a (moved)",
				"watch stopped",
			]);
		});

		it("should start nothing when it stops while the host decides", async () => {
			const decided = new DeferredPromise<true | undefined>();
			children[Symbol.dispose]();
			children = new RojoChildren(watch, {
				...host(),
				admit: () => decided.p,
			});
			watch.updates.fire(update(written(configs.a)));
			await new Promise((resolve) => setImmediate(resolve));

			const stopped = children.stop();
			decided.complete(true);
			await stopped;

			expect(events).toEqual(["watch stopped"]);
		});

		it("should start nothing for an update after it stopped", async () => {
			await children.stop();

			await apply(update(written(configs.a)));

			expect(events).toEqual(["watch stopped"]);
		});
	});
});
