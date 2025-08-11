import { IonContent } from '@ionic/react';
import React from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useForumServers } from '../../hooks/forumServerHooks';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useServerInfo } from '../../hooks/useServerInfo';

interface ServerListItemProps {
  serverUrl: string;
}

const ServerListItem: React.FC<ServerListItemProps> = ({ serverUrl }) => {
  const {
    serverInfo,
    loading: serverInfoLoading,
    error: serverInfoError,
  } = useServerInfo(serverUrl);
  const { isAdmin, loading: adminLoading } = useIsAdmin(serverUrl);
  const encodedServerUrl = encodeURIComponent(serverUrl);

  const displayName = serverInfoLoading
    ? 'Loading...'
    : serverInfoError
      ? `Error: ${serverUrl}`
      : serverInfo?.name || serverUrl;
  const imageUrl =
    !serverInfoLoading && !serverInfoError ? serverInfo?.imageUrl : null;

  return (
    <li className="flex items-center justify-between space-x-3 border-b pb-2 mb-2">
      <div className="flex items-center space-x-3 min-w-0">
        {imageUrl && (
          <img
            src={
              imageUrl.startsWith('/') ? `${serverUrl}${imageUrl}` : imageUrl
            }
            alt={`${displayName} logo`}
            className="w-8 h-8 rounded object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        {!imageUrl && (
          <div className="w-8 h-8 bg-gray-200 rounded flex-shrink-0"></div>
        )}
        <Link
          routerLink={`/forums/${encodedServerUrl}`}
          className="text-blue-600 hover:underline truncate flex-grow"
          title={serverUrl}
        >
          {displayName}
        </Link>
      </div>

      {isAdmin && !adminLoading && (
        <Link
          routerLink={`/admin/${encodedServerUrl}`}
          className="btn btn-secondary btn-sm flex-shrink-0 ml-auto whitespace-nowrap"
        >
          Admin Panel
        </Link>
      )}
    </li>
  );
};

export const ForumServerListPage: React.FC = () => {
  const { servers } = useForumServers();

  const serverList = Array.from(servers);

  return (
    <>
      <Header canHaveBackButton={true}>Forums</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle="Forums">
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Connected Forum Servers</h2>
              <Link
                routerLink="/"
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                ← Back to Feed
              </Link>
            </div>
            {serverList.length === 0 ? (
              <p className="text-gray-500">
                No forum servers added yet. You can add them in the Settings
                page.
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
