import path from "path";
import {
	commonFolderPosix,
	containsPosix,
	isBelowPosix,
	normalizeDir,
} from "../../base/path.js";
import { CodeFinder } from "./code-finder.js";
import { DerivedRoutes } from "./derived-routes.js";
import { ProcessedFolder } from "./processed-folder.js";
import { StarterProject } from "./starter-project.js";
import { StartingRoutes } from "./starting-routes.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

export interface MountedCodeFolders {
	readonly sourcePaths: readonly string[];
	readonly processed?: string;
	readonly folders: readonly string[];
	readonly keptOnly?: true;
}

export class MountedCode {
	private readonly finder: CodeFinder;

	constructor(
		private readonly directory: string,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.finder = instantiationService.createInstance(CodeFinder);
	}

	async find(
		project: StarterProject,
		excluded: readonly string[],
		codeFolders: readonly string[]
	): Promise<MountedCodeFolders> {
		const targets = project.mountedFolders().map(normalizeDir);
		const skipped = excluded.map(normalizeDir);
		const candidates = targets.filter(
			(target) =>
				isBelowPosix(target) &&
				!skipped.some((folder) => containsPosix(folder, target))
		);
		const holding = await Promise.all(
			candidates.map((target) =>
				this.finder.holdsCode(path.join(this.directory, target))
			)
		);
		const folders = [
			...new Set(candidates.filter((_, at) => holding[at])),
		].sort();
		const processedFolder = this.instantiationService.createInstance(
			ProcessedFolder,
			this.directory
		);
		const unmounted = codeFolders.filter(
			(folder) =>
				!targets.some(
					(target) =>
						target === "." ||
						containsPosix(target, folder) ||
						containsPosix(folder, target)
				)
		);
		for (const source of unmounted) {
			const processed = await processedFolder.find(
				[source],
				targets,
				skipped
			);
			if (
				processed !== undefined &&
				folders.every((folder) => containsPosix(processed, folder))
			)
				return { sourcePaths: [source], processed, folders };
		}
		const routable = folders.filter((folder) => !project.holdsInit(folder));
		if (folders.length > 0 && routable.length === 0)
			return { sourcePaths: [], folders, keptOnly: true };
		const common = routable.length > 0 ? commonFolderPosix(routable) : ".";
		const sourcePath = MountedCode.routingSourcePath(
			common,
			project,
			routable
		);
		return { sourcePaths: sourcePath ? [sourcePath] : [], folders };
	}

	private static routingSourcePath(
		common: string,
		project: StarterProject,
		folders: readonly string[]
	): string | undefined {
		if (common === ".") return undefined;
		if (!MountedCode.isNamedAfterRouteKey(common, project)) return common;
		const parent = path.posix.dirname(common);
		if (parent === ".") return undefined;
		return MountedCode.routesEachWhereMounted(parent, project, folders)
			? parent
			: undefined;
	}

	private static isNamedAfterRouteKey(
		folder: string,
		project: StarterProject
	): boolean {
		return StartingRoutes.isKey(
			path.posix.basename(folder),
			DerivedRoutes.of(project, [folder])
		);
	}

	private static routesEachWhereMounted(
		sourcePath: string,
		project: StarterProject,
		folders: readonly string[]
	): boolean {
		const derived = DerivedRoutes.of(project, [sourcePath]);
		return (
			derived?.unrouted.every(
				({ target }) => !folders.includes(target)
			) ?? false
		);
	}
}
