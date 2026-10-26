import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/docs">) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			{...baseOptions()}
			tabs={[
				{
					title: "v2",
					description: "Beta",
					url: "/docs/v2",
				},
				{
					title: "v1",
					description: "The stable release",
					url: "/docs/v1",
				},
			]}
		>
			{children}
		</DocsLayout>
	);
}
