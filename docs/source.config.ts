import { defineConfig, defineDocs } from "fumadocs-mdx/config";

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
	mdxOptions: {},
});
