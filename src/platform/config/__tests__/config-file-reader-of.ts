import { JsonStructure } from "../../../base/json-structure.js";
import { FileSystemService } from "../../fs/file-system-service.js";
import { instantiationOf } from "../../instantiation/__tests__/instantiation-of.js";
import { ConfigFileReader } from "../config-file.js";

export const configFileReaderOf = (
	fs: FileSystemService,
	structure: JsonStructure
): ConfigFileReader =>
	instantiationOf([FileSystemService, fs]).createInstance(
		ConfigFileReader,
		structure
	);
