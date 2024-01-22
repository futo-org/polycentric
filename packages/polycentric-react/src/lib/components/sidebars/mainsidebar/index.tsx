import { IonMenuToggle } from '@ionic/react';
import { NavLink } from 'react-router-dom';
import polycentricIcon from '../../../../graphics/icons/favicon.ico';
import { AccountSwitcher } from '../../profile/AccountSwitcher';

const SidebarLink = ({
    to,
    children,
}: {
    to: string;
    children: React.ReactNode;
}) => (
    <IonMenuToggle className="contents">
        <NavLink
            to={to}
            className="rounded hover:bg-gray-200 p-2 mb-2 transition-colors duration-200"
            activeClassName="bg-gray-100"
            exact={true}
        >
            {children}
        </NavLink>
    </IonMenuToggle>
);

export const MainSidebar = () => (
    <div className="h-full w-full flex flex-col space-y-5 justify-between md:p-5">
        <div className="flex flex-col space-y-5">
            <h1 className="text-lg">
                <img src={polycentricIcon} className="inline h-[20px]" />{' '}
                Polycentric
            </h1>
            <div className="flex flex-col text-right">
                <SidebarLink to="/following">Following</SidebarLink>
                <SidebarLink to="/">Explore</SidebarLink>
            </div>
        </div>
        <div>
            <AccountSwitcher />
        </div>
    </div>
);
