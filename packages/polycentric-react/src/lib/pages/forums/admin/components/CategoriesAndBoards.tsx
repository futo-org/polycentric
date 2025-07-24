import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthHeaders } from '../../../../hooks/useAuthHeaders';
import { Board, Category } from '../types';
import {
  saveBoardOrder,
  saveCategoryOrder,
  updateBoardCategory,
} from '../utils';
import { DragHandle, SortableItem } from './DragComponents';

interface CategoriesAndBoardsProps {
  categories: Category[];
  setCategories: (
    categories: Category[] | ((prevCategories: Category[]) => Category[]),
  ) => void;
  serverUrl: string;
  fetchHeaders: () => Promise<AuthHeaders | null>;
  fetchAdminData: () => Promise<void>;
  setDataError: (error: string | null) => void;
}

export function CategoriesAndBoards({
  categories,
  setCategories,
  serverUrl,
  fetchHeaders,
  fetchAdminData,
  setDataError,
}: CategoriesAndBoardsProps) {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [addCategoryError, setAddCategoryError] = useState<string | null>(null);

  // State for Add Board form
  const [addingBoardToCategoryId, setAddingBoardToCategoryId] = useState<
    string | null
  >(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [isAddingBoard, setIsAddingBoard] = useState(false);
  const [addBoardError, setAddBoardError] = useState<string | null>(null);

  // State for Delete Board
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [, setDeleteBoardError] = useState<string | null>(null);

  // State for Delete Category
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
    null,
  );
  const [, setDeleteCategoryError] = useState<string | null>(null);

  // State for Edit Board form
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardDesc, setEditBoardDesc] = useState('');
  const [isSavingBoard, setIsSavingBoard] = useState(false);
  const [saveBoardError, setSaveBoardError] = useState<string | null>(null);

  // State for Edit Category form
  const [editingCategory, setEditingCategory] = useState<Omit<
    Category,
    'boards'
  > | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryDesc, setEditCategoryDesc] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [saveCategoryError, setSaveCategoryError] = useState<string | null>(
    null,
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  // --- dnd-kit Sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleAddCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serverUrl || !newCategoryName.trim()) {
      setAddCategoryError('Category name cannot be empty.');
      return;
    }

    setIsAddingCategory(true);
    setAddCategoryError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const createUrl = `${baseUrl}/forum/categories`;

      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          description: newCategoryDesc.trim(),
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to add category';
        try {
          errorText = await response.text();
        } catch (_) {} // Ignore error reading text
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      // Success!
      setNewCategoryName(''); // Clear form
      setNewCategoryDesc('');
      await fetchAdminData(); // Refetch the list
    } catch (error: unknown) {
      console.error('Error adding category:', error);
      setAddCategoryError(
        error instanceof Error ? error.message : 'Failed to add category',
      );
    } finally {
      setIsAddingCategory(false);
    }
  };

  const handleShowAddBoardForm = (categoryId: string) => {
    setAddingBoardToCategoryId(categoryId);
    setNewBoardName('');
    setNewBoardDesc('');
    setAddBoardError(null);
  };

  const handleCancelAddBoard = () => {
    setAddingBoardToCategoryId(null);
    setAddBoardError(null);
  };

  const handleAddBoard = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverUrl || !addingBoardToCategoryId || !newBoardName.trim()) {
      setAddBoardError('Board name cannot be empty.');
      return;
    }

    setIsAddingBoard(true);
    setAddBoardError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const createUrl = `${baseUrl}/forum/categories/${addingBoardToCategoryId}/boards`;

      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newBoardName.trim(),
          description: newBoardDesc.trim(),
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to add board';
        try {
          errorText = await response.text();
        } catch (_) {}
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      handleCancelAddBoard();
      await fetchAdminData();
    } catch (error: unknown) {
      console.error('Error adding board:', error);
      setAddBoardError(
        error instanceof Error ? error.message : 'Failed to add board',
      );
    } finally {
      setIsAddingBoard(false);
    }
  };

  const handleEditBoard = (board: Board) => {
    setEditingBoard(board);
    setEditBoardName(board.name);
    setEditBoardDesc(board.description);
    setSaveBoardError(null);
    setAddingBoardToCategoryId(null);
  };

  const handleCancelEditBoard = () => {
    setEditingBoard(null);
    setSaveBoardError(null);
  };

  const handleSaveBoard = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverUrl || !editingBoard || !editBoardName.trim()) {
      setSaveBoardError('Board name cannot be empty.');
      return;
    }

    setIsSavingBoard(true);
    setSaveBoardError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const updateUrl = `${baseUrl}/forum/boards/${editingBoard.id}`;

      const response = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editBoardName.trim(),
          description: editBoardDesc.trim(),
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to save board';
        try {
          errorText = await response.text();
        } catch (_) {}
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      handleCancelEditBoard();
      await fetchAdminData();
    } catch (error: unknown) {
      console.error('Error saving board:', error);
      setSaveBoardError(
        error instanceof Error ? error.message : 'Failed to save board',
      );
    } finally {
      setIsSavingBoard(false);
    }
  };

  const handleDeleteBoard = async (boardId: string, boardName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the board "${boardName}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingBoardId(boardId);
    setDeleteBoardError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl!.endsWith('/')
        ? serverUrl!.slice(0, -1)
        : serverUrl!;
      const deleteUrl = `${baseUrl}/forum/boards/${boardId}`;

      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders },
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = `Failed to delete board (Status: ${response.status})`;
        try {
          errorText = (await response.text()) || errorText;
        } catch (_) {}
        throw new Error(errorText);
      }

      await fetchAdminData();
    } catch (error: unknown) {
      console.error(`Error deleting board ${boardId}:`, error);
      setDeleteBoardError(
        error instanceof Error ? error.message : 'Failed to delete board',
      );
    } finally {
      setDeletingBoardId(null);
    }
  };

  const handleDeleteCategory = async (
    categoryId: string,
    categoryName: string,
  ) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the category "${categoryName}"?\n\nTHIS WILL ALSO DELETE ALL BOARDS WITHIN THIS CATEGORY. This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingCategoryId(categoryId);
    setDeleteCategoryError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl!.endsWith('/')
        ? serverUrl!.slice(0, -1)
        : serverUrl!;
      const deleteUrl = `${baseUrl}/forum/categories/${categoryId}`;

      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders },
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = `Failed to delete category (Status: ${response.status})`;
        try {
          errorText = (await response.text()) || errorText;
        } catch (_) {}
        throw new Error(errorText);
      }

      await fetchAdminData();
    } catch (error: unknown) {
      console.error(`Error deleting category ${categoryId}:`, error);
      setDeleteCategoryError(
        error instanceof Error ? error.message : 'Failed to delete category',
      );
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const handleEditCategory = (category: Omit<Category, 'boards'>) => {
    setEditingCategory(category);
    setEditCategoryName(category.name);
    setEditCategoryDesc(category.description);
    setSaveCategoryError(null);
    setAddingBoardToCategoryId(null);
    setEditingBoard(null);
  };

  const handleCancelEditCategory = () => {
    setEditingCategory(null);
    setSaveCategoryError(null);
  };

  const handleSaveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverUrl || !editingCategory || !editCategoryName.trim()) {
      setSaveCategoryError('Category name cannot be empty.');
      return;
    }

    setIsSavingCategory(true);
    setSaveCategoryError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const updateUrl = `${baseUrl}/forum/categories/${editingCategory.id}`;

      const response = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editCategoryName.trim(),
          description: editCategoryDesc.trim(),
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to save category';
        try {
          errorText = await response.text();
        } catch (_) {}
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      handleCancelEditCategory();
      await fetchAdminData();
    } catch (error: unknown) {
      console.error('Error saving category:', error);
      setSaveCategoryError(
        error instanceof Error ? error.message : 'Failed to save category',
      );
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id.toString());
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over) {
      return;
    }

    if (active.id === over.id) {
      return;
    }

    const activeId = active.id.toString();
    const overId = over.id.toString();

    const isCategoryDrag = categories.some(
      (cat) => `category-${cat.id}` === activeId,
    );

    setCategories((prevCategories) => {
      let newCategories = [...prevCategories];

      if (isCategoryDrag) {
        const oldIndex = newCategories.findIndex(
          (cat) => `category-${cat.id}` === activeId,
        );
        const newIndex = newCategories.findIndex(
          (cat) => `category-${cat.id}` === overId,
        );

        if (oldIndex === -1 || newIndex === -1) return prevCategories;

        newCategories = arrayMove(newCategories, oldIndex, newIndex);

        const orderedCategoryIds = newCategories.map((cat) => cat.id);
        saveCategoryOrder(orderedCategoryIds, serverUrl, fetchHeaders).catch(
          (error) => {
            console.error('Error saving category order:', error);
            setDataError('Failed to save category order. Please refresh.');
          },
        );
      } else {
        let sourceCategoryIndex = -1;
        let sourceBoardIndex = -1;
        let targetCategoryIndex = -1;
        let targetBoardIndex = -1;

        for (let i = 0; i < newCategories.length; i++) {
          const boardIndex = newCategories[i].boards.findIndex(
            (board: Board) => `board-${board.id}` === overId,
          );
          if (boardIndex !== -1) {
            targetCategoryIndex = i;
            targetBoardIndex = boardIndex;
            break;
          }
        }

        if (targetCategoryIndex === -1) {
          if (overId.startsWith('category-')) {
            const catId = overId.replace('category-', '');
            const catIndex = newCategories.findIndex((c) => c.id === catId);
            if (catIndex !== -1) {
              targetCategoryIndex = catIndex;
              targetBoardIndex = -1;
            } else {
            }
          } else {
          }
        }

        if (targetCategoryIndex === -1) {
          console.warn('Could not determine target category after checks.');
          return prevCategories;
        }

        for (let i = 0; i < newCategories.length; i++) {
          const boardIndex = newCategories[i].boards.findIndex(
            (board: Board) => `board-${board.id}` === activeId,
          );
          if (boardIndex !== -1) {
            sourceCategoryIndex = i;
            sourceBoardIndex = boardIndex;
            break;
          }
        }
        if (sourceCategoryIndex === -1) {
          console.error('Could not find source category for active board!');
          return prevCategories;
        }

        const actualBoardToMove =
          prevCategories[sourceCategoryIndex]?.boards[sourceBoardIndex];
        if (!actualBoardToMove) {
          console.error('Could not find boardToMove with updated indices!');
          return prevCategories;
        }

        if (sourceCategoryIndex === targetCategoryIndex) {
          const categoryToUpdate = { ...newCategories[sourceCategoryIndex] };
          const finalTargetBoardIndex =
            targetBoardIndex === -1
              ? categoryToUpdate.boards.length - 1
              : targetBoardIndex;
          categoryToUpdate.boards = arrayMove(
            categoryToUpdate.boards,
            sourceBoardIndex,
            finalTargetBoardIndex,
          );
          newCategories[sourceCategoryIndex] = categoryToUpdate;

          const orderedBoardIds = categoryToUpdate.boards.map(
            (board: Board) => board.id,
          );
          saveBoardOrder(orderedBoardIds, serverUrl, fetchHeaders).catch(
            (error) => {
              console.error('Error saving board order:', error);
              setDataError('Failed to save board order. Please refresh.');
            },
          );
        } else {
          const finalCategories = prevCategories.map(
            (category: Category, index: number) => {
              if (index === sourceCategoryIndex) {
                const filteredBoards = category.boards.filter(
                  (board: Board) => board.id !== actualBoardToMove.id,
                );
                return {
                  ...category,
                  boards: filteredBoards,
                };
              }
              if (index === targetCategoryIndex) {
                const updatedMovedBoard = {
                  ...actualBoardToMove,
                  category_id: category.id,
                };
                const targetIndex =
                  targetBoardIndex === -1
                    ? category.boards.length
                    : targetBoardIndex;
                const newBoards = [...category.boards];
                newBoards.splice(targetIndex, 0, updatedMovedBoard);
                return {
                  ...category,
                  boards: newBoards,
                };
              }
              return category;
            },
          );

          const sourceBoardIds = finalCategories[
            sourceCategoryIndex
          ].boards.map((board: Board) => board.id);
          const targetBoardIds = finalCategories[
            targetCategoryIndex
          ].boards.map((board: Board) => board.id);

          saveBoardOrder(sourceBoardIds, serverUrl, fetchHeaders).catch(
            (error) => {
              console.error('Error saving board order:', error);
              setDataError('Failed to save board order. Please refresh.');
            },
          );
          saveBoardOrder(targetBoardIds, serverUrl, fetchHeaders).catch(
            (error) => {
              console.error('Error saving board order:', error);
              setDataError('Failed to save board order. Please refresh.');
            },
          );
          updateBoardCategory(
            actualBoardToMove.id,
            finalCategories[targetCategoryIndex].id,
            serverUrl,
            categories,
            fetchHeaders,
          ).catch((error) => {
            console.error('Error updating board category:', error);
            setDataError('Failed to update board category. Please refresh.');
          });

          newCategories = finalCategories;
        }
      }

      return newCategories; // Return updated state
    });
  };

  const findItemData = (id: string | null) => {
    if (!id) return null;
    if (id.startsWith('category-')) {
      const catId = id.replace('category-', '');
      return categories.find((cat) => cat.id === catId);
    } else if (id.startsWith('board-')) {
      const boardId = id.replace('board-', '');
      return categories
        .flatMap((cat) => cat.boards)
        .find((board) => board.id === boardId);
    }
    return null;
  };

  const activeItemData = findItemData(activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <h2 className="text-xl font-semibold">Manage Categories & Boards</h2>

        <form
          onSubmit={handleAddCategory}
          className="p-4 border rounded shadow-sm bg-gray-50 space-y-3"
        >
          <h3 className="text-lg font-medium">Add New Category</h3>
          <div>
            <label
              htmlFor="newCatName"
              className="block text-sm font-medium text-gray-700"
            >
              Name
            </label>
            <input
              id="newCatName"
              type="text"
              value={newCategoryName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewCategoryName(e.target.value)
              }
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="newCatDesc"
              className="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="newCatDesc"
              value={newCategoryDesc}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNewCategoryDesc(e.target.value)
              }
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          {addCategoryError && (
            <p className="text-sm text-red-600">Error: {addCategoryError}</p>
          )}
          <button
            type="submit"
            disabled={isAddingCategory || !newCategoryName.trim()}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAddingCategory ? 'Adding...' : 'Add Category'}
          </button>
        </form>

        <h2 className="text-xl font-semibold pt-4">Existing Categories</h2>
        {categories.length === 0 ? (
          <p>No categories found.</p>
        ) : (
          <SortableContext
            items={categories.map((cat) => `category-${cat.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {categories.map((category) => (
              <SortableItem key={category.id} id={`category-${category.id}`}>
                {(listeners, attributes) => (
                  <div className="p-4 border rounded shadow-sm space-y-4 bg-white mb-4">
                    {editingCategory && editingCategory.id === category.id ? (
                      <form
                        onSubmit={handleSaveCategory}
                        className="space-y-3 mb-4"
                      >
                        <h3 className="text-lg font-medium">
                          Editing Category: {editingCategory.name}
                        </h3>
                        <div>
                          <label
                            htmlFor={`editCatName-${category.id}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            Name
                          </label>
                          <input
                            id={`editCatName-${category.id}`}
                            type="text"
                            value={editCategoryName}
                            onChange={(e) =>
                              setEditCategoryName(e.target.value)
                            }
                            required
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`editCatDesc-${category.id}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            Description
                          </label>
                          <textarea
                            id={`editCatDesc-${category.id}`}
                            value={editCategoryDesc}
                            onChange={(e) =>
                              setEditCategoryDesc(e.target.value)
                            }
                            rows={2}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                        {saveCategoryError && (
                          <p className="text-sm text-red-600">
                            Error: {saveCategoryError}
                          </p>
                        )}
                        <div className="flex space-x-2">
                          <button
                            type="submit"
                            disabled={
                              isSavingCategory || !editCategoryName.trim()
                            }
                            className="inline-flex justify-center py-1 px-3 border border-transparent shadow-sm text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSavingCategory ? 'Saving...' : 'Save Category'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditCategory}
                            disabled={isSavingCategory}
                            className="inline-flex justify-center py-1 px-3 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex justify-between items-center mb-2">
                        <DragHandle
                          listeners={listeners}
                          attributes={attributes}
                        />
                        <div className="flex-grow mr-4">
                          <h3 className="text-lg font-medium truncate">
                            {category.name}
                          </h3>
                          <p className="text-sm text-gray-600 truncate">
                            {category.description}
                          </p>
                        </div>
                        <div className="flex space-x-2 flex-shrink-0">
                          <button
                            onClick={() =>
                              handleEditCategory({
                                id: category.id,
                                name: category.name,
                                description: category.description,
                                order: category.order,
                              })
                            }
                            disabled={
                              !!editingCategory ||
                              !!editingBoard ||
                              !!deletingCategoryId ||
                              !!deletingBoardId ||
                              isAddingBoard ||
                              isAddingCategory
                            }
                            className="text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteCategory(category.id, category.name)
                            }
                            disabled={
                              !!editingCategory ||
                              !!editingBoard ||
                              !!deletingCategoryId ||
                              !!deletingBoardId ||
                              isAddingBoard ||
                              isAddingCategory
                            }
                            className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded"
                          >
                            {deletingCategoryId === category.id
                              ? 'Deleting...'
                              : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                    {!(
                      editingCategory && editingCategory.id === category.id
                    ) && (
                      <>
                        <div>
                          <h4 className="text-md font-semibold mb-2 pl-5">
                            Boards:
                          </h4>
                          {category.boards.length === 0 ? (
                            <p className="text-sm text-gray-500 pl-5">
                              No boards in this category.
                            </p>
                          ) : (
                            <SortableContext
                              items={category.boards.map(
                                (board) => `board-${board.id}`,
                              )}
                              strategy={verticalListSortingStrategy}
                            >
                              <ul className="space-y-1 pl-5 min-h-[2rem] py-1">
                                {category.boards.length === 0 && (
                                  <li className="text-sm text-gray-400 italic pl-2">
                                    (No boards)
                                  </li>
                                )}
                                {category.boards.map((board) => (
                                  <SortableItem
                                    key={board.id}
                                    id={`board-${board.id}`}
                                  >
                                    {(boardListeners, boardAttributes) => (
                                      <li className="flex justify-between items-center group py-1.5 bg-gray-50 rounded px-2">
                                        {editingBoard &&
                                        editingBoard.id === board.id ? (
                                          <form
                                            onSubmit={handleSaveBoard}
                                            className="space-y-3 mb-4"
                                          >
                                            <h3 className="text-lg font-medium">
                                              Editing Board: {board.name}
                                            </h3>
                                            <div>
                                              <label
                                                htmlFor={`editBoardName-${board.id}`}
                                                className="block text-sm font-medium text-gray-700"
                                              >
                                                Name
                                              </label>
                                              <input
                                                id={`editBoardName-${board.id}`}
                                                type="text"
                                                value={editBoardName}
                                                onChange={(e) =>
                                                  setEditBoardName(
                                                    e.target.value,
                                                  )
                                                }
                                                required
                                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                              />
                                            </div>
                                            <div>
                                              <label
                                                htmlFor={`editBoardDesc-${board.id}`}
                                                className="block text-sm font-medium text-gray-700"
                                              >
                                                Description
                                              </label>
                                              <textarea
                                                id={`editBoardDesc-${board.id}`}
                                                value={editBoardDesc}
                                                onChange={(e) =>
                                                  setEditBoardDesc(
                                                    e.target.value,
                                                  )
                                                }
                                                rows={2}
                                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                              />
                                            </div>
                                            {saveBoardError && (
                                              <p className="text-sm text-red-600">
                                                Error: {saveBoardError}
                                              </p>
                                            )}
                                            <div className="flex space-x-2">
                                              <button
                                                type="submit"
                                                disabled={
                                                  isSavingBoard ||
                                                  !editBoardName.trim()
                                                }
                                                className="inline-flex justify-center py-1 px-3 border border-transparent shadow-sm text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                {isSavingBoard
                                                  ? 'Saving...'
                                                  : 'Save Board'}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={handleCancelEditBoard}
                                                disabled={isSavingBoard}
                                                className="inline-flex justify-center py-1 px-3 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </form>
                                        ) : (
                                          <>
                                            <DragHandle
                                              listeners={boardListeners}
                                              attributes={boardAttributes}
                                            />
                                            <div className="flex-grow mr-2 truncate">
                                              <span className="font-medium">
                                                {board.name}
                                              </span>
                                            </div>
                                            <div className="flex space-x-2 flex-shrink-0">
                                              <button
                                                onClick={() =>
                                                  handleEditBoard(board)
                                                }
                                                disabled={
                                                  !!editingBoard ||
                                                  !!deletingBoardId ||
                                                  isAddingBoard ||
                                                  isAddingCategory
                                                }
                                                className="text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                Edit
                                              </button>
                                              <button
                                                onClick={() =>
                                                  handleDeleteBoard(
                                                    board.id,
                                                    board.name,
                                                  )
                                                }
                                                disabled={
                                                  !!editingBoard ||
                                                  !!deletingBoardId ||
                                                  isAddingBoard ||
                                                  isAddingCategory
                                                }
                                                className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded"
                                              >
                                                {deletingBoardId === board.id
                                                  ? 'Deleting...'
                                                  : 'Delete'}
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </li>
                                    )}
                                  </SortableItem>
                                ))}
                              </ul>
                            </SortableContext>
                          )}
                        </div>
                        <div className="pl-5 pt-2">
                          {addingBoardToCategoryId === category.id ? (
                            <form
                              onSubmit={handleAddBoard}
                              className="mt-4 p-3 border-t border-dashed space-y-2"
                            >
                              <h5 className="font-medium text-sm">
                                Add New Board to &quot;{category.name}&quot;
                              </h5>
                              <div>
                                <label
                                  htmlFor={`newBoardName-${category.id}`}
                                  className="block text-sm font-medium text-gray-700"
                                >
                                  Name
                                </label>
                                <input
                                  id={`newBoardName-${category.id}`}
                                  type="text"
                                  value={newBoardName}
                                  onChange={(e) =>
                                    setNewBoardName(e.target.value)
                                  }
                                  required
                                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`newBoardDesc-${category.id}`}
                                  className="block text-sm font-medium text-gray-700"
                                >
                                  Description
                                </label>
                                <textarea
                                  id={`newBoardDesc-${category.id}`}
                                  value={newBoardDesc}
                                  onChange={(e) =>
                                    setNewBoardDesc(e.target.value)
                                  }
                                  rows={2}
                                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                              </div>
                              {addBoardError && (
                                <p className="text-sm text-red-600">
                                  Error: {addBoardError}
                                </p>
                              )}
                              <div className="flex space-x-2">
                                <button
                                  type="submit"
                                  disabled={
                                    isAddingBoard ||
                                    !newBoardName.trim() ||
                                    !!editingCategory ||
                                    !!editingBoard
                                  }
                                  className="inline-flex justify-center py-1 px-3 border border-transparent shadow-sm text-xs font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isAddingBoard ? 'Adding...' : 'Save Board'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelAddBoard}
                                  disabled={isAddingBoard}
                                  className="inline-flex justify-center py-1 px-3 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <button
                              onClick={() =>
                                handleShowAddBoardForm(category.id)
                              }
                              disabled={
                                !!editingCategory ||
                                !!editingBoard ||
                                !!deletingCategoryId ||
                                !!deletingBoardId ||
                                isAddingBoard ||
                                isAddingCategory
                              }
                              className="mt-4 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              + Add New Board
                            </button>
                          )}
                        </div>
                      </>
                    )}{' '}
                  </div>
                )}
              </SortableItem>
            ))}
          </SortableContext>
        )}

        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeId && activeItemData ? (
              activeId.startsWith('category-') ? (
                <div className="p-4 border rounded shadow-sm space-y-4 bg-white opacity-90">
                  <div className="flex justify-between items-center mb-2">
                    <button className="p-1 text-gray-400 cursor-grabbing touch-none">
                      <GripVertical size={16} />
                    </button>
                    <div className="flex-grow mr-4">
                      <h3 className="text-lg font-medium truncate">
                        {(activeItemData as Category).name}
                      </h3>
                      <p className="text-sm text-gray-600 truncate">
                        {(activeItemData as Category).description}
                      </p>
                    </div>
                  </div>
                </div>
              ) : activeId.startsWith('board-') ? (
                <li className="flex justify-between items-center group py-1.5 bg-gray-100 rounded px-2 opacity-90 shadow-md">
                  <button className="p-1 text-gray-400 cursor-grabbing touch-none">
                    <GripVertical size={16} />
                  </button>
                  <div className="flex-grow mr-2 truncate">
                    <span className="font-medium">
                      {(activeItemData as Board).name}
                    </span>
                  </div>
                </li>
              ) : null
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </div>
    </DndContext>
  );
}
