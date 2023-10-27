import { IonPage } from '@ionic/react'
import { useIsMobile } from '../../hooks/styleHooks'
import { MainSidebar } from '../sidebars/mainsidebar'
import { Drawer } from '../util/drawer'

export const RootLayout = ({ children }: { children: React.ReactNode }) => {
  const isMobile = useIsMobile()

  return (
    <>
      {isMobile && (
        <Drawer contentId="main-drawer">
          <MainSidebar topics={['/tpot', '/tpot/dating']} />
        </Drawer>
      )}
      <IonPage id="main-drawer">{children}</IonPage>
    </>
  )
}
