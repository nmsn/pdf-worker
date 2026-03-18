import { createBrowserRouter } from "react-router-dom";

import { App } from "@/app/App";
import { AboutPage } from "@/pages/AboutPage";
import { HomePage } from "@/pages/HomePage";
import { PdfPage } from "@/pages/PdfPage";

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
      {
        path: "pdf",
        element: <PdfPage />,
      },
    ],
  },
]);
