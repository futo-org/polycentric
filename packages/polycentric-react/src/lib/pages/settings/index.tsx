import { IonContent } from '@ionic/react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { RightCol } from '../../components/layout/rightcol'
import { ServerListTable } from '../../components/settings/ServerTable'

export const SettingsPage: Page = () => {
  return (
    <>
      <Header hasBack={false}>Settings</Header>

      <IonContent>
        <RightCol leftCol={<div />} desktopTitle="Settings">
          <div className="p-5 md:p-10 flex flex-col space-y-3">
            <h2 className="font-medium">Edit Servers</h2>
            <ServerListTable />
          </div>
        </RightCol>
      </IonContent>
    </>
  )
}
