export type UnregisterCallback = () => void;

export const DuplicatedCallbackError = new Error('duplicated callback');
