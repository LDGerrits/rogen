import { parse, setJsoncValue } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { ROGEN_BLOCK } from "../config/config.js";
import { PlannedFile } from "../toolchain/toolchain.js";

/** A `default.rogen.json` being changed through the jsonc editor, so its comments, key order and formatting stay. Each change is named as `added routes.ServerStorage`. */
export class ConfigEdit {
	private text: string;
	private current: Record<string, unknown>;
	readonly changes: string[] = [];

	private constructor(
		readonly fileName: string,
		text: string,
		current: Record<string, unknown>
	) {
		this.text = text;
		this.current = current;
	}

	/** `undefined` when the text isn't a JSON object. */
	static of(fileName: string, text: string): ConfigEdit | undefined {
		const parsed = parse(text);
		return parsed.isOk() && isObject(parsed.value)
			? new ConfigEdit(fileName, text, parsed.value)
			: undefined;
	}

	get value(): Readonly<Record<string, unknown>> {
		return this.current;
	}

	valueAt(at: readonly string[]): unknown {
		let found: unknown = this.current;
		for (const key of at) {
			if (!isObject(found)) return undefined;
			found = found[key];
		}
		return found;
	}

	/** Sets the value at `at`, creating the objects above it. `change` names it when the key alone doesn't, as `added sourcePaths lib`. */
	set(at: readonly string[], value: unknown, change?: string): void {
		const before = this.valueAt(at);
		this.write(at, value);
		this.changes.push(
			change ??
				`${before === undefined ? "added" : "changed"} ${ConfigEdit.named(at)}`
		);
	}

	remove(at: readonly string[], change?: string): void {
		this.write(at, undefined);
		this.changes.push(change ?? `removed ${ConfigEdit.named(at)}`);
	}

	/** A key of the `rogen` block is named without the block. */
	private static named(at: readonly string[]): string {
		return (at[0] === ROGEN_BLOCK ? at.slice(1) : at).join(".");
	}

	private write(at: readonly string[], value: unknown): void {
		this.text = setJsoncValue(this.text, at, value);
		const parsed = parse(this.text);
		if (parsed.isOk() && isObject(parsed.value))
			this.current = parsed.value;
	}

	/** The file with the changes, or `undefined` when there are none. */
	get planned(): PlannedFile | undefined {
		return this.changes.length === 0
			? undefined
			: {
					fileName: this.fileName,
					content: this.text,
					addition: this.changes.join(", "),
					changes: [...this.changes],
				};
	}
}
