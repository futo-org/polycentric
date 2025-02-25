export const ProfilePicture = ({
  src,
  alt,
  className,
}: {
  src?: string | undefined;
  alt?: string;
  className: string;
}) => {
  return (
    <div className={`rounded-full overflow-clip border ${className}`}>
      {src === undefined ? (
        <div className="w-full h-full bg-gray-200"></div>
      ) : (
        <img className="w-full h-full" src={src} alt={alt} />
      )}
    </div>
  );
};
