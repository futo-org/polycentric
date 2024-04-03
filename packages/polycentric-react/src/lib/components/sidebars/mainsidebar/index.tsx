import { IonMenuToggle } from '@ionic/react';
import polycentricIcon from '../../../../graphics/icons/favicon.ico';
import { AccountSwitcher } from '../../profile/AccountSwitcher';
import { Link } from '../../util/link';
import { DesktopTopicSelector } from './desktop/DesktopTopicSelector';

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
                <div className="h-5 flex-shrink-0" />
                <DesktopTopicSelector />
            </div>
        </div>
        <div className="flex-shrink-0">
            <AccountSwitcher />
        </div>
    </div>
);
