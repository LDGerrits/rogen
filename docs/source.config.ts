import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkFitIncluded } from "./lib/remark-fit-included";

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		lastModified: true,
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: [remarkFitIncluded],
	},
});
