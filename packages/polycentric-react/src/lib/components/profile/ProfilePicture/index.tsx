import { ImgHTMLAttributes } from 'react';

export const ProfilePicture = ({
    src,
    alt,
    className,
    showPlaceholder = false,
    ...rest
}: {
    src?: string | undefined;
    alt?: string;
    className: string;
    showPlaceholder?: boolean;
} & ImgHTMLAttributes<HTMLImageElement>) => {
    return (
        <div
            className={`rounded-full overflow-clip border ${className} relative`}
        >
            {src === undefined ? (
                <div className="w-full h-full bg-gray-200"></div>
            ) : (
                <>
                    <img
                        {...rest}
                        className="w-full h-full"
                        src={src}
                        alt={alt}
                    />
                    {showPlaceholder && (
                        <div className="absolute inset-0 w-full h-full bg-gray-200 border border-gray-200"></div>
                    )}
                </>
            )}
        </div>
    );
};
