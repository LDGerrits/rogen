import { BuildRule } from "../../build-record.js";
import { ScanDiagnostics } from "../../scan-diagnostics.js";

export const missingRootDir: BuildRule = ({ roots }) =>
	roots
		.filter((root) => !root.exists)
		.map((root) => ScanDiagnostics.missingRootDir(root.rootDir));
