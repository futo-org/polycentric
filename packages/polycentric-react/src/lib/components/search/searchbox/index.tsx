import { ArrowRightIcon } from '@heroicons/react/24/solid';
import { useEffect, useRef, useState } from 'react';
import { useParams } from '../../../hooks/stackRouterHooks';
import { ProfilePicture } from '../../profile/ProfilePicture';
import { Link } from '../../util/link';

interface ResultsPreview {
    accounts: { name: string; avatarURL: string; id: string; url?: string }[];
    topics: string[];
}

function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => clearTimeout(handler);
    }, [value, delay]);

    return debouncedValue;
}

export const SearchBox = ({
    getResultsPreview,
    debounceMs = 200,
}: {
    getResultsPreview?: (query: string) => Promise<ResultsPreview>;
    debounceMs?: number;
}) => {
    const { query: pathQuery } = useParams<{ query?: string }>();
    const [query, setQuery] = useState(pathQuery ?? '');
    const debouncedQuery = useDebounce(query, debounceMs);
    const [results, setResults] = useState<ResultsPreview | null>(null);

    useEffect(() => {
        if (debouncedQuery && debouncedQuery.length > 0) {
            getResultsPreview?.(debouncedQuery).then(setResults);
        }
    }, [debouncedQuery, getResultsPreview]);

    const searchButtonRef = useRef<HTMLAnchorElement | null>(null);

    return (
        <div className="flex flex-col space-y-2">
            <div className="flex rounded-full border focus-within:border-gray-300 p-2 space-x-2">
                <input
                    type="text"
                    placeholder="Search..."
                    className="flex-grow text-lg ml-4 placeholder:font-light placeholder:text-gray-300 text-gray-800 focus:outline-none min-w-0"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            if (query.length >= 3)
                                searchButtonRef.current?.click();
                        }
                    }}
                />
                <Link
                    className={`rounded-full border aspect-square h-[2.5rem] w-[2.5rem] flex justify-center items-center ${
                        query.length >= 3 ? 'hover:bg-gray-50' : ''
                    }`}
                    routerLink={
                        query.length >= 3 ? `/search/${query}` : undefined
                    }
                    ref={searchButtonRef}
                >
                    <ArrowRightIcon
                        className={`w-6 h-6  ${
                            query.length >= 3
                                ? 'text-gray-500'
                                : 'text-gray-300'
                        }`}
                    />
                </Link>
            </div>
            {query.length > 0 && results && (
                <div className="relative">
                    <div className="flex flex-col space-y-0 border rounded-lg bg-white absolute w-full">
                        <div className="flex flex-col space-y-1.5 py-3 px-1">
                            <h3 className="font-medium pl-2.5">Accounts</h3>
                            <div className="flex flex-col">
                                {results?.accounts.map((account) => (
                                    <Link
                                        className="flex items-center space-x-3 hover:bg-gray-100 p-3 rounded-md cursor-default"
                                        routerLink={account.url}
                                        key={account.id}
                                    >
                                        <ProfilePicture
                                            className="h-10 w-10"
                                            src={account.avatarURL}
                                        />
                                        <div className="flex flex-col">
                                            <div className="text-gray-500">
                                                {account.name}
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>
                        {/* Little decorative circle divider */}
                        <div className="flex justify-center relative">
                            <div className="w-3 h-3 border-2 border-gray-200 rounded-full"></div>
                            <div className="w-3 h-3 border-2 border-gray-200 rounded-full -ml-1"></div>
                            <div className="w-3 h-3 border-2 border-gray-200 rounded-full -ml-1"></div>
                        </div>
                        <div className="flex flex-col space-y-1.5 py-3 px-1">
                            <h3 className="font-medium pl-2.5">Topics</h3>
                            <div className="flex flex-col cursor-default">
                                {results?.topics.map((topic) => (
                                    <div
                                        className="flex items-center space-x-3 hover:bg-gray-100 p-3 rounded-md"
                                        key={topic}
                                    >
                                        <div className="flex flex-col">
                                            <div className="text-gray-500">
                                                {topic}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
