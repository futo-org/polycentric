export type UnregisterCallback = () => void;

export const DuplicatedCallbackError = new Error('duplicated callback');
export const ImpossibleError = new Error('impossible');
export const CancelledError = new Error('cancelled');
