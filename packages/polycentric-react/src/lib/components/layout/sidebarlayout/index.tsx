import { ReactNode } from 'react'
import { useIsMobile } from '../../../hooks/styleHooks'
import { MainSidebar } from '../../sidebars/mainsidebar'
import { Drawer } from '../../util/drawer'

export const SidebarLayout = ({ children }: { children: ReactNode }) => {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        {/* To use the drawer on the page, we need to make sure that the page has an IonPage with id="main-drawer" */}
        <Drawer contentId="main-drawer">
          <MainSidebar />
        </Drawer>
        {children}
      </>
    )
  }

  return (
    <>
      <div className="flex h-screen mt-16 md:mt-0 w-full">
        {/* Physical left sidebar for tablet+ */}
        <aside
          className={`border-x h-full lg:w-[calc(100vw-700px)] xl:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:ml-[calc((100vw-1536px)/2)] `}
        >
          <MainSidebar />
        </aside>
        {/* [     |  |    main    |  |       ]
            Formula for left two side bars of a 3 column table, with total width of X and middle column width of Y
            X - ((X - Y)/2)
            X - 1/2X + 1/2Y
            1/2X + 1/2Y
            (X+Y)/2 

            For desktop up to 1536px, columns stretch to fill the screen
            For desktop above 1536px, columns are fixed width to a max content width of 1536px
          */}

        {/* Relative positioning is needed here because we're not using ionic's desktop dynamic column so we can fix the page size,
            and those rely on an upper level relative container
         */}
        <div className="flex-grow relative">{children}</div>
      </div>
    </>
  )
}
