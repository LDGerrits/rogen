import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { CompiledPathCheck } from "../check/compiled-path-check.js";
import { MetaReader } from "../meta-reader.js";

export const metaReaderOf = (fs: FileSystemService): MetaReader =>
	instantiationOf([FileSystemService, fs]).createInstance(MetaReader);

export const compiledPathCheckOf = (fs: FileSystemService): CompiledPathCheck =>
	instantiationOf([FileSystemService, fs]).createInstance(CompiledPathCheck);
