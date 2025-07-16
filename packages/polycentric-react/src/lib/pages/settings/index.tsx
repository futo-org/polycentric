import { IonContent } from '@ionic/react';
import { Page } from '../../app/routes';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { AppInfoTable } from '../../components/settings/AppInfoTable';
import { BlockedTopicsTable } from '../../components/settings/BlockedTopicsTable/BlockedTopicsTable';
import { DarkModeSelector } from '../../components/settings/DarkModeSelector';
import { DeleteAccount } from '../../components/settings/DeleteAccount';
import { ExportKey } from '../../components/settings/ExportKey';
import { ForumServerListTable } from '../../components/settings/ForumServerTable';
import { ModerationTable } from '../../components/settings/ModerationTable';
import { PrivateKeyDisplay } from '../../components/settings/PrivateKeyDisplay';
import { PublicKeyDisplay } from '../../components/settings/PublicKeyDisplay';
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
              <ForumServerListTable />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Your Private Key</h2>
              <p className="text-gray-600 text-xs">
                This is your private key. Keep it safe.
              </p>
              <PrivateKeyDisplay />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Your Public Key</h2>
              <p className="text-gray-600 text-xs">
                This is your public key. Copy this to set up forum admin access in your forum server's ADMIN_PUBKEYS environment variable.
              </p>
              <PublicKeyDisplay />
            </div>
            <div className="flex flex-col space-y-3">
              <h2 className="font-medium">Backup account login token</h2>
              <p className="text-gray-600 text-xs">
                Use this to login to your account.
              </p>
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
