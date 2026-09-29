import {
	DetectedWorkspace,
	Language,
	Mount,
	MountCandidate,
	packageMounts,
} from "../toolchain/toolchain.js";

/** What the packages question offers: the package manager's folders, then the language's own. */
export const offeredMounts = (
	workspace: DetectedWorkspace,
	language: Language
): MountCandidate[] => [
	...packageMounts(workspace, language),
	...language.offeredMounts(workspace),
];

const toMount = ({ path, installed, landing }: MountCandidate): Mount => ({
	path,
	optional: !installed,
	landing,
});

/** The language's always-mounted folders plus the offered ones in `ticked`. */
export function selectMounts(
	workspace: DetectedWorkspace,
	language: Language,
	ticked: readonly string[]
): Mount[] {
	return [
		...language.alwaysMounted(workspace).map(toMount),
		...offeredMounts(workspace, language)
			.filter(({ path }) => ticked.includes(path))
			.map(toMount),
	];
}

/** The mounts when every question is answered with its default. */
export const defaultMounts = (
	workspace: DetectedWorkspace,
	language: Language
): Mount[] =>
	selectMounts(
		workspace,
		language,
		offeredMounts(workspace, language)
			.filter(({ ticked }) => ticked)
			.map(({ path }) => path)
	);
