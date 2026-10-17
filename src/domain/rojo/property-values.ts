import { compareStrings } from "../../base/collections.js";
import { isObject } from "../../base/objects.js";

/** A number Rojo writes as a float: `1.0` for what is whole, and `1e16` where Rust would. */
export class FloatText {
	constructor(
		readonly value: number,
		readonly bits: 32 | 64
	) {}

	/** The shortest text that reads back as the same float, in Rust's form. */
	toString(): string {
		const { value: raw, bits } = this;
		if (!Number.isFinite(raw)) return JSON.stringify(raw);
		if (raw === 0) return Object.is(raw, -0) ? "-0.0" : "0.0";
		const value = bits === 32 ? Math.fround(raw) : raw;
		const sign = value < 0 ? "-" : "";
		const [mantissa, exponent] = FloatText.shortest(
			Math.abs(value),
			bits
		).split("e");
		const digits = mantissa.replace(".", "");
		const power = Number(exponent);
		const beforePoint = power + 1;
		const [lowest, highest] = bits === 32 ? [-6, 13] : [-5, 16];
		if (beforePoint <= lowest || beforePoint > highest)
			return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${power}`;
		if (beforePoint <= 0)
			return `${sign}0.${"0".repeat(-beforePoint)}${digits}`;
		if (digits.length <= beforePoint)
			return `${sign}${digits}${"0".repeat(beforePoint - digits.length)}.0`;
		return `${sign}${digits.slice(0, beforePoint)}.${digits.slice(beforePoint)}`;
	}

	private static shortest(magnitude: number, bits: 32 | 64): string {
		if (bits === 64) return magnitude.toExponential();
		for (let digits = 0; digits < 9; digits++) {
			const text = magnitude.toExponential(digits);
			if (Math.fround(Number(text)) === magnitude) return text;
		}
		return magnitude.toExponential(8);
	}
}

/** How the numbers of one type are written: a float of 32 or 64 bits, an integer, or the parts of a list or record. */
type Shape =
	| "f32"
	| "f64"
	| { readonly list: Shape }
	| { readonly tuple: readonly Shape[] }
	| {
			readonly record: readonly (readonly [string, Shape?])[];
			/** Keys Rojo adds when the value has none. */
			readonly adds?: Readonly<Record<string, unknown>>;
	  };

const F32: Shape = "f32";
const FLOATS: Shape = { list: F32 };
const UDIM: Shape = { tuple: [F32] };

const CFRAME: Shape = {
	record: [
		["position", FLOATS],
		["orientation", { list: FLOATS }],
	],
};

/** The types Rojo reads as `{ "Type": value }`, by their numbers; a type left out is written as it was given. */
const SHAPES: Readonly<Record<string, Shape>> = {
	Float32: F32,
	Float64: "f64",
	Vector2: FLOATS,
	Vector3: FLOATS,
	Color3: FLOATS,
	NumberRange: FLOATS,
	UDim: UDIM,
	UDim2: { list: UDIM },
	Rect: { list: FLOATS },
	Region3: { list: FLOATS },
	Ray: {
		record: [
			["origin", FLOATS],
			["direction", FLOATS],
		],
	},
	CFrame: CFRAME,
	OptionalCFrame: CFRAME,
	NumberSequence: {
		record: [
			[
				"keypoints",
				{
					list: {
						record: [
							["time", F32],
							["value", F32],
							["envelope", F32],
						],
					},
				},
			],
		],
	},
	ColorSequence: {
		record: [
			[
				"keypoints",
				{
					list: {
						record: [
							["time", F32],
							["color", FLOATS],
						],
					},
				},
			],
		],
	},
	Font: {
		record: [["family"], ["weight"], ["style"], ["cachedFaceId"]],
		adds: { cachedFaceId: null },
	},
};

/** The types Rojo reads as `{ "Type": value }` that have only whole numbers or none, which it writes as they are. */
const WHOLE_TYPES = new Set([
	"Axes",
	"BinaryString",
	"Bool",
	"BrickColor",
	"Color3uint8",
	"Content",
	"Enum",
	"Faces",
	"Int32",
	"Int64",
	"Region3int16",
	"SecurityCapabilities",
	"SharedString",
	"String",
	"Tags",
	"UniqueId",
	"Vector2int16",
	"Vector3int16",
]);

const ATTRIBUTES = "Attributes";

/** The values of a node's `$properties` and `$attributes` as Rojo writes them: numbers as floats where Rojo reads them as floats. */
export class PropertyValues {
	/** `values`, a `$properties` or `$attributes` table, with each value typed; the entries stay in the order given. */
	static typed(values: Record<string, unknown>): Record<string, unknown> {
		return Object.fromEntries(
			Object.entries(values).map(([name, value]) => [
				name,
				name === ATTRIBUTES &&
				isObject(value) &&
				!PropertyValues.isTyped(value)
					? PropertyValues.attributes(value)
					: PropertyValues.value(value),
			])
		);
	}

	private static isTyped(value: Record<string, unknown>): boolean {
		const keys = Object.keys(value);
		return (
			keys.length === 1 &&
			(Object.hasOwn(SHAPES, keys[0]) ||
				WHOLE_TYPES.has(keys[0]) ||
				keys[0] === ATTRIBUTES)
		);
	}

	/** A value written bare is a 64-bit float when it is a number; one written `{ "Type": value }` follows its type. */
	private static value(value: unknown): unknown {
		if (typeof value === "number") return new FloatText(value, 64);
		if (Array.isArray(value))
			return value.map((entry) => PropertyValues.value(entry));
		if (!isObject(value) || !PropertyValues.isTyped(value)) return value;
		const [type] = Object.keys(value);
		const inner = value[type];
		if (type === ATTRIBUTES)
			return { [type]: PropertyValues.attributes(inner) };
		return {
			[type]:
				type in SHAPES
					? PropertyValues.shape(inner, SHAPES[type])
					: inner,
		};
	}

	/** A table of attributes, sorted by name as Rojo writes it, each value typed. */
	private static attributes(value: unknown): unknown {
		if (!isObject(value)) return value;
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareStrings)
				.map((name) => [name, PropertyValues.value(value[name])])
		);
	}

	private static shape(value: unknown, shape: Shape): unknown {
		if (shape === "f32" || shape === "f64")
			return typeof value === "number"
				? new FloatText(value, shape === "f32" ? 32 : 64)
				: value;
		if ("list" in shape)
			return Array.isArray(value)
				? value.map((entry) => PropertyValues.shape(entry, shape.list))
				: value;
		if ("tuple" in shape)
			return Array.isArray(value)
				? value.map((entry, at) =>
						at < shape.tuple.length
							? PropertyValues.shape(entry, shape.tuple[at])
							: entry
					)
				: value;
		if (!isObject(value)) return value;
		const whole = { ...shape.adds, ...value };
		const known = shape.record.map(([key]) => key);
		return Object.fromEntries([
			...shape.record
				.filter(([key]) => key in whole)
				.map(([key, part]) => [
					key,
					part ? PropertyValues.shape(whole[key], part) : whole[key],
				]),
			...Object.entries(whole).filter(([key]) => !known.includes(key)),
		]);
	}
}
