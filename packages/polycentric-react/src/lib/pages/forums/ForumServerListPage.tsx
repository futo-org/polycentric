import { IonContent } from '@ionic/react';
import React from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useForumServers } from '../../hooks/forumServerHooks';
import { useServerInfo } from '../../hooks/useServerInfo';

// New component to render each server item
interface ServerListItemProps {
    serverUrl: string;
}

const ServerListItem: React.FC<ServerListItemProps> = ({ serverUrl }) => {
    const { serverInfo, loading, error } = useServerInfo(serverUrl);
    const encodedServerUrl = encodeURIComponent(serverUrl);

    const displayName = loading ? 'Loading...' : (error ? `Error: ${serverUrl}` : serverInfo?.name || serverUrl);
    const imageUrl = !loading && !error ? serverInfo?.imageUrl : null;

    return (
        <li className="flex items-center space-x-3 border-b pb-2 mb-2">
            {imageUrl && (
                <img 
                    src={imageUrl.startsWith('/') ? `${serverUrl}${imageUrl}` : imageUrl}
                    alt={`${displayName} logo`} 
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
            )}
            {!imageUrl && <div className="w-8 h-8 bg-gray-200 rounded flex-shrink-0"></div>} 
            <Link 
                routerLink={`/forums/${encodedServerUrl}`}
                className="text-blue-600 hover:underline truncate"
                title={serverUrl}
            >
                {displayName}
            </Link>
        </li>
    );
};

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
                                    <ServerListItem key={server} serverUrl={server} />
                                ))}
                            </ul>
                        )}
                    </div>
                </RightCol>
            </IonContent>
        </>
    );
}; 