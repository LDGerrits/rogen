import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { RequestService } from "../../../platform/request/request-service.js";
import { ServerProbe } from "../server-probe.js";
import { ServerRecords } from "../server-records.js";

export const probeOf = (requests: RequestService): ServerProbe =>
	instantiationOf([RequestService, requests]).createInstance(ServerProbe);

export const recordsOf = (
	fs: FileSystemService,
	tmpDir: string,
	owner: number
): ServerRecords =>
	instantiationOf([FileSystemService, fs]).createInstance(
		ServerRecords,
		tmpDir,
		owner
	);
