import { IonContent } from '@ionic/react';
import React from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useForumServers } from '../../hooks/forumServerHooks';

export const ForumServerListPage: React.FC = () => {
    const { servers } = useForumServers();

    // Convert Set to Array for mapping
    const serverList = Array.from(servers);

    return (
        <>
            <Header canHaveBackButton={false}>Forums</Header>
            <IonContent>
                <RightCol rightCol={<div />} desktopTitle="Forums">
                    <div className="p-5 md:p-10 flex flex-col space-y-4">
                        <h2 className="text-lg font-medium">Connected Forum Servers</h2>
                        {serverList.length === 0 ? (
                            <p className="text-gray-500">
                                No forum servers added yet. Add some in Settings.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {serverList.map((server) => (
                                    <li key={server}>
                                        <Link 
                                            routerLink={`/forums/${encodeURIComponent(server)}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {server}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </RightCol>
            </IonContent>
        </>
    );
}; 