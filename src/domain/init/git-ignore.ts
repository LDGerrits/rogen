import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";

const GIT_IGNORE = ".gitignore";
const HEADING = "# Written by Rogen from rogen.json";

/** The `.gitignore` of the folder `init` writes into, which takes the files Rogen writes from `rogen.json`. */
export class GitIgnore {
	/** `text` is the file's, or `undefined` when there is none. */
	constructor(private readonly text: string | undefined) {}

	/** Reads the `.gitignore` in `directory`. `inRepo` is false when the folder is not in a git repository and has none, which leaves nothing to ignore files in. */
	static async read(
		fileReader: FileReader,
		directory: string
	): Promise<{ readonly gitIgnore: GitIgnore; readonly inRepo: boolean }> {
		const file = path.join(directory, GIT_IGNORE);
		const exists = await fileReader.isFile(file);
		return {
			gitIgnore: new GitIgnore(
				exists ? await fileReader.readFile(file) : undefined
			),
			inRepo:
				exists || (await GitIgnore.insideRepo(fileReader, directory)),
		};
	}

	private static async insideRepo(
		fileReader: FileReader,
		directory: string
	): Promise<boolean> {
		for (let folder = directory; ; folder = path.dirname(folder)) {
			if (await fileReader.exists(path.join(folder, ".git"))) return true;
			if (path.dirname(folder) === folder) return false;
		}
	}

	/** The file with the `fileNames` it doesn't ignore yet added at its end, each anchored to this folder, or `undefined` when it ignores them all. */
	planned(fileNames: readonly string[]): PlannedFile | undefined {
		const ignored = new Set(
			(this.text ?? "")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line !== "" && !/^[#!]/.test(line))
				.map((line) => line.replace(/^\//, ""))
		);
		const missing = fileNames.filter((name) => !ignored.has(name));
		if (missing.length === 0) return undefined;

		const added = [HEADING, ...missing.map((name) => `/${name}`)];
		if (this.text === undefined)
			return {
				fileName: GIT_IGNORE,
				content: `${added.join("\n")}\n`,
			};
		const eol = this.text.includes("\r\n") ? "\r\n" : "\n";
		const gap =
			this.text === "" || this.text.endsWith("\n") ? eol : eol + eol;
		return {
			fileName: GIT_IGNORE,
			content: `${this.text}${this.text === "" ? "" : gap}${added.join(eol)}${eol}`,
			addition: "the files Rogen writes",
		};
	}
}
