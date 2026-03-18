import { createBrowserRouter } from "react-router-dom";

import { App } from "@/app/App";
import { AboutPage } from "@/pages/AboutPage";
import { HomePage } from "@/pages/HomePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "about",
        element: <AboutPage />,
      },
    ],
  },
]);
