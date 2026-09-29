import path from "path";
import { toPosix } from "../../../base/path.js";
import { BuildRule } from "../build-record.js";
import { declaredKeysOf, readFolderName } from "../declared-key.js";
import {
	InstancelessFolder,
	InstancelessMeta,
	MetaDiagnostics,
} from "../meta-diagnostics.js";

/** Meta in folders that never become an instance, decided by the folder's name. */
export const metaAppliesToNothing: BuildRule = ({ config, folderMeta }) => {
	const { routeKeys, tagKeys } = declaredKeysOf(config);
	const instanceless = (dir: string): InstancelessFolder | undefined => {
		if (dir === "") return "root dir";
		const folder = readFolderName(
			path.posix.basename(dir),
			routeKeys,
			tagKeys
		);
		if (folder.kind === "route") return "routing folder";
		if (folder.kind === "tag") return "tag folder";
		return folder.invisible ? "invisible folder" : undefined;
	};
	const metas: InstancelessMeta[] = folderMeta.flatMap((meta) => {
		const kind = instanceless(meta.dir);
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
