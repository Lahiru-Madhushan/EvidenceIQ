/**
 * Where each sidebar item goes.
 *
 * Kept beside the routes rather than inside Sidebar so that component stays a dumb
 * presentational one - it reports which key was clicked and the page decides. Items the
 * Sidebar marks `soon` are disabled there and deliberately have no entry here.
 */
export const ROUTE_FOR_NAV_KEY = {
  dashboard: '/dashboard',
  'new-review': '/reviews/new',
  'my-reviews': '/reviews',
}
