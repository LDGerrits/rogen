# Rogen documentation

The site at https://rogen-playfully.vercel.app, built with [Next.js](https://nextjs.org) and [Fumadocs](https://fumadocs.dev).

## Run it

The site is a workspace of the repository. From the repository root:

```bash
npm ci
npm run dev --workspace docs
```

Then open http://localhost:3000. `npm run build --workspace docs` builds it, and `npm run types:check --workspace docs` checks the types.

## Where things are

- `content/docs/v2` is the current documentation, `content/docs/v1` the released 1.x line. Each folder's `meta.json` sets the order of its pages.
- A heading takes an explicit anchor as `### Heading [#anchor]`. Other pages link to those, so keep them when you rename a heading.
- `components/route-figure.tsx` draws a folder on disk beside the Studio Explorer, in the home page's style, from two indented outlines (`<RouteFigure disk={...} studio={...} />`). The v1 pages still use the older pictures in `components/file-tree-preview.tsx`. `components/mdx.tsx` registers both.
- `app/llms.txt`, `app/llms-full.txt` and `app/llms.mdx` serve the pages as plain text for agents.

The reference pages describe the CLI, so change them with the code. `help/*.md` and `skills/` at the repository root feed `rogen help` and the agent skill.
