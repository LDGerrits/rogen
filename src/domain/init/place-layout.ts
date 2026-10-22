import path from "path";
import { parse } from "../../base/jsonc.js";
import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir, samePath, toPosix } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_PROJECT,
	DEFAULT_SOURCE_PATH,
	configFileName,
	configStem,
} from "../config/config.js";
import { PROCESSED_OUTPUT, RELEASE_OUTPUT } from "./output-configs.js";
import {
	COMMON_FOLDER,
	PROJECT_SOURCE_PATHS,
	PROJECTS_FOLDER,
	ROOT_COMMON_SOURCE_PATH,
	rootPlaceSourcePath,
} from "./starter-places.js";

/** What a name of a root-level place may hold, since it names a config, a folder and a string in the sample. */
const PLACE_NAME = /^[\w-]+$/;

export type PlaceConfig = Record<string, unknown>;

/** The place a new one copies. */
export interface PlaceModel {
	/** Its config file, and the folder that and its toolchain files are in. */
	readonly file: string;
	readonly folder: string;
	readonly config: PlaceConfig;
	/** Its config for the output `stem`, such as `dist`, when it has one. */
	output(stem: string): Promise<PlaceConfig | undefined>;
}

/** Where a place is added to a workspace that has places: how it is named, where its files go and which place it copies. */
export interface PlaceLayout {
	/** The folder of the workspace, which the plan's paths are relative to. */
	readonly root: string;
	readonly name: string;
	/** The place as `serve` and `build` take it. */
	readonly place: string;
	/** The folder the place's own files are in, relative to the root; empty when they are at the root. */
	readonly folder: string;
	readonly sourcePaths: readonly string[];
	/** The folder of the place's own code, relative to the root. */
	readonly source: string;
	/** Whether the first place was seeded with a script, which the new one is too. */
	readonly seeded: boolean;
	readonly model: PlaceModel;
	/** The config of the place, or of its output `stem`, relative to the root. */
	configFile(stem?: string): string;
}

/** The config `stem` names in `folder`, in either extension. */
async function configIn(
	files: FileReader,
	folder: string,
	stem: string
): Promise<string | undefined> {
	const name = configFileName(stem);
	for (const candidate of [name, `${name}c`]) {
		const file = path.join(folder, candidate);
		if (await files.isFile(file)) return file;
	}
	return undefined;
}

async function read(
	files: FileReader,
	file: string
): Promise<PlaceConfig | undefined> {
	const text = await tryWithAsync(() => files.readFile(file));
	const parsed = text.isOk() ? parse(text.value) : undefined;
	return parsed?.isOk() && isObject(parsed.value) ? parsed.value : undefined;
}

const sourcePathsOf = (config: PlaceConfig): readonly unknown[] => {
	const { rogen } = config;
	return isObject(rogen) && Array.isArray(rogen.sourcePaths)
		? rogen.sourcePaths
		: [];
};

/** The layouts a place is added in, found from the folders: below a `projects` folder that has a place, or beside the root-level configs of places that list `src/common`. */
export class PlaceLayouts {
	constructor(private readonly files: FileReader) {}

	/** The layout for a place named by `target`, or `undefined` when the folder is not one a place is added to, and `init` starts a project there. */
	async find(cwd: string, target: string): Promise<PlaceLayout | undefined> {
		return (
			(await this.inProjects(target)) ?? (await this.atRoot(cwd, target))
		);
	}

	private async modelOf(
		folder: string,
		stem: string,
		prefix: string
	): Promise<PlaceModel | undefined> {
		const file = await configIn(this.files, folder, stem);
		const config = file ? await read(this.files, file) : undefined;
		if (!config) return undefined;
		return {
			file: file as string,
			folder,
			config,
			output: async (output) => {
				const twin = await configIn(
					this.files,
					folder,
					`${prefix}${output}`
				);
				return twin ? read(this.files, twin) : undefined;
			},
		};
	}

	/** A place in a folder of `projects`, beside places that each have a `default.rogen.json`. */
	private async inProjects(target: string): Promise<PlaceLayout | undefined> {
		const places = path.dirname(target);
		if (path.basename(places) !== PROJECTS_FOLDER) return undefined;
		if ((await configIn(this.files, target, DEFAULT_PROJECT)) !== undefined)
			return undefined;
		const model = await this.firstIn(places, target);
		if (!model) return undefined;

		const root = path.dirname(places);
		const place = toPosix(path.relative(root, target));
		const common = await this.files.isDirectory(
			path.join(places, COMMON_FOLDER)
		);
		return {
			root,
			name: path.basename(target),
			place,
			folder: place,
			sourcePaths: common
				? [...PROJECT_SOURCE_PATHS]
				: [DEFAULT_SOURCE_PATH],
			source: path.posix.join(place, DEFAULT_SOURCE_PATH),
			seeded: false,
			model,
			configFile: (stem = DEFAULT_PROJECT) =>
				path.posix.join(place, configFileName(stem)),
		};
	}

	/** The first place beside `target`, in name order, whose default config parses; the common code is not one. */
	private async firstIn(
		places: string,
		target: string
	): Promise<PlaceModel | undefined> {
		const entries = await tryWithAsync(() =>
			this.files.readDirectory(places)
		);
		if (entries.isErr()) return undefined;
		for (const [name, type] of entries.value) {
			if (!isDirectoryType(type) || name === COMMON_FOLDER) continue;
			const sibling = path.join(places, name);
			if (sibling === target) continue;
			const model = await this.modelOf(sibling, DEFAULT_PROJECT, "");
			if (model) return model;
		}
		return undefined;
	}

	/** A place named for a folder that doesn't exist directly below the root, which has `src/common` and the config of a place that lists it. */
	private async atRoot(
		cwd: string,
		target: string
	): Promise<PlaceLayout | undefined> {
		if (!samePath(path.dirname(target), cwd)) return undefined;
		if (await this.files.exists(target)) return undefined;
		if (
			!(await this.files.isDirectory(
				path.join(cwd, ROOT_COMMON_SOURCE_PATH)
			))
		)
			return undefined;
		const model = await this.firstAtRoot(cwd);
		if (!model) return undefined;

		const name = path.basename(target);
		if (!PLACE_NAME.test(name) || name === DEFAULT_PROJECT)
			throw new UsageError(
				`${name} can't name a place.`,
				"A place name has letters, digits, - and _, and isn't 'default'."
			);
		const source = rootPlaceSourcePath(name);
		return {
			root: cwd,
			name,
			place: name,
			folder: "",
			sourcePaths: [ROOT_COMMON_SOURCE_PATH, source],
			source,
			seeded: true,
			model,
			configFile: (stem) =>
				configFileName(stem ? `${name}.${stem}` : name),
		};
	}

	/** The first config at the root, in name order, of a place that lists `src/common`; the `dist` and `release` configs of a place are copies of it, and are not one. */
	private async firstAtRoot(cwd: string): Promise<PlaceModel | undefined> {
		const entries = await tryWithAsync(() => this.files.readDirectory(cwd));
		if (entries.isErr()) return undefined;
		const listing: { stem: string; config: PlaceConfig }[] = [];
		for (const [name, type] of entries.value) {
			const stem = configStem(name);
			if (
				stem === undefined ||
				stem === DEFAULT_PROJECT ||
				isDirectoryType(type)
			)
				continue;
			const config = await read(this.files, path.join(cwd, name));
			if (
				config &&
				sourcePathsOf(config).some(
					(entry) =>
						typeof entry === "string" &&
						normalizeDir(entry) === ROOT_COMMON_SOURCE_PATH
				)
			)
				listing.push({ stem, config });
		}
		const stems = new Set(listing.map(({ stem }) => stem));
		const places = listing.filter(
			({ stem }) =>
				![PROCESSED_OUTPUT, RELEASE_OUTPUT].some(
					(output) =>
						stem.endsWith(`.${output}`) &&
						stems.has(stem.slice(0, -output.length - 1))
				)
		);
		for (const { stem } of places) {
			const model = await this.modelOf(cwd, stem, `${stem}.`);
			if (model) return model;
		}
		return undefined;
	}
}
