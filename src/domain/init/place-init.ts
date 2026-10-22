import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { toPosix } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT,
	DEFAULT_SOURCE_PATH,
	RogenConfig,
	RogenKeys,
	configFileContent,
	configFileName,
} from "../config/config.js";
import { RojoNode } from "../rojo/rojo-project.js";
import { Darklua, PlannedFile } from "../toolchain/toolchain.js";
import { InitPlan } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";
import { PROCESSED_OUTPUT, RELEASE_OUTPUT } from "./output-configs.js";
import {
	PLACE_SOURCE_PATHS,
	PLACES_FOLDER,
	SHARED_FOLDER,
} from "./starter-places.js";
import { WorkspaceFiles } from "./workspace-files.js";

const TSCONFIG = "tsconfig.json";

interface Model {
	/** The folder of the place the new one copies. */
	readonly folder: string;
	readonly config: Record<string, unknown>;
}

/** A place added below a `places` folder that has one already: a complete `default.rogen.json` copied from the first place that has one, beside the files that place has for its toolchain. */
export class PlaceInit {
	private readonly workspaces: WorkspaceFiles;

	constructor(
		private readonly fileReader: FileReader,
		private readonly questions: InitQuestions,
		/** The folder the user ran in, which the plan's config paths are relative to. */
		private readonly cwd: string
	) {
		this.workspaces = new WorkspaceFiles(fileReader);
	}

	/** The plan to add `folder` as a place, or `undefined` when it is not a new folder in a `places` folder with a place to copy. */
	async plan(folder: string): Promise<InitPlan | undefined> {
		const places = path.dirname(folder);
		if (path.basename(places) !== PLACES_FOLDER) return undefined;
		if ((await this.configIn(folder, DEFAULT_PROJECT)) !== undefined)
			return undefined;
		const model = await this.modelIn(places, folder);
		if (!model) return undefined;

		const root = path.dirname(places);
		const place = toPosix(path.relative(root, folder));
		const shared = await this.fileReader.isDirectory(
			path.join(places, SHARED_FOLDER)
		);
		const sourcePaths = shared
			? [...PLACE_SOURCE_PATHS]
			: [DEFAULT_SOURCE_PATH];
		const source = path.posix.join(place, DEFAULT_SOURCE_PATH);
		const base = this.copyOf(model, path.basename(folder), sourcePaths);

		const outputs = await this.outputsOf(model, base);
		const copied = await this.copiedFiles(model, place);
		const workspace = await this.workspaces.append(root, place);
		const compiled = base.rogen?.compiledPath;
		const processed = outputs.find(({ stem }) => stem === PROCESSED_OUTPUT)
			?.config.rogen?.compiledPath;
		const serve = processed
			? path.posix.join(place, configFileName(PROCESSED_OUTPUT))
			: place;
		const compile = copied.some(({ fileName }) =>
			fileName.endsWith(TSCONFIG)
		);
		const ignored = await this.ignoreHint(root, place, [
			...(compile ? ["out", "include"] : []),
			...(processed ? [processed] : []),
		]);
		const configFile = path.posix.join(place, DEFAULT_CONFIG_FILE);

		return {
			directory: root,
			purpose: "create",
			summary: [
				{ area: "Place", text: place },
				{ area: "Code", text: [...sourcePaths].join(", ") },
			],
			files: [
				{
					fileName: configFile,
					content: configFileContent(base),
				},
				...outputs.map(({ stem, config }) => ({
					fileName: path.posix.join(place, configFileName(stem)),
					content: configFileContent(config),
				})),
				...copied,
				...workspace.files,
			],
			directories: [source],
			commands: [],
			configs: [
				toPosix(path.relative(this.cwd, path.join(root, configFile))),
			],
			warnings: [],
			notes: [
				`Copied the ${joinedWithAnd(["routes", ...(compiled ? ["compiled path"] : []), ...(base.tree ? ["tree"] : [])])} of ${toPosix(path.relative(root, model.folder))}.`,
				...workspace.notes,
			],
			nextSteps: {
				setup: [],
				run: [
					...(compile ? [`rbxtsc -w -p ${place}`] : []),
					...(processed
						? new Darklua()
								.processCommands(
									folder,
									compile ? [compiled ?? "out"] : sourcePaths,
									processed
								)
								.map((command) => `cd ${place} && ${command}`)
						: []),
					`rogen serve ${serve}`,
				],
				edits: [
					...(ignored ? [ignored] : []),
					...(compile
						? [
								`Add rbxtsc -p ${place} and rbxtsc -w -p ${place} to the build and watch scripts in package.json, so 'npm run watch' compiles it too.`,
							]
						: []),
					`Put the code of ${path.basename(folder)} in ${source}. A second place is served from a second terminal with its own --port: 'rogen serve ${serve} --port <port>'.`,
				],
			},
			asked: this.questions.interactive,
			decided: this.questions.decided,
			present: [],
			gitInit: false,
		};
	}

	/** The config of the project file `stem` in `folder`, in either extension. */
	private async configIn(
		folder: string,
		stem: string
	): Promise<string | undefined> {
		const name = configFileName(stem);
		for (const candidate of [name, `${name}c`]) {
			const file = path.join(folder, candidate);
			if (await this.fileReader.isFile(file)) return file;
		}
		return undefined;
	}

	private async read(
		file: string
	): Promise<Record<string, unknown> | undefined> {
		const text = await tryWithAsync(() => this.fileReader.readFile(file));
		const parsed = text.isOk() ? parse(text.value) : undefined;
		return parsed?.isOk() && isObject(parsed.value)
			? parsed.value
			: undefined;
	}

	/** The first place beside `folder`, in name order, whose default config parses; the shared code is not one. */
	private async modelIn(
		places: string,
		folder: string
	): Promise<Model | undefined> {
		const entries = await tryWithAsync(() =>
			this.fileReader.readDirectory(places)
		);
		if (entries.isErr()) return undefined;
		for (const [name, type] of entries.value) {
			if (!isDirectoryType(type) || name === SHARED_FOLDER) continue;
			const sibling = path.join(places, name);
			if (sibling === folder) continue;
			const file = await this.configIn(sibling, DEFAULT_PROJECT);
			const config = file ? await this.read(file) : undefined;
			if (config) return { folder: sibling, config };
		}
		return undefined;
	}

	private copyOf(
		{ config }: Model,
		name: string,
		sourcePaths: readonly string[]
	): RogenConfig {
		const rogen = isObject(config.rogen) ? config.rogen : {};
		const { routes, compiledPath } = rogen as RogenKeys;
		const keys: RogenKeys = {
			sourcePaths: [...sourcePaths],
			...(routes && { routes }),
			...(compiledPath && { compiledPath }),
		};
		return {
			name,
			...(isObject(config.tree) && { tree: config.tree as RojoNode }),
			rogen: keys,
		};
	}

	/** `dist` and `release` for the new place when the model has them, each as the model's with the new place's keys. */
	private async outputsOf(
		model: Model,
		base: RogenConfig
	): Promise<{ stem: string; config: RogenConfig }[]> {
		const outputs: { stem: string; config: RogenConfig }[] = [];
		for (const stem of [PROCESSED_OUTPUT, RELEASE_OUTPUT]) {
			const file = await this.configIn(model.folder, stem);
			const twin = file ? await this.read(file) : undefined;
			if (!twin) continue;
			const rogen = isObject(twin.rogen) ? (twin.rogen as RogenKeys) : {};
			outputs.push({
				stem,
				config: {
					...base,
					rogen: {
						...base.rogen,
						...(rogen.compiledPath && {
							compiledPath: rogen.compiledPath,
						}),
					},
					...(Array.isArray(twin.globIgnorePaths) && {
						globIgnorePaths: twin.globIgnorePaths as string[],
					}),
				},
			});
		}
		return outputs;
	}

	/** The files the model has for the toolchain of its code, which are the same in a place at the same depth. */
	private async copiedFiles(
		model: Model,
		place: string
	): Promise<PlannedFile[]> {
		const copied: PlannedFile[] = [];
		for (const name of [TSCONFIG, ...new Darklua().configFiles]) {
			const file = path.join(model.folder, name);
			if (await this.fileReader.isFile(file))
				copied.push({
					fileName: path.posix.join(place, name),
					content: await this.fileReader.readFile(file),
				});
		}
		return copied;
	}

	/** What to add to the `.gitignore` of the root so what a toolchain writes into `place` stays out of git, which init never edits; none when it lists them or there is none. */
	private async ignoreHint(
		root: string,
		place: string,
		folders: readonly string[]
	): Promise<string | undefined> {
		if (folders.length === 0) return undefined;
		const text = await tryWithAsync(() =>
			this.fileReader.readFile(path.join(root, ".gitignore"))
		);
		if (text.isErr()) return undefined;
		const missing = folders.filter(
			(folder) =>
				![
					`${place}/${folder}`,
					`${path.posix.dirname(place)}/*/${folder}`,
				].some((line) => text.value.includes(line))
		);
		return missing.length === 0
			? undefined
			: `Add ${missing.map((folder) => `${place}/${folder}`).join(" and ")} to .gitignore so what is built into ${missing.length === 1 ? "it" : "them"} isn't committed.`;
	}
}
