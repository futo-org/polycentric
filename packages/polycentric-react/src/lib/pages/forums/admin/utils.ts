import { AuthHeaders } from '../../../hooks/useAuthHeaders';
import { Category } from './types';

export const saveCategoryOrder = async (
  orderedIds: string[],
  serverUrl: string,
  fetchHeaders: () => Promise<AuthHeaders | null>,
) => {
  if (!serverUrl) return;
  try {
    const authHeaders = await fetchHeaders();
    if (!authHeaders) throw new Error('No auth headers');
    const baseUrl = serverUrl.endsWith('/')
      ? serverUrl.slice(0, -1)
      : serverUrl;
    const response = await fetch(`${baseUrl}/forum/categories/reorder`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to save category order: ${response.status}`);
    }
  } catch (error) {
    console.error('Error saving category order:', error);
    throw error;
  }
};

export const saveBoardOrder = async (
  orderedIds: string[],
  serverUrl: string,
  fetchHeaders: () => Promise<AuthHeaders | null>,
) => {
  if (!serverUrl) return;
  try {
    const authHeaders = await fetchHeaders();
    if (!authHeaders) throw new Error('No auth headers');
    const baseUrl = serverUrl.endsWith('/')
      ? serverUrl.slice(0, -1)
      : serverUrl;
    const response = await fetch(`${baseUrl}/forum/boards/reorder`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to save board order: ${response.status}`);
    }
  } catch (error) {
    console.error('Error saving board order:', error);
    throw error;
  }
};

export const updateBoardCategory = async (
  boardId: string,
  targetCategoryId: string,
  serverUrl: string,
  categories: Category[],
  fetchHeaders: () => Promise<AuthHeaders | null>,
) => {
  if (!serverUrl) return;
  try {
    const authHeaders = await fetchHeaders();
    if (!authHeaders) throw new Error('No auth headers');

    const boardToUpdate = categories
      .flatMap((cat) => cat.boards)
      .find((board) => board.id === boardId);

    if (!boardToUpdate) throw new Error(`Board ${boardId} not found in state`);

    const baseUrl = serverUrl.endsWith('/')
      ? serverUrl.slice(0, -1)
      : serverUrl;
    const response = await fetch(`${baseUrl}/forum/boards/${boardId}`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: boardToUpdate.name,
        description: boardToUpdate.description,
        category_id: targetCategoryId,
      }),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to update board category: ${response.status}`);
    }
  } catch (error) {
    console.error('Error updating board category:', error);
    throw error;
  }
};
