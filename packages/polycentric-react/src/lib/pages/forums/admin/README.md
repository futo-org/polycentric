# Admin Panel Refactored Structure

This directory contains the refactored admin panel components, split into smaller, more maintainable modules.

## File Structure

```
admin/
├── components/
│   ├── CategoriesAndBoards.tsx    # Drag & drop categories/boards management
│   ├── UserManagement.tsx         # User and banned user management
│   ├── Modals.tsx                 # Modal components (ban user modal)
│   ├── DragComponents.tsx         # Reusable drag & drop components
│   └── index.ts                   # Component exports
├── hooks/
│   └── hooks.ts                   # Custom hooks for data fetching
├── utils/
│   └── utils.ts                   # Utility functions for API calls
├── types.ts                       # TypeScript interfaces
├── AdminPanelPage.tsx             # Main admin panel component
└── README.md                      # This file
```

## Components

### AdminPanelPage.tsx

The main admin panel component that orchestrates all the sub-components. It handles:

- Admin authentication checks
- Loading and error states
- User ban/unban operations
- Component coordination

### CategoriesAndBoards.tsx

Handles all category and board management including:

- Drag & drop reordering
- CRUD operations for categories and boards
- Form handling for add/edit operations
- Real-time updates

### UserManagement.tsx

Manages user-related functionality:

- Display all users with profile information
- Show banned users list
- Ban/unban user operations
- Modal handling for ban operations

### Modals.tsx

Contains modal components:

- BanUserModal: Modal for banning users with reason input

### DragComponents.tsx

Reusable drag & drop components:

- SortableItem: Wrapper for draggable items
- DragHandle: Visual drag handle component

## Hooks

### useAdminData

Custom hook for fetching and managing categories and boards data:

- Fetches categories and their boards
- Handles loading and error states
- Provides data refresh functionality

### useUserManagement

Custom hook for user management:

- Fetches all users and banned users
- Handles loading and error states
- Provides user data refresh functionality

## Utils

### API Functions

- `saveCategoryOrder`: Saves category reordering
- `saveBoardOrder`: Saves board reordering
- `updateBoardCategory`: Updates board category assignment

## Types

### Interfaces

- `Category`: Category with boards
- `Board`: Board information
- `ForumUser`: User information
- `BannedUser`: Banned user information

## Usage

The main `AdminPanelPage` component can be imported and used directly:

```tsx
import { AdminPanelPage } from './admin/AdminPanelPage';

// Use in your router or parent component
<AdminPanelPage />;
```

## Benefits of Refactoring

1. **Maintainability**: Each component has a single responsibility
2. **Reusability**: Components can be reused in other contexts
3. **Testability**: Smaller components are easier to test
4. **Readability**: Code is more organized and easier to understand
5. **Performance**: Better separation of concerns allows for optimized re-renders
