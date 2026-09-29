import { joinPosix, toPosix } from "../../../base/path.js";
import { BuildRule, FolderMeta } from "../build-record.js";
import {
	InstancelessFolder,
	InstancelessMeta,
	MetaDiagnostics,
} from "../meta-diagnostics.js";

/** Meta in folders that never become an instance, decided by the folder's name. */
export const metaAppliesToNothing: BuildRule = ({
	config,
	folderMeta,
	readings,
}) => {
	const instanceless = ({
		rootDir,
		dir,
	}: FolderMeta): InstancelessFolder | undefined => {
		if (dir === "") return "root dir";
		const folder = readings.folders.get(joinPosix(rootDir, dir));
		if (folder?.kind === "route") return "routing folder";
		if (folder?.kind === "tag") return "tag folder";
		return folder?.invisible ? "invisible folder" : undefined;
	};
	const metas: InstancelessMeta[] = folderMeta.flatMap((meta) => {
		const kind = instanceless(meta);
		return kind ? [{ file: toPosix(meta.file), kind }] : [];
	});
	return metas.length > 0
		? [
				MetaDiagnostics.appliesToNothing(
					{ resource: config.outFile },
					metas
				),
			]
		: [];
};
