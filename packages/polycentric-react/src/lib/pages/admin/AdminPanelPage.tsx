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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react'; // Using lucide for handle icon
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom'; // Needed for DragOverlay
import { useParams } from '../../hooks/stackRouterHooks';
import { useAuthHeaders } from '../../hooks/useAuthHeaders';
import { useIsAdmin } from '../../hooks/useIsAdmin';

interface Category {
  id: string;
  name: string;
  description: string;
  order: number; // Added order
  boards: Board[];
}

interface Board {
  id: string;
  category_id: string; // Keep category_id reference
  name: string;
  description: string;
  order: number; // Added order
}

// Sortable Item component - Now accepts render prop for content
function SortableItem(props: {
  id: string;
  children: (listeners: any, attributes: any) => React.ReactNode; // Render prop
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1, // Hide original item completely when dragging
    cursor: 'default', // Set base cursor to default, handle grab on the handle
  };

  return (
    // Remove listeners/attributes from the main div
    <div ref={setNodeRef} style={style}>
      {/* Pass listeners/attributes to the children render prop */}
      {props.children(listeners, attributes)}
    </div>
  );
}

// Drag Handle Component - Now part of the item content
function DragHandle({
  listeners,
  attributes,
}: {
  listeners: any;
  attributes: any;
}) {
  return (
    <button
      {...attributes}
      {...listeners}
      className="p-1 text-gray-400 hover:text-gray-600 cursor-grab touch-none"
    >
      <GripVertical size={16} />
    </button>
  );
}

export const AdminPanelPage: React.FC = () => {
  // Extract wildcard parameter using params['*']
  const params = useParams<{ '*'?: string }>();
  const encodedServerUrl = params['*'];
  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : undefined;

  const {
    isAdmin,
    loading: adminLoading,
    error: adminError,
  } = useIsAdmin(serverUrl || '');
  const {
    fetchHeaders,
    loading: headersLoading,
    error: headersError,
  } = useAuthHeaders(serverUrl);

  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [hasLoadedSuccessfully, setHasLoadedSuccessfully] = useState(false);

  // State for Add Category form
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [addCategoryError, setAddCategoryError] = useState<string | null>(null);

  // State for Add Board form
  const [addingBoardToCategoryId, setAddingBoardToCategoryId] = useState<
    string | null
  >(null); // Track which category form is open
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [isAddingBoard, setIsAddingBoard] = useState(false);
  const [addBoardError, setAddBoardError] = useState<string | null>(null);

  // State for Delete Board
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [deleteBoardError, setDeleteBoardError] = useState<string | null>(null);

  // State for Delete Category
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
    null,
  );
  const [deleteCategoryError, setDeleteCategoryError] = useState<string | null>(
    null,
  );

  // State for Edit Board form
  const [editingBoard, setEditingBoard] = useState<Board | null>(null); // Store the whole board being edited
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardDesc, setEditBoardDesc] = useState('');
  const [isSavingBoard, setIsSavingBoard] = useState(false);
  const [saveBoardError, setSaveBoardError] = useState<string | null>(null);

  // State for Edit Category form
  const [editingCategory, setEditingCategory] = useState<Omit<
    Category,
    'boards'
  > | null>(null); // Store category info without boards
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryDesc, setEditCategoryDesc] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [saveCategoryError, setSaveCategoryError] = useState<string | null>(
    null,
  );

  const [activeId, setActiveId] = useState<string | null>(null); // State for dragged item ID

  // Combined loading state - add isSavingCategory
  const overallLoading =
    adminLoading ||
    loadingData ||
    isAddingCategory ||
    isAddingBoard ||
    !!deletingBoardId ||
    !!deletingCategoryId ||
    isSavingBoard ||
    isSavingCategory ||
    headersLoading;
  // Combined error state - add saveCategoryError
  const overallError =
    adminError ||
    dataError ||
    addCategoryError ||
    addBoardError ||
    deleteBoardError ||
    deleteCategoryError ||
    saveBoardError ||
    saveCategoryError ||
    headersError;

  // --- dnd-kit Sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // Require slight move before dragging
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Fetch data function (ensure it now fetches and sorts by order)
  const fetchAdminData = useCallback(async () => {
    // Ensure dependencies are available
    // Note: Dependencies like serverUrl, isAdmin are accessed directly from component scope
    if (!serverUrl || !isAdmin) {
      setCategories([]);
      setLoadingData(false);
      setHasLoadedSuccessfully(false);
      return;
    }

    setLoadingData(true);
    setDataError(null);

    try {
      // Note: fetchHeaders is stable from its own hook
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        console.error('[AdminPanelPage Fetch] Failed to get auth headers.');
        throw new Error(
          'Could not get authentication headers to fetch admin data.',
        );
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;

      // Fetch all categories (ensure backend sorts by order)
      const catApiUrl = `${baseUrl}/forum/categories`;
      const catResponse = await fetch(catApiUrl, {
        headers: { ...authHeaders },
        credentials: 'include',
      });
      if (!catResponse.ok) {
        throw new Error(
          `Failed to fetch categories: ${catResponse.status} ${catResponse.statusText}`,
        );
      }
      const fetchedCategories: Omit<Category, 'boards'>[] =
        await catResponse.json();

      // Fetch boards for each category (ensure backend sorts by order)
      const categoriesWithBoards: Category[] = await Promise.all(
        fetchedCategories.map(async (category) => {
          const boardApiUrl = `${baseUrl}/forum/categories/${category.id}/boards`;
          try {
            const boardResponse = await fetch(boardApiUrl, {
              headers: { ...authHeaders },
              credentials: 'include',
            });
            if (!boardResponse.ok) {
              console.error(
                `Failed to fetch boards for category ${category.id}: ${boardResponse.status} ${boardResponse.statusText}`,
              );
              return { ...category, boards: [] };
            }
            const boards: Board[] = await boardResponse.json();
            // Manually add category_id back for frontend use if backend doesn't include it in board details
            const boardsWithCatId = boards.map((b) => ({
              ...b,
              category_id: category.id,
            }));
            return { ...category, boards: boardsWithCatId };
          } catch (boardError) {
            console.error(
              `[AdminPanelPage Fetch]   Error fetching boards for category ${category.id}:`,
              boardError,
            );
            return { ...category, boards: [] };
          }
        }),
      );
      // Sort categories by order on the client-side as well
      categoriesWithBoards.sort((a, b) => a.order - b.order);
      // Sort boards within each category client-side
      categoriesWithBoards.forEach((cat) =>
        cat.boards.sort((a, b) => a.order - b.order),
      );

      setCategories(categoriesWithBoards);
      setHasLoadedSuccessfully(true);
    } catch (error: any) {
      console.error(
        '[AdminPanelPage Fetch] ERROR caught in fetchAdminData:',
        error,
      );
      setDataError(error.message || 'Failed to load admin data');
      setCategories([]);
      setHasLoadedSuccessfully(false);
    } finally {
      setLoadingData(false);
    }
  }, [serverUrl, isAdmin, fetchHeaders]);

  // Initial fetch effect - Fetch only when we know we are admin
  useEffect(() => {
    // Only trigger fetch if we have the URL and isAdmin is definitively true
    if (serverUrl && isAdmin === true) {
      fetchAdminData();
    } else {
      // Clear data if conditions are not met (e.g., logged out, not admin)
      setCategories([]);
      setHasLoadedSuccessfully(false);
    }
    // Depend explicitly on serverUrl and the boolean value of isAdmin
  }, [serverUrl, isAdmin, fetchAdminData]); // Keep fetchAdminData dependency for useCallback

  // Handler for adding a new category
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
    } catch (error: any) {
      console.error('Error adding category:', error);
      setAddCategoryError(error.message || 'Failed to add category');
    } finally {
      setIsAddingCategory(false);
    }
  };

  // Handler for initiating adding a new board
  const handleShowAddBoardForm = (categoryId: string) => {
    setAddingBoardToCategoryId(categoryId); // Set the category ID to show the form
    setNewBoardName(''); // Clear previous input
    setNewBoardDesc('');
    setAddBoardError(null); // Clear previous errors
  };

  // Handler for canceling add board form
  const handleCancelAddBoard = () => {
    setAddingBoardToCategoryId(null); // Hide the form
    setAddBoardError(null);
  };

  // Handler for adding a new board
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
      // Use the category ID in the URL
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

      // Success!
      handleCancelAddBoard(); // Hide form
      await fetchAdminData(); // Refetch the list
    } catch (error: any) {
      console.error('Error adding board:', error);
      setAddBoardError(error.message || 'Failed to add board');
    } finally {
      setIsAddingBoard(false);
    }
  };

  // Handler for initiating board edit
  const handleEditBoard = (board: Board) => {
    setEditingBoard(board); // Set the board to edit
    setEditBoardName(board.name); // Populate form
    setEditBoardDesc(board.description);
    setSaveBoardError(null); // Clear previous errors
    // Hide other forms if open
    setAddingBoardToCategoryId(null);
  };

  // Handler for canceling board edit
  const handleCancelEditBoard = () => {
    setEditingBoard(null); // Clear editing state
    setSaveBoardError(null);
  };

  // Handler for saving edited board
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
      const updateUrl = `${baseUrl}/forum/boards/${editingBoard.id}`; // Use editingBoard.id

      const response = await fetch(updateUrl, {
        method: 'PUT', // Use PUT for update
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

      // Success!
      handleCancelEditBoard(); // Hide form
      await fetchAdminData(); // Refetch the list
    } catch (error: any) {
      console.error('Error saving board:', error);
      setSaveBoardError(error.message || 'Failed to save board');
    } finally {
      setIsSavingBoard(false);
    }
  };

  // Handler for deleting a board
  const handleDeleteBoard = async (boardId: string, boardName: string) => {
    // Simple confirmation
    if (
      !window.confirm(
        `Are you sure you want to delete the board "${boardName}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingBoardId(boardId); // Indicate deletion is in progress
    setDeleteBoardError(null); // Clear previous errors

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
        // Handle non-204 responses (e.g., 404 Not Found, 401 Unauthorized, 500 Server Error)
        let errorText = `Failed to delete board (Status: ${response.status})`;
        try {
          errorText = (await response.text()) || errorText;
        } catch (_) {}
        throw new Error(errorText);
      }

      await fetchAdminData(); // Refetch the list
    } catch (error: any) {
      console.error(`Error deleting board ${boardId}:`, error);
      setDeleteBoardError(error.message || 'Failed to delete board');
    } finally {
      setDeletingBoardId(null); // Reset deletion indicator
    }
  };

  // Handler for deleting a category
  const handleDeleteCategory = async (
    categoryId: string,
    categoryName: string,
  ) => {
    // Add confirmation, maybe stricter warning about deleting boards too?
    if (
      !window.confirm(
        `Are you sure you want to delete the category "${categoryName}"?\n\nTHIS WILL ALSO DELETE ALL BOARDS WITHIN THIS CATEGORY. This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingCategoryId(categoryId); // Indicate deletion is in progress
    setDeleteCategoryError(null); // Clear previous errors

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

      await fetchAdminData(); // Refetch the list
    } catch (error: any) {
      console.error(`Error deleting category ${categoryId}:`, error);
      setDeleteCategoryError(error.message || 'Failed to delete category');
    } finally {
      setDeletingCategoryId(null); // Reset deletion indicator
    }
  };

  // Handler for initiating category edit
  const handleEditCategory = (category: Omit<Category, 'boards'>) => {
    setEditingCategory(category);
    setEditCategoryName(category.name);
    setEditCategoryDesc(category.description);
    setSaveCategoryError(null);
    // Hide other forms
    setAddingBoardToCategoryId(null);
    setEditingBoard(null);
  };

  // Handler for canceling category edit
  const handleCancelEditCategory = () => {
    setEditingCategory(null);
    setSaveCategoryError(null);
  };

  // Handler for saving edited category
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

      // Success!
      handleCancelEditCategory(); // Hide form
      await fetchAdminData(); // Refetch the list
    } catch (error: any) {
      console.error('Error saving category:', error);
      setSaveCategoryError(error.message || 'Failed to save category');
    } finally {
      setIsSavingCategory(false);
    }
  };

  // --- Drag Start Handler ---
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id.toString());
  };

  // --- Drag End Handler ---
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null); // Clear active ID on drag end
    const { active, over } = event;

    if (!over) {
      return;
    }

    if (active.id === over.id) {
      return;
    }

    // --- Distinguish between Category and Board Drag ---
    const activeId = active.id.toString();
    const overId = over.id.toString();

    const isCategoryDrag = categories.some(
      (cat) => `category-${cat.id}` === activeId,
    );
    const isBoardDrag = !isCategoryDrag;

    setCategories((prevCategories) => {
      let newCategories = [...prevCategories]; // Start with a copy

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
        saveCategoryOrder(orderedCategoryIds);
      } else {
        // Board Drag
        // Initialize index variables
        let sourceCategoryIndex = -1;
        let sourceBoardIndex = -1;
        let targetCategoryIndex = -1;
        let targetBoardIndex = -1;

        // --- Find target category/board indices ---
        // 1. Try finding the target board first
        for (let i = 0; i < newCategories.length; i++) {
          const boardIndex = newCategories[i].boards.findIndex(
            (board) => `board-${board.id}` === overId,
          );
          if (boardIndex !== -1) {
            targetCategoryIndex = i;
            targetBoardIndex = boardIndex;
            break; // Found the board
          }
        }

        // 2. If no board was found, check if dropped onto a category container
        if (targetCategoryIndex === -1) {
          if (overId.startsWith('category-')) {
            const catId = overId.replace('category-', '');
            const catIndex = newCategories.findIndex((c) => c.id === catId);
            if (catIndex !== -1) {
              targetCategoryIndex = catIndex;
              targetBoardIndex = -1; // Dropped onto category, implies end of list
            } else {
            }
          } else {
          }
        }

        // If target still not found, something is wrong
        if (targetCategoryIndex === -1) {
          console.warn('Could not determine target category after checks.');
          return prevCategories;
        }

        // --- Find source category/board indices ---
        for (let i = 0; i < newCategories.length; i++) {
          const boardIndex = newCategories[i].boards.findIndex(
            (board) => `board-${board.id}` === activeId,
          );
          if (boardIndex !== -1) {
            sourceCategoryIndex = i;
            sourceBoardIndex = boardIndex;
            break; // Found the source board
          }
        }
        if (sourceCategoryIndex === -1) {
          console.error('Could not find source category for active board!');
          return prevCategories;
        }

        // Fetch the board object now that indices are known
        const actualBoardToMove =
          prevCategories[sourceCategoryIndex]?.boards[sourceBoardIndex];
        if (!actualBoardToMove) {
          console.error('Could not find boardToMove with updated indices!');
          return prevCategories;
        }

        // Check if dropping within the same category
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
            (board) => board.id,
          );
          saveBoardOrder(orderedBoardIds);
        } else {
          // --- Logic for moving board BETWEEN categories ---
          const finalCategories = prevCategories.map((category, index) => {
            // Source category: filter out the moved board
            if (index === sourceCategoryIndex) {
              const filteredBoards = category.boards.filter(
                (board) => board.id !== actualBoardToMove.id,
              );
              return {
                ...category,
                boards: filteredBoards,
              };
            }
            // Target category: insert the moved board (with updated category_id)
            if (index === targetCategoryIndex) {
              const updatedMovedBoard = {
                ...actualBoardToMove,
                category_id: category.id,
              }; // Update category_id
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
            // Other categories remain unchanged
            return category;
          });

          // API Calls
          const sourceBoardIds = finalCategories[
            sourceCategoryIndex
          ].boards.map((board) => board.id);
          const targetBoardIds = finalCategories[
            targetCategoryIndex
          ].boards.map((board) => board.id);

          saveBoardOrder(sourceBoardIds);
          saveBoardOrder(targetBoardIds);
          updateBoardCategory(
            actualBoardToMove.id,
            finalCategories[targetCategoryIndex].id,
          );

          newCategories = finalCategories;
        }
      }

      return newCategories; // Return updated state
    });
  };

  // --- API Call Functions for Reordering ---
  const saveCategoryOrder = async (orderedIds: string[]) => {
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
      // Optional: Refetch data to confirm, or rely on optimistic update
      // await fetchAdminData();
    } catch (error) {
      console.error('Error saving category order:', error);
      // TODO: Add user-facing error feedback, maybe revert optimistic update
      setDataError('Failed to save category order. Please refresh.'); // Simple error
    }
  };

  const saveBoardOrder = async (orderedIds: string[]) => {
    if (!serverUrl) return;
    // We assume all IDs belong to the same category here based on handleDragEnd logic
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
      // Optional: Refetch data
      // await fetchAdminData();
    } catch (error) {
      console.error('Error saving board order:', error);
      setDataError('Failed to save board order. Please refresh.'); // Simple error
    }
  };

  // --- API Call Function to Update Board's Category ---
  const updateBoardCategory = async (
    boardId: string,
    targetCategoryId: string,
  ) => {
    if (!serverUrl) return;
    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) throw new Error('No auth headers');

      const boardToUpdate = categories
        .flatMap((cat) => cat.boards)
        .find((board) => board.id === boardId);

      if (!boardToUpdate)
        throw new Error(`Board ${boardId} not found in state`);

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const response = await fetch(`${baseUrl}/forum/boards/${boardId}`, {
        // Use existing PUT endpoint
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        // Send existing name/desc along with the new category_id
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
      // Order updates are handled by saveBoardOrder calls
      // Optional: Refetch all data if needed, but optimistic update should suffice
      // await fetchAdminData();
    } catch (error) {
      console.error('Error updating board category:', error);
      setDataError('Failed to update board category. Please refresh.');
    }
  };

  // --- Find Item Data Helper (for DragOverlay) ---
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

  // --- Rendering Logic ---
  const activeItemData = findItemData(activeId); // Get data for overlay rendering

  let content;
  if (hasLoadedSuccessfully) {
    content = (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="max-w-4xl mx-auto space-y-6">
          <h2 className="text-xl font-semibold">Manage Categories & Boards</h2>

          {/* Add New Category Form */}
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

          {/* Existing Categories List - Now Sortable */}
          <h2 className="text-xl font-semibold pt-4">Existing Categories</h2>
          {categories.length === 0 && !loadingData ? (
            <p>No categories found.</p>
          ) : (
            <SortableContext
              items={categories.map((cat) => `category-${cat.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {categories.map((category) => (
                // Use SortableItem with render prop
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
                              type="button" // Important: prevent form submission
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
                          {/* --- Pass listeners/attrs to DragHandle --- */}
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
                      {/* Boards Section & Add Board Button - Conditionally Rendered Together */}
                      {!(
                        editingCategory && editingCategory.id === category.id
                      ) && (
                        <>
                          {' '}
                          {/* Wrap both sections in a Fragment */}
                          {/* --- Boards Section --- */}
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
                                                  onClick={
                                                    handleCancelEditBoard
                                                  }
                                                  disabled={isSavingBoard}
                                                  className="inline-flex justify-center py-1 px-3 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </form>
                                          ) : (
                                            <>
                                              {/* --- Pass listeners/attrs to DragHandle for Board --- */}
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
                          {/* --- Add New Board Button & Form --- */}
                          <div className="pl-5 pt-2">
                            {addingBoardToCategoryId === category.id ? (
                              <form
                                onSubmit={handleAddBoard}
                                className="mt-4 p-3 border-t border-dashed space-y-2"
                              >
                                <h5 className="font-medium text-sm">
                                  Add New Board to "{category.name}"
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
                                    type="button" // Prevent form submission
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
                        </> // Close Fragment
                      )}{' '}
                      {/* Close the conditional rendering for boards + add board */}
                    </div>
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          )}
        </div>

        {/* --- Drag Overlay --- */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {' '}
            {/* Optional: customize animation */}
            {activeId && activeItemData ? (
              activeId.startsWith('category-') ? (
                // Render Category Overlay Preview
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
                    {/* Don't render action buttons in overlay */}
                  </div>
                  {/* Maybe render placeholder for boards? */}
                </div>
              ) : activeId.startsWith('board-') ? (
                // Render Board Overlay Preview
                <li className="flex justify-between items-center group py-1.5 bg-gray-100 rounded px-2 opacity-90 shadow-md">
                  <button className="p-1 text-gray-400 cursor-grabbing touch-none">
                    <GripVertical size={16} />
                  </button>
                  <div className="flex-grow mr-2 truncate">
                    <span className="font-medium">
                      {(activeItemData as Board).name}
                    </span>
                    {/* {(activeItemData as Board).description && <span className="text-sm text-gray-600 ml-2"> - {(activeItemData as Board).description}</span>} */}
                  </div>
                  {/* Don't render action buttons in overlay */}
                </li>
              ) : null
            ) : null}
          </DragOverlay>,
          document.body, // Render overlay in body to avoid parent clipping/styling issues
        )}
      </DndContext>
    );
  }
  // ... rest of the component (loading states, return statement) ...

  return <div className="space-y-6">{content}</div>;
};
