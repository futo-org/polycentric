import { createContext, useContext } from 'react';

export type ImageViewerContextType = {
    setViewerLink: (link: string) => void;
};

export const ImageViewerContext = createContext<ImageViewerContextType>({
    setViewerLink: (link: string) => {},
});

export const useImageViewerContext = () => useContext(ImageViewerContext);
