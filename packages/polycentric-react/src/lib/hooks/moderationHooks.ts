import { useContext } from 'react';

import { ModerationContext } from '../app/contexts';

export const useModeration = () => {
    const context = useContext(ModerationContext);
    if (!context) {
        throw new Error(
            'useModeration must be used within a ModerationProvider',
        );
    }
    return context;
};
