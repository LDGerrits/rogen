import { Registry } from "../../../../platform/registry/registry.js";
import {
	BuildRule,
	Extensions,
	RuleRegistry,
	SyncDirRule,
} from "../rule-registry.js";

const rule = (id: string, order: number): BuildRule => ({
	id,
	order,
	check: () => [],
});

const syncDirRule = (id: string, order: number): SyncDirRule => ({
	id,
	order,
	check: async () => [],
});

describe("RuleRegistry", () => {
	const registry = () => Registry.as<RuleRegistry>(Extensions.Rules);
	let registrations: Disposable[];

	const register = (added: BuildRule) => {
		const registration = registry().registerRule(added);
		registrations.push(registration);
		return registration;
	};

	beforeEach(() => {
		registrations = [];
	});

	afterEach(() => {
		for (const registration of registrations) registration[Symbol.dispose]();
	});

	describe("getRules", () => {
		it("should list rules in ascending order", () => {
			register(rule("late", 30));
			register(rule("early", 10));
			register(rule("middle", 20));

			expect(registry().getRules().map(({ id }) => id)).toEqual([
				"early",
				"middle",
				"late",
			]);
		});

		it("should break a tie by id", () => {
			register(rule("b", 10));
			register(rule("a", 10));

			expect(registry().getRules().map(({ id }) => id)).toEqual([
				"a",
				"b",
			]);
		});

		it("should not list a disposed rule", () => {
			register(rule("kept", 10));
			register(rule("gone", 20))[Symbol.dispose]();

			expect(registry().getRules().map(({ id }) => id)).toEqual(["kept"]);
		});
	});

	describe("registerRule", () => {
		it("should throw when the id is already registered", () => {
			register(rule("twice", 10));

			expect(() => registry().registerRule(rule("twice", 20))).toThrow(
				'Rule "twice" is already registered.'
			);
		});

		it("should keep the original when a stale registration is disposed", () => {
			const first = register(rule("same", 10));
			first[Symbol.dispose]();
			register(rule("same", 20));
			first[Symbol.dispose]();

			expect(registry().getRules().map(({ order }) => order)).toEqual([
				20,
			]);
		});
	});

	describe("registerSyncDirRule", () => {
		it("should list sync dir rules apart from build rules, in order", () => {
			register(rule("build", 10));
			registrations.push(
				registry().registerSyncDirRule(syncDirRule("second", 20)),
				registry().registerSyncDirRule(syncDirRule("first", 10))
			);

			expect(registry().getRules().map(({ id }) => id)).toEqual(["build"]);
			expect(registry().getSyncDirRules().map(({ id }) => id)).toEqual([
				"first",
				"second",
			]);
		});

		it("should throw when the id is already registered", () => {
			registrations.push(
				registry().registerSyncDirRule(syncDirRule("twice", 10))
			);

			expect(() =>
				registry().registerSyncDirRule(syncDirRule("twice", 20))
			).toThrow('Sync dir rule "twice" is already registered.');
		});
	});
});
