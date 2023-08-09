import { useState } from "react";
import { Outlet } from "react-router-dom";

export const Root = () => {
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);

  return (
    <div className="h-screen">
      {/* Floating top bar for mobile */}
      <div className="fixed top-0 left-0 w-full flex justify-between p-4 bg-blue-600 text-white md:hidden">
        <button onClick={() => setShowLeftSidebar(!showLeftSidebar)}>Toggle Left Sidebar</button>
        <button onClick={() => setShowRightSidebar(!showRightSidebar)}>Toggle Right Sidebar</button>
      </div>

      {/* Content area */}
      <div className="flex h-full mt-16 md:mt-0">
        {/* Left sidebar */}
        <aside className={`bg-gray-200 w-1/5 ${showLeftSidebar ? 'block' : 'hidden'} md:block`}>
          Left Sidebar Content
        </aside>

        {/* Main content */}
        <main className="bg-white w-3/5">
          <Outlet />
        </main>

        {/* Right sidebar */}
        <aside className={`bg-gray-300 w-1/5 ${showRightSidebar ? 'block' : 'hidden'} md:block`}>
          Right Sidebar Content
        </aside>
      </div>
    </div>
  );
}
