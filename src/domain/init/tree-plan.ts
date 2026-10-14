import path from "path";
import { joinedWithAnd, joinedWithOr } from "../../base/strings.js";
import { DEFAULT_CONFIG_FILE, RogenConfig } from "../config/config.js";
import { instanceKey } from "../roblox/roblox.js";
import { Mount } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";
import { StarterProject } from "./starter-project.js";

export type TreeChoice =
	{ readonly kind: "new" } | { readonly kind: "lift"; readonly from: string };

export type ProjectTree =
	| { readonly kind: "new" }
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
}

/** The name of the folder a mount at `target` lies in or is; a file's folder is where its marker goes. */
function folderNameOf(target: string): string {
	const name = path.posix.basename(target);
	return path.posix.extname(name) === ""
		? name
		: path.posix.basename(path.posix.dirname(target));
}

export class TreePlan {
	private constructor(
		readonly fields: RogenConfig,
		readonly notes: readonly string[],
		readonly edits: readonly string[]
	) {}

	static of({ tree, mounts, dirs, derived }: TreeInputs): TreePlan {
		return tree.kind === "lift"
			? TreePlan.lifted(tree, mounts, dirs, derived)
			: new TreePlan(
					StarterProject.fromMounts(mounts).toConfig(),
					[],
					[]
				);
	}

	private static lifted(
		{ from, project }: { from: string; project: StarterProject },
		mounts: readonly Mount[],
		dirs: readonly string[],
		derived: DerivedRoutes | undefined
	): TreePlan {
		const stripped = project.withoutNodesIn(dirs);
		const mounted = (stripped?.project ?? project).withMounts(mounts);
		const removed = (stripped?.removed ?? []).map(({ instancePath }) =>
			instanceKey(instancePath)
		);
		const { added, skipped } = mounted;
		return new TreePlan(
			mounted.project.toConfig(),
			[
				`Lifting ${from} into ${DEFAULT_CONFIG_FILE}, since Rogen replaces ${from} on every build.`,
				...(removed.length > 0
					? [
							`Left out ${joinedWithAnd(removed)}, since ${removed.length === 1 ? "it points" : "they point"} into ${joinedWithOr(dirs)} and Rogen generates that code now.`,
						]
					: []),
				...(derived?.unrouted.length
					? [
							`Couldn't route ${joinedWithOr(
								derived.unrouted.map(({ node }) => node)
							)}: only a folder directly in a source path becomes a route. Give ${derived.unrouted.length === 1 ? "its folder" : "each folder"} a marker such as ${folderNameOf(derived.unrouted[0].target)}@server, or move ${derived.unrouted.length === 1 ? "it" : "them"} up into a source path.`,
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
					]
		);
	}
}
