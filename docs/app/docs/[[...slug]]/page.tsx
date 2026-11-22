import { getPageImageUrl, getPageMarkdownUrl, source } from "@/lib/source";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { appName, gitConfig } from "@/lib/shared";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	if (!page) {
		if (!params.slug || params.slug.length === 0) {
			redirect("/docs/v1/introduction/quick-start");
		}
		notFound();
	}

	const MDX = page.data.body;
	const markdownUrl = getPageMarkdownUrl(page).url;

	return (
		<DocsPage toc={page.data.toc} full={page.data.full}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription className="mb-0">
				{page.data.description}
			</DocsDescription>
			<div className="flex flex-row gap-2 items-center border-b pb-6">
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover
					markdownUrl={markdownUrl}
					githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/docs/content/docs/${page.path}`}
				/>
				{page.data.lastModified && (
					<LastUpdated date={page.data.lastModified} />
				)}
			</div>
			{page.slugs[0] === "v1" && page.slugs[1] !== "migrating-to-v2" && (
				<Callout
					type="warn"
					title="You're reading the docs for Rogen v1"
				>
					Rogen v2 is the recommended version.{" "}
					<Link href="/docs/v1/migrating-to-v2">
						Migrate a project to v2
					</Link>{" "}
					or <Link href="/docs/v2">read the v2 docs</Link>.
				</Callout>
			)}
			<DocsBody>
				<MDX
					components={getMDXComponents({
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
		</DocsPage>
	);
}

// Rendered on the server, unlike Fumadocs' PageLastUpdate, so the date is in
// the HTML.
function LastUpdated({ date }: { date: Date }) {
	return (
		<p className="ms-auto text-sm text-fd-muted-foreground">
			Updated{" "}
			<time dateTime={date.toISOString()}>
				{date.toLocaleDateString("en-US", {
					dateStyle: "long",
					timeZone: "UTC",
				})}
			</time>
		</p>
	);
}

export async function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(
	props: PageProps<"/docs/[[...slug]]">
): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	return {
		title: page.data.title,
		description: page.data.description,
		openGraph: {
			siteName: appName,
			images: getPageImageUrl(page).url,
		},
	};
}
