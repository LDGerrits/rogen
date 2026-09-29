import { Disposable } from "../../../../base/disposable.js";
import { BuildRule, RuleRegistry, SyncDirRule } from "../rule-registry.js";

export class MockRuleRegistry implements RuleRegistry {
	constructor(
		private readonly rules: BuildRule[] = [],
		private readonly syncDirRules: SyncDirRule[] = []
	) {}

	registerRule(rule: BuildRule): Disposable {
		this.rules.push(rule);
		return { [Symbol.dispose]: () => undefined };
	}

	registerSyncDirRule(rule: SyncDirRule): Disposable {
		this.syncDirRules.push(rule);
		return { [Symbol.dispose]: () => undefined };
	}

	getRules(): readonly BuildRule[] {
		return this.rules;
	}

	getSyncDirRules(): readonly SyncDirRule[] {
		return this.syncDirRules;
	}
}
