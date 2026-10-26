import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { siteDescription, siteUrl } from "@/lib/shared";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: "Rogen - Rojo with file-system routing",
		template: "%s | Rogen",
	},
	description: siteDescription,
};

export default function Layout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<RootProvider>{children}</RootProvider>
				<Analytics />
			</body>
		</html>
	);
}
