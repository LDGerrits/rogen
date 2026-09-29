import { Disposable } from "../../../base/disposable.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { BuildRecord } from "../build-record.js";

/** Reports on a finished build and decides nothing. */
export interface BuildRule {
	/** The rule's file name, unique among build rules. */
	readonly id: string;
	/** Warnings are reported in ascending order, ties broken by id. */
	readonly order: number;
	check(build: BuildRecord): Diagnostic[];
}

/** Reports on what the sync dir holds, which only changes when the compiler runs. */
export interface SyncDirRule {
	/** The rule's file name, unique among sync dir rules. */
	readonly id: string;
	readonly order: number;
	check(
		build: BuildRecord,
		fileSystem: FileSystemService
	): Promise<Diagnostic[]>;
}

export interface RuleRegistry {
	/** @throws Error if `rule.id` is already registered. */
	registerRule(rule: BuildRule): Disposable;
	/** @throws Error if `rule.id` is already registered. */
	registerSyncDirRule(rule: SyncDirRule): Disposable;
	getRules(): readonly BuildRule[];
	getSyncDirRules(): readonly SyncDirRule[];
}

interface Ranked {
	readonly id: string;
	readonly order: number;
}

function register<T extends Ranked>(
	rules: Map<string, T>,
	rule: T,
	label: string
): Disposable {
	if (rules.has(rule.id)) {
		throw new Error(`${label} "${rule.id}" is already registered.`);
	}
	rules.set(rule.id, rule);
	return {
		[Symbol.dispose]: () => {
			if (rules.get(rule.id) === rule) {
				rules.delete(rule.id);
			}
		},
	};
}

function ranked<T extends Ranked>(rules: Map<string, T>): readonly T[] {
	return [...rules.values()].sort(
		(a, b) => a.order - b.order || a.id.localeCompare(b.id)
	);
}

class CoreRuleRegistry implements RuleRegistry {
	private readonly rules = new Map<string, BuildRule>();
	private readonly syncDirRules = new Map<string, SyncDirRule>();

	registerRule(rule: BuildRule): Disposable {
		return register(this.rules, rule, "Rule");
	}

	registerSyncDirRule(rule: SyncDirRule): Disposable {
		return register(this.syncDirRules, rule, "Sync dir rule");
	}

	getRules(): readonly BuildRule[] {
		return ranked(this.rules);
	}

	getSyncDirRules(): readonly SyncDirRule[] {
		return ranked(this.syncDirRules);
	}
}

export const Extensions = {
	Rules: "domain.contributions.buildRules",
};

Registry.add(Extensions.Rules, new CoreRuleRegistry());
