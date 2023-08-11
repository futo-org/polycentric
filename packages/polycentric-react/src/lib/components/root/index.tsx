import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Drawer } from '../util/drawer'

const MenuIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
    />
  </svg>
)

const InformationIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
    />
  </svg>
)

export const Root = () => {
  const [showLeftSidebar, setShowLeftSidebar] = useState(false)
  const [showRightSidebar, setShowRightSidebar] = useState(false)

  return (
    <div className="h-screen">
      {/* Floating top bar for mobile */}
      <div className="fixed top-0 left-0 w-full flex justify-between p-4 border bg-white md:hidden">
        <button className="md:hidden" onClick={() => setShowLeftSidebar(!showLeftSidebar)}>
          <MenuIcon />
        </button>
        <h1>Polycentric</h1>
        <button className="md:hidden" onClick={() => setShowRightSidebar(!showRightSidebar)}>
          <InformationIcon />
        </button>
      </div>

      {/* Content area */}
      <div className="flex h-full mt-16 md:mt-0">
        {/* Left sidebar */}
        <aside className={`w-3/12 hidden md:block border`}>Left Sidebar Content</aside>
        <Drawer open={showLeftSidebar} setOpen={setShowLeftSidebar} side="left"></Drawer>

        {/* Main content */}
        <main className="bg-white w-6/12">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
