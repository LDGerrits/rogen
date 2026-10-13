import { compareStrings } from "../../base/collections.js";
import { unlistedNote } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

/** An instance that two or more sets of variants claim and no file is left to give. */
export interface MissingInstance {
	readonly instance: string;
	/** The variants that give it, sorted. */
	readonly variants: readonly string[];
}

const LISTED = 10;

/** Finds the instances a config's switches leave empty, which only the names of its files decide. */
export class MissingInstances {
	constructor(private readonly placement: Placement) {}

	/** One warning when variants alone leave an instance without a file. */
	diagnostics(): Diagnostic[] {
		const missing = this.find();
		if (missing.length === 0) return [];
		const many = missing.length > 1;
		return [
			warningDiagnostic(
				"variant.noneActive",
				{ resource: this.placement.config.file },
				[
					`${missing.length} ${many ? "instances are" : "instance is"} missing, because none of the variants that give ${many ? "them" : "it"} is on:`,
					...MissingInstances.listed(missing),
					`Turn one of ${many ? "each one's" : "its"} variants on, or add a plain file.`,
				].join("\n")
			),
		];
	}

	private static listed(missing: readonly MissingInstance[]): string[] {
		const lines = missing
			.slice(0, LISTED)
			.map(
				({ instance, variants }) =>
					`  ${instance} (${variants.join(", ")})`
			);
		const unlisted = missing.length - lines.length;
		return unlisted > 0 ? [...lines, `  ${unlistedNote(unlisted)}`] : lines;
	}

	/** The outermost such instances, sorted. */
	find(): MissingInstance[] {
		const { config } = this.placement;
		const givers = new InstanceMap<RoutedFile[]>();
		for (const file of this.placement.routed)
			for (const node of [
				...file.folderNodes.map(({ instancePath }) => instancePath),
				file.instancePath,
			]) {
				const files = givers.get(node) ?? [];
				files.push(file);
				givers.set(node, files);
			}

		const missing: (readonly string[])[] = [];
		const result: { instance: string; variants: string[] }[] = [];
		for (const [node, files] of [...givers].sort(
			([a], [b]) => a.length - b.length
		)) {
			const underMissing = missing.some((outer) =>
				outer.every((segment, index) => node[index] === segment)
			);
			if (
				underMissing ||
				files.some(({ variants }) => config.allVariantsOn(variants))
			)
				continue;
			const claims = files.map((file) =>
				file.variants
					.filter((_, index) =>
						isSamePath(file.variantNodes[index], node)
					)
					.map(({ variant }) => variant)
					.sort()
			);
			const alternatives = new Set(
				claims
					.filter((variants) => variants.length > 0)
					.map((variants) => variants.join("."))
			);
			if (alternatives.size < 2) continue;
			missing.push(node);
			result.push({
				instance: instanceKey(node),
				variants: [...new Set(claims.flat())].sort(compareStrings),
			});
		}
		return result.sort((a, b) => compareStrings(a.instance, b.instance));
	}
}

const isSamePath = (a: readonly string[], b: readonly string[]) =>
	instanceKey(a) === instanceKey(b);
