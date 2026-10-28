// Static export for GitHub Pages. NEXT_PUBLIC_BASE_PATH is set by the deploy workflow
// (e.g. "/delta-map" for a project site); it is empty locally and on a custom domain.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};
