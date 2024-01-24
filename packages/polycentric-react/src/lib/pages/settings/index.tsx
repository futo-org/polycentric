import { IonContent } from '@ionic/react';
import { Page } from '../../app/router';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { AppInfoTable } from '../../components/settings/AppInfoTable';
import { ExportKey } from '../../components/settings/ExportKey';
import { ServerListTable } from '../../components/settings/ServerTable';

export const SettingsPage: Page = () => {
    return (
        <>
            <Header canHaveBackButton={false}>Settings</Header>

            <IonContent>
                <RightCol leftCol={<div />} desktopTitle="Settings">
                    <div className="p-5 md:p-10 flex flex-col space-y-6 text-sm">
                        <div className="flex flex-col space-y-3">
                            <h2 className="font-medium">Edit Servers</h2>
                            <ServerListTable />
                        </div>
                        <div className="flex flex-col space-y-3">
                            <h2 className="font-medium">
                                Backup account login token
                            </h2>
                            <ExportKey />
                        </div>
                        <div className="flex flex-col space-y-3">
                            <h2 className="font-medium">Diagnostics</h2>
                            <AppInfoTable />
                        </div>
                    </div>
                </RightCol>
            </IonContent>
        </>
    );
};
