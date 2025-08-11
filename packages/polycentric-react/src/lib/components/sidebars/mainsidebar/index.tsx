import { IonMenuToggle } from '@ionic/react';
import { useContext, useMemo } from 'react';
import polycentricIcon from '../../../../graphics/icons/favicon.ico';
import { MobileSwipeTopicContext } from '../../../app/contexts';
import { useIsMobile } from '../../../hooks/styleHooks';
import { AccountSwitcher } from '../../profile/AccountSwitcher';
import { Link } from '../../util/link';
import { DesktopTopicSelector } from './desktop/DesktopTopicSelector';
import { MobileTopicSidebar } from './mobile/MobileTopicSidebar';

export const SidebarLink = ({
  to,
  children,
  className,
  style,
  topicName,
}: {
  to?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  topicName: string;
}) => {
  const isMobile = useIsMobile();
  const { topic, setTopic } = useContext(MobileSwipeTopicContext);

  const isCurrentTopic = useMemo(() => topic === topicName, [topic, topicName]);

  return (
    <IonMenuToggle className="contents">
      {isMobile ? (
        <Link
          onClick={() => {
            // For Forums, navigate to the forums page instead of setting it as a topic
            if (topicName === 'Forums') {
              // Don't set topic, let the router handle navigation
              return;
            }
            setTopic(topicName);
          }}
          className={`rounded p-2 mb-2 hover:bg-gray-200 transition-colors duration-200 text-left ${
            isCurrentTopic ? 'bg-gray-100' : ''
          } ${className}`}
          style={style}
          routerLink={topicName === 'Forums' ? '/forums' : '/'}
          routerDirection="root"
        >
          {children}
        </Link>
      ) : (
        <Link
          routerLink={to}
          routerDirection="root"
          className={`rounded hover:bg-gray-200 p-2 mb-2 transition-colors duration-200 ${className}`}
          activeClassName="bg-gray-100"
          style={style}
        >
          {children}
        </Link>
      )}
    </IonMenuToggle>
  );
};

export const MainSidebar = () => {
  const isMobile = useIsMobile();

  return (
    <div className="h-full w-full flex flex-col space-y-5 justify-between md:p-5">
      <div className="flex flex-col space-y-5 flex-grow min-h-0">
        <Link routerLink="/" className="text-lg">
          <img src={polycentricIcon} className="inline h-[20px]" /> Polycentric
        </Link>
        <div className="flex flex-col text-left min-h-0">
          <SidebarLink to="/following" topicName="Following">
            Following
          </SidebarLink>
          <SidebarLink to="/" topicName="Explore">
            Explore
          </SidebarLink>
          <SidebarLink to="/forums" topicName="Forums">
            Forums
          </SidebarLink>
          {/* empty div of same size */}
          <div className="h-5 flex-shrink-0" />
          {isMobile ? <MobileTopicSidebar /> : <DesktopTopicSelector />}
        </div>
      </div>
      <div className="flex-shrink-0 space-y-3">
        <AccountSwitcher />
      </div>
    </div>
  );
};
