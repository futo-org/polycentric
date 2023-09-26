import { IonPage } from '@ionic/react'
import { useIsMobile } from '../../hooks/styleHooks'
import { MainSidebar } from '../sidebars/mainsidebar'
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

export const RootLayout = ({ children }: { children: React.ReactNode }) => {
  const isMobile = useIsMobile()

  return (
    <>
      {isMobile && (
        <Drawer contentId="main-drawer">
          <MainSidebar topics={['/tpot', '/tpot/dating']} />
        </Drawer>
      )}
      <IonPage id="main-drawer">
        {/* <IonContent> */}
        {children}
        {/* </IonContent> */}

        {/* Content area */}
        {/* <IonContent> */}
        {/* Physical left sidebar for tablet+ */}
        {/* <aside
          className={`border hidden lg:block h-full lg:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:ml-[calc((100vw-1536px)/2)] `}
        >
          <MainSidebar
            topics={['/tpot', '/tpot/dating']}
          />
        </aside> */}

        {/* {children}
      </IonContent> */}
      </IonPage>
    </>
  )
}
