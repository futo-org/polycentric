import { IonContent } from '@ionic/react';
import React, { useEffect, useState } from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useParams } from '../../hooks/stackRouterHooks';

// Define types for Category and Board
interface ForumCategory {
    id: string; // Changed to string (UUID)
    name: string;
    description: string;
    created_at: string;
}

interface ForumBoard {
    id: string; // UUID
    category_id: string; // UUID
    name: string;
    description: string;
    created_at: string;
}

export const ForumCategoryListPage: React.FC = () => {
    const { serverUrl: encodedServerUrl } = useParams<{ serverUrl: string }>();
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [boardsByCategory, setBoardsByCategory] = useState<Record<string, ForumBoard[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const serverUrl = encodedServerUrl ? decodeURIComponent(encodedServerUrl) : null;

    useEffect(() => {
        if (!serverUrl) {
            console.log("[fetchData] serverUrl is not ready yet, skipping fetch.");
            setLoading(false);
            return;
        }

        const fetchData = async () => {
            console.log("[fetchData] serverUrl is ready, starting fetch...");
            setLoading(true);
            setError(null);
            try {
                // 1. Fetch Categories
                const catApiUrl = `https://localhost:8080/forum/categories`;
                console.log(`Fetching categories from: ${catApiUrl}`);
                const catResponse = await fetch(catApiUrl);
                if (!catResponse.ok) {
                    throw new Error(`Failed to fetch categories: ${catResponse.status} ${catResponse.statusText}`);
                }
                const fetchedCategories: ForumCategory[] = await catResponse.json();
                console.log("Fetched categories:", fetchedCategories);
                setCategories(fetchedCategories);

                // 2. Fetch Boards for each Category
                const boardPromises = fetchedCategories.map(async (category) => {
                    const boardApiUrl = `https://localhost:8080/forum/categories/${category.id}/boards`;
                    console.log(`Fetching boards for category ${category.id} from: ${boardApiUrl}`);
                    const boardResponse = await fetch(boardApiUrl);
                    if (!boardResponse.ok) {
                        console.error(`Failed to fetch boards for category ${category.id}: ${boardResponse.status} ${boardResponse.statusText}`);
                        return { categoryId: category.id, boards: [] }; // Return empty on error for this category
                    }
                    try {
                        const fetchedBoards: ForumBoard[] = await boardResponse.json();
                        console.log(`Fetched boards for category ${category.id}:`, fetchedBoards);
                        return { categoryId: category.id, boards: fetchedBoards };
                    } catch (jsonError: any) {
                        console.error(`Error parsing JSON for boards in category ${category.id}:`, jsonError);
                        return { categoryId: category.id, boards: [] }; // Return empty on JSON error
                    }
                });

                const boardResults = await Promise.all(boardPromises);
                const newBoardsByCategory: Record<string, ForumBoard[]> = {};
                boardResults.forEach(result => {
                    newBoardsByCategory[result.categoryId] = result.boards;
                });
                console.log("Boards grouped by category:", newBoardsByCategory);
                setBoardsByCategory(newBoardsByCategory);

            } catch (fetchError: any) {
                console.error("Error during data fetch:", fetchError);
                setError(fetchError.message || 'Failed to load forum data.');
                setCategories([]); // Clear data on error
                setBoardsByCategory({});
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [serverUrl]);

    return (
        <>
            <Header canHaveBackButton={true}>Categories on {serverUrl || '...'}</Header>
            <IonContent>
                <RightCol rightCol={<div />} desktopTitle={`Categories on ${serverUrl || 'Server'}`}>
                    <div className="p-5 md:p-10 flex flex-col space-y-6"> {/* Increased spacing */}
                        {loading && <p>Loading forum data...</p>}
                        {error && <p className="text-red-500">Error: {error}</p>}
                        {!loading && !error && (
                            categories.length === 0 ? (
                                <p className="text-gray-500">No categories found on this server.</p>
                            ) : (
                                <ul className="space-y-4"> {/* Space between categories */}
                                    {categories.map((category) => (
                                        <li key={category.id} className="border-b pb-4 mb-4"> {/* Add border and margin */}
                                            <h3 className="text-lg font-semibold mb-2">{category.name}</h3>
                                            <p className="text-sm text-gray-600 mb-3">{category.description}</p>
                                            {/* List boards within the category */}
                                            {boardsByCategory[category.id] && boardsByCategory[category.id].length > 0 ? (
                                                <ul className="list-disc pl-5 space-y-1">
                                                    {boardsByCategory[category.id].map((board) => (
                                                        <li key={board.id}>
                                                            <Link
                                                                routerLink={`/forums/${encodedServerUrl}/${category.id}/${board.id}`}
                                                                className="text-blue-600 hover:underline"
                                                            >
                                                                {board.name}
                                                            </Link>
                                                            <p className="text-xs text-gray-500">{board.description}</p>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm text-gray-400 italic pl-5">No boards in this category yet.</p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )
                        )}
                    </div>
                </RightCol>
            </IonContent>
        </>
    );
}; 