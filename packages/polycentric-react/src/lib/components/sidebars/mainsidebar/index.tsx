import { BackwardIcon, StarIcon } from '@heroicons/react/24/solid';
import { IonMenuToggle } from '@ionic/react';
import { useState } from 'react';
import polycentricIcon from '../../../../graphics/icons/favicon.ico';
import { AccountSwitcher } from '../../profile/AccountSwitcher';
import { Link } from '../../util/link';

const SidebarLink = ({
    to,
    children,
    className,
    style,
}: {
    to: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) => (
    <IonMenuToggle className="contents">
        <Link
            routerLink={to}
            routerDirection="root"
            className={`rounded hover:bg-gray-200 p-2 mb-2 transition-colors duration-200 ${className}`}
            activeClassName="bg-gray-100"
            style={style}
        >
            {children}
        </Link>
    </IonMenuToggle>
);

const TopicSection = () => {
    const [favoritesOrHistory, setFavoritesOrHistory] = useState<
        'favorites' | 'history'
    >('favorites');
    const [topicSearch, setTopicSearch] = useState('');
    let dummyTopics = [
        '/tpot/dating',
        '/tpot/bar',
        '/futo/',
        '/futo/polycentric',
        '/futo/grayjay',
        '/futo/harbor',
        '/futo/harbor1',
        '/futo/harbor33',
    ];

    if (favoritesOrHistory === 'history') {
        dummyTopics = [];
    }

    return (
        <div className="flex flex-col space-y-1 text-left flex-shrink min-h-0">
            <div className="flex items-center space-x-2">
                <button
                    className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
                        favoritesOrHistory === 'favorites'
                            ? 'bg-gray-100'
                            : 'bg-gray-50'
                    }`}
                    title="Favorites"
                    onClick={() => setFavoritesOrHistory('favorites')}
                >
                    <StarIcon
                        className={`h-4 w-4 ${
                            favoritesOrHistory === 'favorites'
                                ? 'text-gray-400'
                                : 'text-gray-200'
                        } group-hover:text-gray-400`}
                    />
                </button>
                <button
                    className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
                        favoritesOrHistory === 'history'
                            ? 'bg-gray-100 '
                            : 'bg-gray-50'
                    }`}
                    title="History"
                    onClick={() => setFavoritesOrHistory('history')}
                >
                    <BackwardIcon
                        className={`h-5 w-5 ${
                            favoritesOrHistory === 'history'
                                ? 'text-gray-400'
                                : 'text-gray-200'
                        } group-hover:text-gray-400`}
                    />
                </button>
                <input
                    className={`rounded-l-full rounded-tr-full flex-grow p-2 pl-4 border 
                        border-gray-100 focus:outline-none focus:border-gray-300 
                        placeholder:font-light
                        `}
                    placeholder="Search Topics"
                    value={topicSearch}
                    onChange={(e) => {
                        setTopicSearch(e.target.value);
                    }}
                    onFocus={(e) => {
                        if (e.target.value === '') {
                            setTopicSearch('/');
                            // put cursor at end of new value
                            e.target.selectionStart = 2
                        }
                    }}
                    onBlur={(e) => {
                        if (e.target.value === '/') {
                            setTopicSearch('');
                        }
                    }}
                />
            </div>
            <div className="flex flex-col flex-shrink space-y-0.5 overflow-y-auto">
                {dummyTopics.map((topic) => (
                    <Link
                        className="h-12 p-1 rounded-l-full rounded-r flex items-center space-x-2 ml-11 text-left 
                    group hover:bg-gray-100 transition-colors duration-200 cursor-pointer"
                        activeClassName="bg-gray-100"
                        key={topic}
                        routerLink={'/t/' + topic.replace(/^\//, '')}
                        routerDirection="root"
                    >
                        {/* <div className=" border rounded-full h-10 w-full skew-x-[30deg]">
                        
                    </div> */}
                        <div className="h-10 aspect-square bg-gray-50 rounded-full flex justify-center items-center bg-opacity-30 group-hover:bg-opacity-100">
                            <StarIcon className="h-6 w-6 text-gray-200 group-hover:text-slate-300" />
                        </div>
                        <div className="text-gray-400 flex-grow pl-4">
                            {topic}
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export const MainSidebar = () => (
    <div className="h-full w-full flex flex-col space-y-5 justify-between md:p-5">
        <div className="flex flex-col space-y-5 flex-grow min-h-0">
            <h1 className="text-lg">
                <img src={polycentricIcon} className="inline h-[20px]" />{' '}
                Polycentric
            </h1>
            <div className="flex flex-col text-right min-h-0">
                <SidebarLink to="/following">Following</SidebarLink>
                <SidebarLink to="/">Explore</SidebarLink>
                {/* empty div of same size */}
                <div className="h-10 flex-shrink-0" />
                <TopicSection />
            </div>
        </div>
        <div className="flex-shrink-0">
            <AccountSwitcher />
        </div>
    </div>
);
