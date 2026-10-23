import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { Registry } from "../../platform/registry/registry.js";
import "../build/build-command.js";
import "../check/check-command.js";
import "../fmt-project/fmt-project-command.js";
import "../help/doc-command.js";
import "../help/help-command.js";
import "../init/init-command.js";
import "../plugin/plugin-command.js";
import "../serve/serve-command.js";
import "../sourcemap/sourcemap-command.js";
import "../syncback/syncback-command.js";
import "../upload/upload-command.js";
import "../where/where-command.js";
import "../write/write-command.js";

interface Field {
	readonly command: string;
	readonly key: string;
	readonly shape: OutputShape;
}

const commands = [
	...Registry.as<CommandRegistry>(Extensions.Commands).getCommands().values(),
];

const objectsOf = (shape: OutputShape): ReadonlyMap<string, OutputShape>[] => {
	switch (shape.kind) {
		case "named":
			return objectsOf(shape.shape);
		case "array":
		case "record":
			return objectsOf(shape.of);
		case "union":
			return shape.of.flatMap(objectsOf);
		case "object":
			return [
				new Map(
					Object.entries(shape.fields).map(([key, field]) => [
						key,
						field.kind === "optional" ? field.of : field,
					])
				),
				...Object.values(shape.fields).flatMap((field) =>
					objectsOf(field.kind === "optional" ? field.of : field)
				),
			];
		default:
			return [];
	}
};

const fieldsOf = (shape: OutputShape, command: string): Field[] =>
	objectsOf(shape).flatMap((fields) =>
		[...fields].map(([key, value]) => ({ command, key, shape: value }))
	);

const declared = commands.flatMap(({ id, metadata }) =>
	[metadata.output?.document, metadata.output?.lines]
		.filter((shape) => shape !== undefined)
		.map((shape) => ({ command: id, shape }))
);

const allFields = declared.flatMap(({ command, shape }) =>
	fieldsOf(shape, command)
);

const enumValues = (shape: OutputShape): string[] => {
	switch (shape.kind) {
		case "enum":
			return [...shape.values];
		case "named":
			return enumValues(shape.shape);
		case "array":
		case "record":
			return enumValues(shape.of);
		case "union":
			return shape.of.flatMap(enumValues);
		case "object":
			return Object.values(shape.fields).flatMap((field) =>
				enumValues(field.kind === "optional" ? field.of : field)
			);
		default:
			return [];
	}
};

const namedAs = (name: string, shape: OutputShape): boolean => {
	switch (shape.kind) {
		case "named":
			return shape.name === name;
		case "union":
			return shape.of.some((one) => namedAs(name, one));
		case "array":
			return namedAs(name, shape.of);
		default:
			return false;
	}
};

const keysHolding = (name: string) => [
	...new Set(
		allFields
			.filter(({ shape }) => namedAs(name, shape))
			.map(({ key }) => key)
	),
];

const keysOf = (command: string) =>
	new Set(
		allFields
			.filter((field) => field.command === command)
			.map(({ key }) => key)
	);

describe("the JSON vocabulary of the commands", () => {
	it("should find the commands that print JSON, Rojo's verbs and Rogen's alike", () => {
		expect(declared.map(({ command }) => command)).toEqual(
			expect.arrayContaining([
				"build",
				"write",
				"check",
				"where",
				"syncback",
				"serve",
				"sourcemap",
				"upload",
				"init",
				"plugin",
			])
		);
	});

	it("should name a run of Rojo rojo, and nothing else", () => {
		expect(keysHolding("RojoEntry")).toEqual(["rojo"]);
		for (const command of ["build", "sourcemap", "upload"])
			expect(keysOf(command)).toContain("rojo");
		expect(allFields.map(({ key }) => key)).not.toContain("sourcemaps");
	});

	it("should name a config by one field, config, which no entry repeats as file", () => {
		const entries = declared.flatMap(({ shape }) => objectsOf(shape));

		expect(allFields.map(({ key }) => key)).toContain("config");
		expect(entries.filter((fields) => fields.has("config"))).not.toEqual(
			[]
		);
		expect(
			entries.filter(
				(fields) => fields.has("config") && fields.has("file")
			)
		).toEqual([]);
	});

	it("should say wouldWrite for a dry run in every command that has one", () => {
		const values = declared.flatMap(({ shape }) => enumValues(shape));

		expect(values).not.toContain("planned");
		for (const command of ["init", "syncback", "build", "write"]) {
			const own = declared
				.filter((one) => one.command === command)
				.flatMap(({ shape }) => enumValues(shape));
			expect(own).toContain("wouldWrite");
		}
	});

	it("should leave out the field that names the server, since only Rojo serves", () => {
		expect(keysOf("serve")).not.toContain("server");
	});
});
