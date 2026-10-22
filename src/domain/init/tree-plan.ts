import path from "path";
import { joinedWithAnd, joinedWithOr } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DEFAULT_CONFIG_FILE, RogenConfig } from "../config/config.js";
import { instanceKey } from "../roblox/roblox.js";
import { MountedPath, RemovedMount } from "../rojo/rojo-project.js";
import { Mount } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitKind } from "./init-service.js";
import { SampleGame } from "./sample-game.js";
import { StarterProject } from "./starter-project.js";

export type TreeChoice =
	{ readonly kind: "new" } | { readonly kind: "lift"; readonly from: string };

export type ProjectTree =
	| {
			readonly kind: "new";
			/** The sample game the tree mounts, which the Greeter sample comes with. */
			readonly game?: SampleGame;
	  }
	| {
			readonly kind: "template";
			readonly template: InitKind;
			readonly project: StarterProject;
	  }
	| {
			readonly kind: "lift";
			readonly from: string;
			readonly project: StarterProject;
	  };

interface TreeInputs {
	readonly tree: ProjectTree;
	readonly mounts: readonly Mount[];
	readonly dirs: readonly string[];
	readonly derived: DerivedRoutes | undefined;
	/** Where the routes the config writes put code. */
	readonly landings: readonly string[];
}

/** The name of the folder a mount at `target` lies in or is; a file's folder is where its marker goes. */
function folderNameOf(target: string): string {
	const name = path.posix.basename(target);
	return path.posix.extname(name) === ""
		? name
		: path.posix.basename(path.posix.dirname(target));
}

const describeMount = ({ instancePath }: MountedPath): string =>
	instanceKey(instancePath);

export class TreePlan {
	private constructor(
		readonly fields: RogenConfig,
		readonly notes: readonly string[],
		readonly edits: readonly string[],
		readonly warnings: readonly Diagnostic[] = []
	) {}

	static of({ tree, mounts, dirs, derived, landings }: TreeInputs): TreePlan {
		switch (tree.kind) {
			case "lift":
				return TreePlan.lifted(tree, mounts, dirs, derived, landings);
			case "template":
				return new TreePlan(
					tree.project.toConfig(),
					[
						`Started a ${tree.template} project: its tree mounts src, and Rogen adds no routes to a ${tree.template}.`,
					],
					[]
				);
			case "new":
				return new TreePlan(
					StarterProject.fromMounts(mounts, tree.game).toConfig(),
					[],
					[]
				);
		}
	}

	private static lifted(
		{ from, project }: { from: string; project: StarterProject },
		mounts: readonly Mount[],
		dirs: readonly string[],
		derived: DerivedRoutes | undefined,
		landings: readonly string[]
	): TreePlan {
		const stripped = project.withoutNodesIn(dirs);
		const removed = stripped?.removed ?? [];
		const carried = (mount: RemovedMount) =>
			Object.keys(mount.settings).length > 0;
		const unrouted = derived?.unrouted ?? [];
		const restored = unrouted.filter(({ atRoot }) => !atRoot);
		const dropped = unrouted.filter(
			({ mount, atRoot }) => carried(mount) && atRoot
		);
		const placeOf = ({ instancePath }: MountedPath) =>
			instancePath.join("/");
		const unroutedPlaces = new Set(
			unrouted.map(({ mount }) => placeOf(mount))
		);
		const routedMounts = removed.filter(
			(mount) =>
				carried(mount) &&
				!unroutedPlaces.has(placeOf(mount)) &&
				landings.includes(placeOf(mount))
		);
		const settled = stripped
			? stripped.project
					.withMountsReturned(
						restored.map(({ mount }) => mount),
						true
					)
					.withMountsReturned(routedMounts, false)
			: project;
		const mounted = settled.withMounts(mounts);
		const kept = project.keptMounts(dirs).map(describeMount);
		const restoredPlaces = new Set(
			restored.map(({ mount }) => placeOf(mount))
		);
		const leftOut = removed
			.filter((mount) => !restoredPlaces.has(placeOf(mount)))
			.map(({ instancePath }) => instanceKey(instancePath));
		const unroutable = unrouted.filter(
			({ mount }) => !restoredPlaces.has(placeOf(mount))
		);
		const { added, skipped } = mounted;
		return new TreePlan(
			mounted.project.toConfig(),
			[
				`Lifting ${from} into ${DEFAULT_CONFIG_FILE}, since Rogen replaces ${from} on every build.`,
				...(project.takesRoutes
					? []
					: [
							`The root of ${from} is not a DataModel, as in a model or a plugin, so ${DEFAULT_CONFIG_FILE} keeps the tree as Rojo reads it and adds no routes.`,
						]),
				...(leftOut.length > 0
					? [
							`Left out ${joinedWithAnd(leftOut)}, since ${leftOut.length === 1 ? "it points" : "they point"} into ${joinedWithOr(dirs)} and Rogen generates that code now.`,
						]
					: []),
				...(routedMounts.length > 0
					? [
							`Kept what ${joinedWithAnd(routedMounts.map(({ instancePath }) => instanceKey(instancePath)))} set in the tree, on the node the route lands on.`,
						]
					: []),
				...restored.map(
					({ node, mount, reason }) =>
						`Kept ${node} in the tree as a $path mount, since ${carried(mount) ? "a route can't carry its settings" : `no route can make it: ${reason}`}.`
				),
				...(kept.length > 0
					? [
							`Kept ${joinedWithAnd(kept)} in the tree as ${kept.length === 1 ? "a $path mount" : "$path mounts"}, since ${kept.length === 1 ? "its folder holds an init file, which Rojo reads" : "their folders hold an init file, which Rojo reads"} as the instance of the folder itself and a route can't.`,
						]
					: []),
				...(unroutable.length > 0
					? [
							`Couldn't route ${joinedWithOr(
								unroutable.map(({ node }) => node)
							)}, and a mount of a whole source path can't stay in the tree: ${unroutable[0].reason}. Give ${unroutable.length === 1 ? "its folder" : "each folder"} a marker such as ${folderNameOf(unroutable[0].target)}@server, or move ${unroutable.length === 1 ? "it" : "them"} up into a source path.`,
						]
					: []),
				...(added.length > 0
					? [
							`Added ${joinedWithAnd(added)} to ${DEFAULT_CONFIG_FILE}.`,
						]
					: []),
				...(skipped.length > 0
					? [
							`Didn't add ${joinedWithAnd(skipped)} to ${DEFAULT_CONFIG_FILE}, since it already has ${skipped.length === 1 ? "a node" : "nodes"} there.`,
						]
					: []),
			],
			stripped
				? []
				: [
						`Remove the nodes in the tree of ${DEFAULT_CONFIG_FILE} that point into ${joinedWithOr(dirs)}; Rogen generates those now.`,
					],
			[
				...dropped.map(({ node, mount }) =>
					warningDiagnostic(
						"init.settingsDropped",
						{ resource: from },
						`${node} set ${joinedWithAnd(Object.keys(mount.settings))}, which ${DEFAULT_CONFIG_FILE} doesn't carry, since no route lands on that node. Add them to the tree by hand.`
					)
				),
				...TreePlan.narrowedWarnings(from, derived, landings),
			]
		);
	}

	/** Rojo put the folders of a whole mounted source path inside its node as well, and routes take them out of it. */
	private static narrowedWarnings(
		from: string,
		derived: DerivedRoutes | undefined,
		landings: readonly string[]
	): Diagnostic[] {
		const narrowed = derived?.narrowed;
		if (!narrowed || !landings.includes(narrowed.node)) return [];
		const folders = narrowed.folders.filter(({ landing }) =>
			landings.includes(landing)
		);
		if (folders.length === 0) return [];
		const one = folders.length === 1;
		return [
			warningDiagnostic(
				"init.mountNarrowed",
				{ resource: from },
				`${narrowed.node} mounted all of ${narrowed.target}, so Rojo also put ${joinedWithAnd(folders.map(({ folder }) => folder))} inside it. Rogen routes ${one ? "that folder" : "those folders"} only to ${joinedWithAnd(folders.map(({ landing }) => landing))}, so a require that reaches ${one ? "it" : "them"} through ${narrowed.node} breaks. Check with 'rogen where ${one ? folders[0].folder : narrowed.target}'.`
			),
		];
	}
}
