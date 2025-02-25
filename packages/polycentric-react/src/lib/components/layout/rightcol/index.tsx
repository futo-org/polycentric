import { ReactNode } from 'react';
import { useIsMobile } from '../../../hooks/styleHooks';
import { SearchBox } from '../../search/searchbox';

export const RightCol = ({
    children,
    rightCol,
    desktopTitle,
}: {
    rightCol: ReactNode;
    children: ReactNode;
    desktopTitle?: string;
}) => {
    const isMobile = useIsMobile();
    return (
        <div className="h-full overflow-auto flex noscrollbar bg-white">
            <div className="w-full lg:w-[700px] xl:w-[776px] relative">
                {isMobile === false && desktopTitle && (
                    <h1 className="p-10 border-b text-xl font-lg text-black">
                        {desktopTitle}
                    </h1>
                )}
                {children}
            </div>
            {isMobile === false && (
                <div className="h-full sticky top-0 border-x hidden xl:block xl:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:mr-[calc((100vw-1536px)/2)] ">
                    <div className="flex flex-col justify-between h-full w-full">
                        <div>
                            <div className="p-5 pb-10">
                                <SearchBox />
                            </div>
                            {rightCol}
                        </div>
                        <div className="p-5 w-full text-right text-gray-400 text-sm">
                            <a
                                href="https://gitlab.futo.org/polycentric/polycentric"
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                            >
                                Source Code
                            </a>
                            <a
                                href="https://docs.polycentric.io/privacy-policy/"
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                            >
                                Privacy Policy
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
