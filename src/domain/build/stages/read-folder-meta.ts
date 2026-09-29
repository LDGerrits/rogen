import path from "path";
import { ErrorUtils } from "../../../base/errors.js";
import { JsoncNode, parseJsonc } from "../../../base/jsonc.js";
import { toPosix } from "../../../base/path.js";
import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { INIT_META_FILE } from "../../rojo/rojo-files.js";
import {
	AssemblyStage,
	FolderMeta,
	FolderMetaFields,
} from "../build-record.js";
import { MetaDiagnostics } from "../meta-diagnostics.js";

const FIELD_KINDS: Record<keyof FolderMetaFields, JsoncNode["kind"]> = {
	className: "string",
	properties: "object",
	attributes: "object",
	ignoreUnknownInstances: "boolean",
	id: "string",
};

const KIND_NAMES: Record<JsoncNode["kind"], string> = {
	object: "an object",
	array: "an array",
	string: "a string",
	number: "a number",
	boolean: "a boolean",
	null: "null",
};

/** Reads every `init.meta.json` the scan found, which leaves out excluded folders; any invalid one fails the whole read. */
export const readFolderMeta: AssemblyStage = async (build, fileSystem) => {
	const metas: FolderMeta[] = [];
	const errors: Diagnostic[] = [];

	for (const root of build.roots) {
		for (const metaFile of root.metaFiles) {
			if (path.posix.basename(metaFile) !== INIT_META_FILE) continue;
			const file = path.join(root.rootDir, metaFile);
			const parsed = await readMetaFile(fileSystem, file);
			if (parsed.isErr()) {
				errors.push(...parsed.error);
				continue;
			}
			const dir = path.posix.dirname(toPosix(metaFile));
			metas.push({
				file,
				rootDir: root.rootDir,
				dir: dir === "." ? "" : dir,
				...parsed.value,
			});
		}
	}

	return errors.length > 0
		? err(errors)
		: ok({ ...build, folderMeta: metas });
};

async function readMetaFile(
	fileSystem: FileSystemService,
	file: string
): Promise<Result<FolderMetaFields, Diagnostic[]>> {
	let text: string;
	try {
		text = await fileSystem.readFile(file);
	} catch (error) {
		return err([
			MetaDiagnostics.unreadable(
				{ resource: file },
				ErrorUtils.fromUnknown(error).message
			),
		]);
	}

	const { root, value, errors } = parseJsonc(text);
	if (errors.length > 0)
		return err(
			errors.map(({ message, line, column }) =>
				MetaDiagnostics.invalidSyntax(
					{ resource: file, position: { line, column } },
					message
				)
			)
		);
	if (root?.kind !== "object")
		return err([
			MetaDiagnostics.notAnObject({
				resource: file,
				position: { line: 1, column: 1 },
			}),
		]);

	// Rojo ignores fields it doesn't know, such as `$schema`.
	const wrongTypes = root.properties.flatMap((property) => {
		if (!Object.hasOwn(FIELD_KINDS, property.name)) return [];
		const expected = FIELD_KINDS[property.name as keyof FolderMetaFields];
		if (property.value.kind === expected) return [];
		return [
			MetaDiagnostics.wrongType(
				{
					resource: file,
					position: {
						line: property.value.line,
						column: property.value.column,
					},
				},
				property.name,
				KIND_NAMES[expected],
				KIND_NAMES[property.value.kind]
			),
		];
	});
	if (wrongTypes.length > 0) return err(wrongTypes);

	const fields = value as Record<string, unknown>;
	return ok(
		Object.fromEntries(
			Object.keys(FIELD_KINDS)
				.filter((key) => fields[key] !== undefined)
				.map((key) => [key, fields[key]])
		) as FolderMetaFields
	);
}
