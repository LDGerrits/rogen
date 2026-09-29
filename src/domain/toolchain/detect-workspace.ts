import path from "path";
import {
	FileSystemService,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { SCRIPT_EXTENSIONS } from "../rojo/rojo-files.js";
import { Darklua } from "./darklua.js";
import { detectPackages } from "./packages.js";
import { DetectedWorkspace, Language, PLACES_DIR } from "./toolchain.js";

/** Throws when `languages` is empty. */
export async function detectWorkspace(
	fileSystem: FileSystemService,
	languages: readonly Language[],
	cwd: string
): Promise<DetectedWorkspace> {
	if (languages.length === 0) {
		throw new Error("No language is registered to detect.");
	}

	const [detections, darklua, packages, hasSrc, places] = await Promise.all([
		Promise.all(
			languages.map((language) => language.detect(fileSystem, cwd))
		),
		Darklua.detect(fileSystem, cwd),
		detectPackages(fileSystem, cwd),
		fileSystem.exists(path.join(cwd, "src")),
		findPlaces(fileSystem, path.join(cwd, PLACES_DIR)),
	]);
	const language =
		languages.find((_, index) => detections[index].present) ?? languages[0];
	const codeFolders = await findCodeFolders(fileSystem, cwd, [
		...packages.packageDirs,
		...detections.flatMap(({ reservedFolders }) => reservedFolders),
		...(places.length > 0 ? [PLACES_DIR] : []),
	]);

	return {
		...Object.assign({}, ...detections.map(({ facts }) => facts)),
		language: language.id,
		darklua,
		codeFolders,
		hasSrc,
		...(packages.packageManager && {
			packageManager: packages.packageManager,
		}),
		packageDirs: new Set(packages.packageDirs),
		places,
	};
}

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

async function holdsCode(
	fileSystem: FileSystemService,
	dir: string
): Promise<boolean> {
	let entries;
	try {
		entries = await fileSystem.readDirectory(dir);
	} catch {
		return false;
	}
	const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
	if (
		visible.some(
			([name, type]) =>
				isFileType(type) &&
				SCRIPT_EXTENSIONS.some((extension) => name.endsWith(extension))
		)
	) {
		return true;
	}
	for (const [name, type] of visible) {
		if (
			isDirectoryType(type) &&
			(await holdsCode(fileSystem, path.join(dir, name)))
		) {
			return true;
		}
	}
	return false;
}

async function findCodeFolders(
	fileSystem: FileSystemService,
	cwd: string,
	excluded: readonly string[]
): Promise<string[]> {
	let entries;
	try {
		entries = await fileSystem.readDirectory(cwd);
	} catch {
		return [];
	}
	const candidates = entries
		.filter(
			([name, type]) =>
				isDirectoryType(type) &&
				!isHiddenOrVendored(name) &&
				!excluded.includes(name)
		)
		.map(([name]) => name);
	const holding = await Promise.all(
		candidates.map((name) => holdsCode(fileSystem, path.join(cwd, name)))
	);
	return candidates.filter((_, index) => holding[index]).sort();
}

async function findPlaces(
	fileSystem: FileSystemService,
	dir: string
): Promise<string[]> {
	try {
		return (await fileSystem.readDirectory(dir))
			.filter(
				([name, type]) =>
					isDirectoryType(type) && !isHiddenOrVendored(name)
			)
			.map(([name]) => name)
			.sort();
	} catch {
		return [];
	}
}
