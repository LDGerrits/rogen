import path from "path";
import { compareStrings } from "../../base/collections.js";
import { formatJsonFile } from "../../base/json.js";
import { insertJsoncItem, parseJsonc } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir, samePath } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";

const WORKSPACE_SUFFIX = ".code-workspace";

interface Listed {
	readonly paths: readonly string[];
	readonly text: string;
}

/** The editor workspace files of a project: luau-lsp runs one server per folder, so each place has to be one. */
export class WorkspaceFiles {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** `folders`: the root's places, sorted, with `place` among them. */
	async plan(
		root: string,
		folders: readonly string[],
		place: string
	): Promise<{ files: PlannedFile[]; notes: string[] }> {
		const names = (await this.fileSystemService.readDirectory(root))
			.map(([name]) => name)
			.filter((name) => name.endsWith(WORKSPACE_SUFFIX))
			.sort(compareStrings);
		if (names.length === 0)
			return {
				files: [
					{
						fileName: `${path.basename(root)}${WORKSPACE_SUFFIX}`,
						content: formatJsonFile({
							folders: [
								{ path: "." },
								...folders.map((one) => ({ path: one })),
							],
						}),
					},
				],
				notes: [],
			};
		const files: PlannedFile[] = [];
		const notes: string[] = [];
		for (const name of names) {
			const listed = await this.listed(path.join(root, name));
			const rootAt = listed?.paths.findIndex((one) =>
				samePath(path.resolve(root, one), root)
			);
			if (!listed || rootAt === undefined || rootAt < 0) {
				notes.push(
					`${name} is there already: add the folder "${place}" to ${name} so the editor runs a language server for the place.`
				);
				continue;
			}
			if (listed.paths.some((one) => normalizeDir(one) === place))
				continue;
			const after = listed.paths.findIndex(
				(one, index) =>
					index > rootAt &&
					compareStrings(normalizeDir(one), place) > 0
			);
			files.push({
				fileName: name,
				content: insertJsoncItem(
					listed.text,
					["folders"],
					after < 0 ? listed.paths.length : after,
					{ path: place }
				),
				addition: place,
			});
		}
		return { files, notes };
	}

	/** The paths the file lists, or `undefined` when it isn't a workspace file Rogen can edit. */
	private async listed(file: string): Promise<Listed | undefined> {
		const text = await this.fileSystemService.readFile(file);
		const { value, errors } = parseJsonc(text);
		if (errors.length > 0 || !isObject(value)) return undefined;
		const { folders } = value;
		if (!Array.isArray(folders)) return undefined;
		return {
			text,
			paths: folders.map((one) =>
				isObject(one) && typeof one.path === "string" ? one.path : ""
			),
		};
	}
}
