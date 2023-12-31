export const ProfilePicture = ({
    src,
    className,
}: {
    src?: string | undefined;
    className: string;
}) => {
    return (
        <div className={`rounded-full overflow-clip border ${className}`}>
            {src === undefined ? (
                <div className="w-full h-full bg-gray-200"></div>
            ) : (
                <img className="w-full h-full" src={src} />
            )}
        </div>
    );
};
