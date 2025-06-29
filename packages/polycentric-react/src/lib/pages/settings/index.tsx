import { IonContent } from '@ionic/react';
import { Page } from '../../app/routes';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { AppInfoTable } from '../../components/settings/AppInfoTable';
import { BlockedTopicsTable } from '../../components/settings/BlockedTopicsTable/BlockedTopicsTable';
import { DarkModeSelector } from '../../components/settings/DarkModeSelector';
import { DeleteAccount } from '../../components/settings/DeleteAccount';
import { ExportKey } from '../../components/settings/ExportKey';
import { ModerationTable } from '../../components/settings/ModerationTable';
import { ServerListTable } from '../../components/settings/ServerTable';

export const SettingsPage: Page = () => {
  return (
    <>
      <Header canHaveBackButton={false}>Settings</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle="Settings">
          <div className="p-5 md:p-10 flex flex-col space-y-6 text-sm text-black">
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Edit Servers</h2>
              <ServerListTable />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Backup account login token</h2>
              <ExportKey />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Diagnostics</h2>
              <AppInfoTable />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Dark Mode</h2>
              <DarkModeSelector />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Moderation</h2>
              <ModerationTable />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Blocked Topics</h2>
              <BlockedTopicsTable />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Delete Account</h2>
              <DeleteAccount />
            </div>
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};
