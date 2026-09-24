/**
 * `/project/<id>` — an open project. Empty on purpose: the workspace is
 * rendered by the `(app)` layout, which reads the id from the URL itself
 * (lib/projectRoute.ts) and shows a "not found" panel for one it can't load,
 * rather than this page 404-ing underneath a workspace that's still drawn.
 */
export default function ProjectPage() {
  return null;
}
