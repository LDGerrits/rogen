import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { MetaDiagnostics } from "./meta-diagnostics.js";
import { INIT_META_FILE, scanRootDirs } from "./root-scanner.js";

export interface FolderMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;
}

export interface FolderMeta extends FolderMetaFields {
	readonly file: string;
	readonly rootDir: string;
	/** The folder, relative to the root dir; the root dir itself is "". */
	readonly dir: string;
}

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

/** Reads every `init.meta.json` in the root dirs' non-excluded folders; any invalid one fails the whole read. */
export async function readFolderMeta(
	fileSystem: FileSystemService,
	index: IndexService,
	config: Pick<ResolvedConfig, "rootDirs" | "exclude">
): Promise<Result<FolderMeta[], Diagnostic[]>> {
	const metas: FolderMeta[] = [];
	const errors: Diagnostic[] = [];

	for (const root of scanRootDirs(index, config).roots) {
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

	return errors.length > 0 ? err(errors) : ok(metas);
}

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
