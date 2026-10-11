import { readFileSync } from "fs";
import path from "path";
import Ajv from "ajv";
import { RojoProjectFile } from "../rojo-project.js";

const schema = JSON.parse(
	readFileSync(
		path.resolve("src/domain/rojo/__tests__/project.schema.json"),
		"utf8"
	)
);

const validate = new Ajv.default({ strict: false }).compile(schema);

export function expectRojoProject(tree: RojoProjectFile): void {
	const valid = validate(JSON.parse(JSON.stringify(tree)));
	expect(valid ? [] : validate.errors).toEqual([]);
}
