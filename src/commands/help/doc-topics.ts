import { UsageError } from "../../base/errors.js";
import { closestMatch } from "../../base/strings.js";
import { helpTexts } from "./help-texts.js";

/** The topics `rogen doc` prints offline. */
export class DocTopics {
	static readonly NAMES: readonly string[] = [
		"routing",
		"config",
		"layout",
		"output",
	];

	static has(name: string): boolean {
		return DocTopics.NAMES.includes(name.toLowerCase());
	}

	static textOf(name: string): string | undefined {
		return DocTopics.has(name)
			? helpTexts.topics[name.toLowerCase()]
			: undefined;
	}

	static unknown(name: string): UsageError {
		const closest = closestMatch(name, DocTopics.NAMES);
		return new UsageError(
			closest
				? `Unknown topic "${name}". Did you mean 'rogen doc ${closest}'?`
				: `Unknown topic "${name}". The topics are ${DocTopics.NAMES.join(", ")}.`
		);
	}
}
