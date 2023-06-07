import React from 'react'
import Root from './Root.js'
import {
    createBrowserRouter,
    RouterProvider,
} from "react-router-dom";
import "./index.css"

const router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        // errorElement: <ErrorPage />,
    },
]);

export default () => {
    return <RouterProvider router={router} />
}