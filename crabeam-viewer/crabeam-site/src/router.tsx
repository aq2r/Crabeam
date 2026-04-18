import { createBrowserRouter, Outlet } from "react-router";
import { HomePage } from "./pages/home";
import { ViewerPage } from "./pages/viewer";

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "viewer", Component: ViewerPage },
    ],
  },
]);
