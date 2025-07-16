import { IonContent } from '@ionic/react';
import React, { useEffect, useState } from 'react';
import { AddServerButton } from '../../components/forums/AddServerButton';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useParams } from '../../hooks/stackRouterHooks';
import { useServerInfo } from '../../hooks/useServerInfo';

interface ForumCategory {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface ForumBoard {
  id: string;
  category_id: string;
  name: string;
  description: string;
  created_at: string;
}

export const ForumCategoryListPage: React.FC = () => {
  const { serverUrl: encodedServerUrl } = useParams<{ serverUrl: string }>();
  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [boardsByCategory, setBoardsByCategory] = useState<
    Record<string, ForumBoard[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : null;

  const {
    serverInfo,
    loading: serverInfoLoading,
    error: serverInfoError,
  } = useServerInfo(serverUrl);

  useEffect(() => {
    if (!serverUrl) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!serverUrl) {
          throw new Error('Cannot fetch data: Server URL is missing.');
        }

        const baseUrl = serverUrl.endsWith('/')
          ? serverUrl.slice(0, -1)
          : serverUrl;

        const catApiUrl = `${baseUrl}/forum/categories`;
        const catResponse = await fetch(catApiUrl);
        if (!catResponse.ok) {
          throw new Error(
            `Failed to fetch categories: ${catResponse.status} ${catResponse.statusText}`,
          );
        }
        const fetchedCategories: ForumCategory[] = await catResponse.json();
        setCategories(fetchedCategories);

        const boardPromises = fetchedCategories.map(async (category) => {
          const boardApiUrl = `${baseUrl}/forum/categories/${category.id}/boards`;
          const boardResponse = await fetch(boardApiUrl);
          if (!boardResponse.ok) {
            console.error(
              `Failed to fetch boards for category ${category.id}: ${boardResponse.status} ${boardResponse.statusText}`,
            );
            return { categoryId: category.id, boards: [] };
          }
          try {
            const fetchedBoards: ForumBoard[] = await boardResponse.json();
            return { categoryId: category.id, boards: fetchedBoards };
          } catch (jsonError: any) {
            console.error(
              `Error parsing JSON for boards in category ${category.id}:`,
              jsonError,
            );
            return { categoryId: category.id, boards: [] };
          }
        });

        const boardResults = await Promise.all(boardPromises);
        const newBoardsByCategory: Record<string, ForumBoard[]> = {};
        boardResults.forEach((result) => {
          newBoardsByCategory[result.categoryId] = result.boards;
        });
        setBoardsByCategory(newBoardsByCategory);
      } catch (fetchError: any) {
        console.error('Error during data fetch:', fetchError);
        setError(fetchError.message || 'Failed to load forum data.');
        setCategories([]);
        setBoardsByCategory({});
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [serverUrl]);

  const displayServerName = serverInfo?.name || serverUrl || '...';
  const displayLoading = loading || serverInfoLoading;
  const displayError = error || serverInfoError;

  return (
    <>
      <Header
        canHaveBackButton={true}
        right={<AddServerButton serverUrl={serverUrl} />}
      >
        Categories on {displayServerName}
      </Header>
      <IonContent>
        <RightCol
          rightCol={<div />}
          desktopTitle={
            <div className="flex items-center justify-between">
              <span>{`Categories on ${displayServerName}`}</span>
              <AddServerButton serverUrl={serverUrl} />
            </div>
          }
        >
          <div className="p-5 md:p-10 flex flex-col space-y-6">
            {' '}
            {displayLoading && <p>Loading forum data...</p>}
            {displayError && (
              <p className="text-red-500">Error: {displayError}</p>
            )}
            {!displayLoading &&
              !displayError &&
              (categories.length === 0 ? (
                <p className="text-gray-500">
                  No categories found on this server.
                </p>
              ) : (
                <ul className="space-y-4">
                  {' '}
                  {categories.map((category) => (
                    <li key={category.id} className="border-b pb-4 mb-4">
                      {' '}
                      <h3 className="text-lg font-semibold mb-2">
                        {category.name}
                      </h3>
                      <p className="text-sm text-gray-600 mb-3">
                        {category.description}
                      </p>
                      {boardsByCategory[category.id] &&
                      boardsByCategory[category.id].length > 0 ? (
                        <ul className="list-disc pl-5 space-y-1">
                          {boardsByCategory[category.id].map((board) => (
                            <li key={board.id}>
                              <Link
                                routerLink={`/forums/${encodedServerUrl}/${category.id}/${board.id}`}
                                className="text-blue-600 hover:underline"
                              >
                                {board.name}
                              </Link>
                              <p className="text-xs text-gray-500">
                                {board.description}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-400 italic pl-5">
                          No boards in this category yet.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};
