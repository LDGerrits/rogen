import { RojoNode, RojoPath } from "../rojo/rojo-tree.js";
import {
	DetectedWorkspace,
	Language,
	PACKAGE_DIRS,
	PackageManager,
} from "./detect-workspace.js";

export interface TemplateMount {
	readonly path: string;
	readonly optional: boolean;
}

export interface MountCandidate {
	readonly path: string;
	readonly installed: boolean;
	/** Where the folder lands in the game. */
	readonly landing: string;
}

const INCLUDE_DIR = "include";
const SCOPE_PARENT = "node_modules/";
const INCLUDE_LANDING = "ReplicatedStorage/rbxts_include";
const ALWAYS_MOUNTED_SCOPES = ["@rbxts"];
const OFFERED_SCOPES = ["@flamework", "@rbxts-js"];

const scopePath = (scope: string) => `${SCOPE_PARENT}${scope}`;

const candidate = (
	mountPath: string,
	installed: boolean,
	landing: string
): MountCandidate => ({ path: mountPath, installed, landing });

function offeredManager(
	workspace: DetectedWorkspace,
	language: Language
): PackageManager | undefined {
	if (workspace.packageManager) return workspace.packageManager;
	return language === "luau" ? "wally" : undefined;
}

/** roblox-ts mounts these without asking, and Luau never has them. */
export function alwaysMounted(
	workspace: DetectedWorkspace,
	language: Language
): readonly MountCandidate[] {
	if (language !== "roblox-ts") return [];
	return [
		candidate(INCLUDE_DIR, workspace.hasInclude, INCLUDE_LANDING),
		...ALWAYS_MOUNTED_SCOPES.map((scope) =>
			candidate(
				scopePath(scope),
				workspace.rbxtsScopes.includes(scope),
				`${INCLUDE_LANDING}/${scopePath(scope)}`
			)
		),
	];
}

/** What the packages question offers: the language and package manager decide what can apply. */
export function offeredMounts(
	workspace: DetectedWorkspace,
	language: Language
): readonly MountCandidate[] {
	const manager = offeredManager(workspace, language);
	const dirs = manager ? PACKAGE_DIRS[manager] : undefined;
	return [
		...(dirs
			? [
					candidate(
						dirs.shared,
						workspace.packageDirs.has(dirs.shared),
						"ReplicatedStorage/Packages"
					),
					candidate(
						dirs.server,
						workspace.packageDirs.has(dirs.server),
						"ServerScriptService/ServerPackages"
					),
				]
			: []),
		...(language === "roblox-ts"
			? OFFERED_SCOPES.filter((scope) =>
					workspace.rbxtsScopes.includes(scope)
				).map((scope) =>
					candidate(
						scopePath(scope),
						true,
						`${INCLUDE_LANDING}/${scopePath(scope)}`
					)
				)
			: []),
	];
}

export const toMount = ({
	path,
	installed,
}: MountCandidate): TemplateMount => ({ path, optional: !installed });

/** The always-mounted folders plus the offered ones in `ticked`. */
export function selectMounts(
	workspace: DetectedWorkspace,
	language: Language,
	ticked: readonly string[]
): TemplateMount[] {
	return [
		...alwaysMounted(workspace, language).map(toMount),
		...offeredMounts(workspace, language)
			.filter(({ path }) => ticked.includes(path))
			.map(toMount),
	];
}

/** The mounts when every question is answered with its default. */
export const defaultMounts = (
	workspace: DetectedWorkspace,
	language: Language
): TemplateMount[] =>
	selectMounts(
		workspace,
		language,
		offeredMounts(workspace, language)
			.filter(({ installed }) => installed)
			.map(({ path }) => path)
	);

const rojoPath = ({ path, optional }: TemplateMount): RojoPath =>
	optional ? { optional: path } : path;

const mountNode = (mount: TemplateMount): RojoNode => ({
	$path: rojoPath(mount),
});

export function templateTree(mounts: readonly TemplateMount[]): RojoNode {
	const replicatedStorage: RojoNode = {};
	const serverScriptService: RojoNode = {};

	const include = mounts.find(({ path }) => path === INCLUDE_DIR);
	const scopes = mounts.filter(({ path }) => path.startsWith(SCOPE_PARENT));
	if (include || scopes.length > 0) {
		replicatedStorage.rbxts_include = {
			...(include && mountNode(include)),
			...(scopes.length > 0 && {
				node_modules: {
					$className: "Folder",
					...Object.fromEntries(
						scopes.map((scope) => [
							scope.path.slice(SCOPE_PARENT.length),
							mountNode(scope),
						])
					),
				},
			}),
		};
	}

	const dirs = Object.values(PACKAGE_DIRS);
	const shared = mounts.find(({ path }) =>
		dirs.some((dir) => dir.shared === path)
	);
	const server = mounts.find(({ path }) =>
		dirs.some((dir) => dir.server === path)
	);
	if (shared) replicatedStorage.Packages = mountNode(shared);
	if (server) serverScriptService.ServerPackages = mountNode(server);

	return {
		...(Object.keys(replicatedStorage).length > 0 && {
			ReplicatedStorage: replicatedStorage,
		}),
		...(Object.keys(serverScriptService).length > 0 && {
			ServerScriptService: serverScriptService,
		}),
	};
}
