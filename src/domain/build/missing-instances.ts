import { compareStrings } from "../../base/collections.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { InstanceMap, instanceKey } from "../rojo/rojo-project.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";

/** An instance that two or more sets of variants or modes claim and no file is left to give. */
export interface MissingInstance {
	readonly instance: string;
	/** The variants and modes that give it, sorted. */
	readonly variants: readonly string[];
}

const LISTED = 10;

/** Finds the instances a config's switches leave empty, which only the names of its files decide. */
export class MissingInstances {
	constructor(private readonly placement: Placement) {}

	/** One warning per kind of gap: variants alone leave a file out, or a mode does. */
	diagnostics(): Diagnostic[] {
		const { config } = this.placement;
		const missing = this.find();
		const ofMode = (gap: MissingInstance) =>
			gap.variants.some((key) => config.keys.isMode(key));
		return [
			this.variantGaps(missing.filter((gap) => !ofMode(gap))),
			this.modeGaps(missing.filter(ofMode)),
		].flatMap((diagnostic) => diagnostic ?? []);
	}

	/** One warning for the gaps in a mode the build isn't in, told as the mode's since its switches decide them, except those of `known` instances, which another warning already reports. */
	modeDiagnostics(known: ReadonlySet<string>): Diagnostic[] {
		const missing = this.find().filter(
			({ instance }) => !known.has(instance)
		);
		const gap = this.modeGaps(missing);
		return gap ? [gap] : [];
	}

	private variantGaps(
		missing: readonly MissingInstance[]
	): Diagnostic | undefined {
		if (missing.length === 0) return undefined;
		const many = missing.length > 1;
		return warningDiagnostic(
			"variant.noneActive",
			{ resource: this.placement.config.file },
			[
				`${missing.length} ${many ? "instances are" : "instance is"} missing, because none of the variants that give ${many ? "them" : "it"} is on:`,
				...MissingInstances.listed(missing),
				`Turn one of ${many ? "each one's" : "its"} variants on, or add a plain file.`,
			].join("\n")
		);
	}

	private modeGaps(
		missing: readonly MissingInstance[]
	): Diagnostic | undefined {
		if (missing.length === 0) return undefined;
		const { config } = this.placement;
		const many = missing.length > 1;
		return warningDiagnostic(
			"mode.missingInstance",
			{ resource: config.file },
			[
				`in mode "${config.mode}", ${missing.length} ${many ? "instances are" : "instance is"} missing, because no file that gives ${many ? "them" : "it"} applies:`,
				...MissingInstances.listed(missing),
				`Add a file for "${config.mode}" to ${many ? "each" : "it"}, or a plain file.`,
			].join("\n")
		);
	}

	private static listed(missing: readonly MissingInstance[]): string[] {
		const lines = missing
			.slice(0, LISTED)
			.map(
				({ instance, variants }) =>
					`  ${instance} (${variants.join(", ")})`
			);
		const unlisted = missing.length - lines.length;
		return unlisted > 0
			? [...lines, `  ${unlisted} more like it aren't listed.`]
			: lines;
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
