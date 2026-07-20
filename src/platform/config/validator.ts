import { Result, ok, err } from "../../base/result.js";
import { RojoTree } from "../rojo/tree.js";
import { CoreConfigKeys, ResolvedConfig } from "./config.js";
import { IValidationRule } from "./rules/rule.js";

const VALID_KEYS_MAP: Record<CoreConfigKeys, true> = {
	source: true,
	verbatim: true,
	casing: true,
	unwrap: true,
	aliases: true,
	globIgnorePaths: true,
	luau: true,
	ts: true,
	darklua: true,
	template: true,
};

export const VALID_KEYS = Object.keys(VALID_KEYS_MAP);

export function isValidRojoTree(value: unknown): value is RojoTree {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;

	return (
		typeof record.name === "string" &&
		typeof record.tree === "object" &&
		record.tree !== null &&
		!Array.isArray(record.tree)
	);
}

export class ConfigValidator {
	private rules: IValidationRule[] = [];

	addRule(rule: IValidationRule): this {
		this.rules.push(rule);
		return this;
	}

	validate(raw: Record<string, unknown>): Result<ResolvedConfig, Error> {
		for (const [key, value] of Object.entries(raw)) {
			const rule = this.rules.find((r) => r.canHandle(key, value));

			if (rule) {
				const result = rule.validate(key, value);
				if (result.isErr()) {
					return err(result.error);
				}
			}
		}

		return ok(raw as unknown as ResolvedConfig);
	}
}
