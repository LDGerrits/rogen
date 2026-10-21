import path from "path";
import { compareStrings } from "../../base/collections.js";
import { formatJsonFile } from "../../base/json.js";
import { insertJsoncItem, parseJsonc } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir, samePath, toPosix } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";

const WORKSPACE_SUFFIX = ".code-workspace";

interface Listed {
	/** One per folder entry, `undefined` for an entry with no path of its own, such as a `uri`. */
	readonly paths: readonly (string | undefined)[];
	readonly text: string;
}

/** The editor workspace files of a project: luau-lsp runs one server per folder, so each place has to be one. */
export class WorkspaceFiles {
	constructor(private readonly fileSystemService: FileReader) {}

	/** `folders`: the places and the shared code, sorted. A new project gets a workspace file of them, and one that has a workspace file gets the ones it lacks, in one edit. */
	async planAll(
		root: string,
		folders: readonly string[]
	): Promise<{ files: PlannedFile[]; notes: string[] }> {
		const names = await this.namesIn(root);
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
		return this.editAll(root, names, folders);
	}

	/** The same for one more place of a project: the workspace files that are there get it, and none is made. */
	async append(
		root: string,
		place: string
	): Promise<{ files: PlannedFile[]; notes: string[] }> {
		return this.editAll(root, await this.namesIn(root), [place]);
	}

	private async namesIn(root: string): Promise<string[]> {
		return (await this.fileSystemService.readDirectory(root))
			.map(([name]) => name)
			.filter((name) => name.endsWith(WORKSPACE_SUFFIX))
			.sort(compareStrings);
	}

	private async editAll(
		root: string,
		names: readonly string[],
		places: readonly string[]
	): Promise<{ files: PlannedFile[]; notes: string[] }> {
		const files: PlannedFile[] = [];
		const notes: string[] = [];
		for (const name of names) {
			const listed = await this.listed(path.join(root, name));
			const rootAt = listed?.paths.findIndex(
				(one) => one !== undefined && this.isAt(root, one, root)
			);
			if (!listed || rootAt === undefined || rootAt < 0) {
				notes.push(
					...places.map(
						(place) =>
							`${name} is there already: add the folder "${place}" to ${name} so the editor runs a language server for the place.`
					)
				);
				continue;
			}
			let text = listed.text;
			let paths = [...listed.paths];
			const added: string[] = [];
			for (const place of places) {
				const target = path.resolve(root, place);
				if (
					paths.some(
						(one) =>
							one !== undefined && this.isAt(root, one, target)
					)
				)
					continue;
				const after = paths.findIndex(
					(one, index) =>
						index > rootAt &&
						one !== undefined &&
						compareStrings(normalizeDir(one), place) > 0
				);
				const at = after < 0 ? paths.length : after;
				text = insertJsoncItem(text, ["folders"], at, { path: place });
				paths = [...paths.slice(0, at), place, ...paths.slice(at)];
				added.push(place);
			}
			if (added.length > 0)
				files.push({
					fileName: name,
					content: text,
					addition: added.join(", "),
				});
		}
		return { files, notes };
	}

	/** Whether the folder entry `one` of a workspace file in `root` is `target`, however it is written. */
	private isAt(root: string, one: string, target: string): boolean {
		return samePath(path.resolve(root, toPosix(one)), target);
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
				isObject(one) && typeof one.path === "string"
					? one.path
					: undefined
			),
		};
	}
}
